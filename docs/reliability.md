# Worker crash recovery

## Problem

Transcription runs in a separate worker process. A worker claims a job by setting it to
`processing`, but only `queued` jobs are ever claimed again. If the worker died mid-job
(OOM kill, `SIGKILL`, container restart, host reboot) nothing moved the job out of
`processing`: the recording showed "Processing" forever and needed manual database repair.

Reproduced with `npm run chaos:worker -- --scenario kill` on the code before this change:
the worker is killed while the provider call is in flight, a fresh worker starts, and the
job is still `processing` when the experiment times out after 60 s.

## Design: leases + heartbeats + fencing

```
            claim (workerId, lockedAt=now)
 queued ───────────────────────────────▶ processing ──── complete ───▶ completed
   ▲                                       │   │
   │      lease expired (no heartbeat      │   └── error ──▶ retry (queued) / failed / blocked
   └──── for WORKER_LEASE_MS) ─────────────┘
          attemptCount += 1, or failed after 3 attempts
```

- **Lease.** `lockedAt` on `task_jobs` is the lease timestamp. While a job runs, the owning
  worker refreshes it every `WORKER_HEARTBEAT_MS` (default 15 s), but only for rows where
  `status = 'processing' AND workerId = <me>`.
- **Reclaim.** Every worker sweeps about once per heartbeat for `processing` jobs whose lease
  is older than `WORKER_LEASE_MS` (default 120 s) and puts them back in the queue. The update
  is a compare-and-set on the observed `workerId` and `lockedAt`, so two sweepers, or a sweep
  racing a late heartbeat, can never both win.
- **The crash counts as an attempt.** A recording that crashes every worker (for example a
  file that triggers OOM) ends as `failed` after 3 attempts with the reason recorded, instead
  of taking workers down in a loop.
- **Fencing.** A worker that was only frozen (GC pause, `SIGSTOP`, a network partition to the
  DB) may wake up after its job was reassigned. Completion and failure writes require
  `workerId = <me>`; the processor checks ownership right before persisting results; and when
  a heartbeat finds the lease gone, the in-flight provider call is aborted. The stale worker
  then drops the job without touching it.
- **Idempotent results.** Results overwrite the task row and re-indexing clears old chunks
  first, so re-running a job does not duplicate transcripts or search entries.

Code: [`lib/tasks/job-lease.ts`](../lib/tasks/job-lease.ts),
`reclaimExpiredJobs` in [`lib/tasks/task-queue.ts`](../lib/tasks/task-queue.ts),
lease queries in [`database/repositories/task-jobs-repository.ts`](../database/repositories/task-jobs-repository.ts),
tests in [`tests/worker-recovery.test.ts`](../tests/worker-recovery.test.ts).

## Experiment

`npm run chaos:worker` runs both scenarios against real `worker.ts` processes, a throwaway
SQLite database and a fake OpenAI-compatible provider that answers after 6 s. The lease is
shortened to 4 s (heartbeat 1 s) so the run takes about 25 s.

| Scenario | What happens | Before | After |
|---|---|---|---|
| `kill` | `SIGKILL` the worker during the provider call, start a new worker | Job stuck in `processing` (timed out at 60 s) | Taken over 4.6–5.5 s after the kill, completed 10.8–12.5 s after it |
| `pause` | `SIGSTOP` the worker until its lease expires, let a second worker take over, then `SIGCONT` the first | — | The woken worker logs "dropped job after losing its lease" and writes nothing |

Checks in both scenarios: the task and the job end `completed`; there is still exactly one
job row; the interruption counted as one attempt; the transcript is the takeover worker's
(written once); search chunks are not duplicated.

Recovery time is about lease + one sweep interval + the re-run of the job. With the default
settings, expect roughly 2–2.5 minutes before a crashed job restarts.

## Trade-offs and limits

- **At-least-once, not exactly-once, execution.** A reclaimed job calls the provider again.
  Results are written once, but a paid provider bills twice for a crashed job.
- **Lease length.** A shorter lease recovers faster, but a worker that is merely slow (a long
  GC pause, an overloaded DB) risks being declared dead. 120 s is 8 heartbeats, so several
  consecutive heartbeats must be lost before a job is reclaimed.
- **Clocks.** Lease ages compare timestamps written by different workers. Hosts are assumed
  to be NTP-synced; skew well below the lease length is harmless.
- **Post-processing.** Summary and tag generation start after the job completes. They are not
  covered by the lease and are not retried if the worker dies at that moment.

# Provider fallback

## Problem

`parseAudioWithFallback` built a provider chain (default provider plus the user's fallbacks),
but the fallback rarely took over:

- A **service** error (outage, 429, 5xx, timeout) on the first provider stopped the chain and
  paused the whole queue, even with a healthy fallback configured.
- An **open circuit** on the first provider also aborted the chain, which defeats the purpose
  of a circuit breaker: skip the sick provider, use the next one.
- Only **task** errors (input rejected) moved on to the next provider.

## Behaviour now

[`lib/audio-engine/provider-chain.ts`](../lib/audio-engine/provider-chain.ts):

| Situation on a provider | Action |
|---|---|
| Circuit open | Skip it without calling it; the skip does not extend the circuit |
| Service error (outage, 429, 5xx, timeout) | Record it against the provider's circuit, try the next provider |
| Task error (this file was rejected) | Try the next provider; does not count against the circuit |
| Cancelled | Stop immediately, never fall through |
| Nothing succeeded | Service error if any provider was merely unavailable (the queue backs off and retries); task error only when every provider rejected the input (the recording fails) |

Only providers the user configured as fallbacks are tried, so cost and privacy choices
(for example "never send audio to a cloud API") stay with the user's settings.

Not handled yet: capability matching. A fallback without speaker diarization still produces
a transcript, just without speaker labels; the switch shows up in the task's
`skippedProviders` / `finalProvider` metadata. Tests: [`tests/unit/provider-chain.test.ts`](../tests/unit/provider-chain.test.ts).

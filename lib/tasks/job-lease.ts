import logger from '../shared/logger.js';
import config from '../config.js';
import { refreshTaskJobLease } from '../../database/repositories/task-jobs-repository.js';
import type { TaskJobRow } from './task-types.js';

const log = logger.child('job-lease');

/**
 * Thrown when a worker discovers it no longer owns its job — the lease expired and the
 * job was re-queued (possibly already picked up by another worker). The worker must stop
 * and write nothing: the job's state now belongs to whoever reclaimed it.
 */
export class JobLeaseLostError extends Error {
  constructor(message = 'This worker no longer holds the job lease.') {
    super(message);
    this.name = 'JobLeaseLostError';
  }
}

export function isJobLeaseLostError(error: unknown) {
  return error instanceof JobLeaseLostError || (error instanceof Error && error.name === 'JobLeaseLostError');
}

/** A job is owned by the worker that claimed it only while it is still processing under that workerId. */
export function isJobOwnedBy(
  current: Pick<TaskJobRow, 'status' | 'workerId'> | null | undefined,
  claimed: Pick<TaskJobRow, 'workerId'>,
) {
  return Boolean(current && current.status === 'processing' && current.workerId && current.workerId === claimed.workerId);
}

/**
 * Refreshes the job lease every `heartbeatMs` while the job runs. If a refresh finds the
 * lease gone, `onLost` is called once so the caller can abort in-flight work.
 */
export function startLeaseHeartbeat(
  job: Pick<TaskJobRow, 'id' | 'workerId'>,
  onLost: () => void,
  heartbeatMs = config.worker.heartbeatMs,
) {
  const workerId = job.workerId;
  if (!workerId) {
    return () => {};
  }

  let stopped = false;
  let inFlight = false;
  const timer = setInterval(() => {
    if (stopped || inFlight) return;
    inFlight = true;
    void refreshTaskJobLease(job.id, workerId, Date.now())
      .then((updated) => {
        if (!stopped && !updated) {
          stopped = true;
          clearInterval(timer);
          log.warn('Job lease lost; stopping work', { jobId: job.id, workerId });
          onLost();
        }
      })
      .catch((error) => {
        // A transient DB error is not proof the lease is gone; the next beat retries.
        log.warn('Lease heartbeat failed', {
          jobId: job.id,
          workerId,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        inFlight = false;
      });
  }, heartbeatMs);
  timer.unref();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

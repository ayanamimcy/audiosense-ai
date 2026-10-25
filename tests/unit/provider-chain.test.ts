import test from 'node:test';
import assert from 'node:assert/strict';
import { runProviderChain } from '../../lib/audio-engine/provider-chain.js';
import { createServiceError, createTaskError, type ProcessingError } from '../../lib/audio-engine/errors.js';
import { TranscriptionCancelledError } from '../../lib/audio-engine/cancellation.js';

function harness(behaviour: Record<string, 'ok' | 'service' | 'task' | 'circuit-open'>) {
  const calls: string[] = [];
  const failures: string[] = [];
  return {
    calls,
    failures,
    deps: {
      isCircuitOpen: async (provider: string) => behaviour[provider] === 'circuit-open',
      recordFailure: async (provider: string, _error: ProcessingError) => {
        failures.push(provider);
      },
      attempt: async (provider: string) => {
        calls.push(provider);
        if (behaviour[provider] === 'service') throw createServiceError(`${provider} is down`, provider);
        if (behaviour[provider] === 'task') throw createTaskError(`${provider} rejected the file`, provider);
        return `${provider}-result`;
      },
    },
  };
}

test('an outage on the primary falls through to the configured fallback', async () => {
  const { deps, calls, failures } = harness({ primary: 'service', backup: 'ok' });
  const outcome = await runProviderChain(['primary', 'backup'], deps);

  assert.equal(outcome.provider, 'backup');
  assert.equal(outcome.value, 'backup-result');
  assert.deepEqual(calls, ['primary', 'backup']);
  assert.deepEqual(failures, ['primary'], 'the outage counts against the primary circuit');
  assert.deepEqual(outcome.skippedProviders, ['primary']);
});

test('a provider with an open circuit is skipped without being called', async () => {
  const { deps, calls, failures } = harness({ primary: 'circuit-open', backup: 'ok' });
  const outcome = await runProviderChain(['primary', 'backup'], deps);

  assert.equal(outcome.provider, 'backup');
  assert.deepEqual(calls, ['backup']);
  assert.deepEqual(failures, [], 'skipping must not extend the circuit');
  assert.deepEqual(outcome.attemptedProviders, ['backup']);
});

test('a rejected input is offered to the next provider without tripping the circuit', async () => {
  const { deps, failures } = harness({ primary: 'task', backup: 'ok' });
  const outcome = await runProviderChain(['primary', 'backup'], deps);

  assert.equal(outcome.provider, 'backup');
  assert.deepEqual(failures, []);
});

test('when every provider is unavailable the error is a service error, so the queue backs off', async () => {
  const { deps } = harness({ primary: 'circuit-open', backup: 'service' });
  await assert.rejects(runProviderChain(['primary', 'backup'], deps), (error: ProcessingError) => {
    assert.equal(error.category, 'service');
    assert.match(error.message, /primary: circuit open \| backup: backup is down/);
    return true;
  });
});

test('an outage anywhere outranks a rejection: retrying later may still succeed', async () => {
  const { deps } = harness({ primary: 'service', backup: 'task' });
  await assert.rejects(runProviderChain(['primary', 'backup'], deps), (error: ProcessingError) => {
    assert.equal(error.category, 'service');
    return true;
  });
});

test('when every provider rejects the input the recording fails as a task error', async () => {
  const { deps } = harness({ primary: 'task', backup: 'task' });
  await assert.rejects(runProviderChain(['primary', 'backup'], deps), (error: ProcessingError) => {
    assert.equal(error.category, 'task');
    return true;
  });
});

test('cancellation stops the chain instead of trying the fallback', async () => {
  const controller = new AbortController();
  const { deps, calls } = harness({ primary: 'ok', backup: 'ok' });
  const outcome = runProviderChain(['primary', 'backup'], {
    ...deps,
    signal: controller.signal,
    attempt: async (provider) => {
      calls.push(provider);
      controller.abort();
      throw new Error('socket closed');
    },
  });
  await assert.rejects(outcome, (error) => error instanceof TranscriptionCancelledError);
  assert.deepEqual(calls, ['primary']);
});

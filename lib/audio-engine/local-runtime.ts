import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';

const runtimeRoot = fileURLToPath(new URL('../../python-runtime', import.meta.url));
const runtimeSourcePath = path.join(runtimeRoot, 'src');

let runtimeProcess: ChildProcessWithoutNullStreams | null = null;
let startupPromise: Promise<void> | null = null;
let cleanupRegistered = false;

function getRuntimeBaseUrl() {
  const port = Number(process.env.LOCAL_AUDIO_ENGINE_PORT || 8765);
  return (process.env.LOCAL_AUDIO_ENGINE_URL || `http://127.0.0.1:${port}`).replace(/\/$/, '');
}

function buildPythonPath() {
  const currentPythonPath = process.env.PYTHONPATH;
  return currentPythonPath ? `${runtimeSourcePath}${path.delimiter}${currentPythonPath}` : runtimeSourcePath;
}

function getStartupTimeoutMs() {
  return Math.max(5_000, Number(process.env.LOCAL_AUDIO_ENGINE_STARTUP_TIMEOUT_MS || 120_000));
}

async function isRuntimeHealthy() {
  try {
    await axios.get(`${getRuntimeBaseUrl()}/health`, {
      timeout: 1_500,
    });
    return true;
  } catch {
    return false;
  }
}

function registerCleanup() {
  if (cleanupRegistered) {
    return;
  }

  cleanupRegistered = true;
  process.once('exit', () => {
    if (runtimeProcess && !runtimeProcess.killed) {
      runtimeProcess.kill();
    }
  });
}

function wireRuntimeLogs(child: ChildProcessWithoutNullStreams) {
  child.stdout.on('data', (chunk) => {
    const output = chunk.toString();
    if (output.trim()) {
      process.stdout.write(`[local-audio-runtime] ${output}`);
    }
  });

  child.stderr.on('data', (chunk) => {
    const output = chunk.toString();
    if (output.trim()) {
      process.stderr.write(`[local-audio-runtime] ${output}`);
    }
  });
}

async function waitForRuntimeReady(child: ChildProcessWithoutNullStreams) {
  const startedAt = Date.now();
  const timeoutMs = getStartupTimeoutMs();

  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`Local audio runtime exited early with code ${child.exitCode}.`);
    }

    if (await isRuntimeHealthy()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(`Timed out waiting for local audio runtime after ${timeoutMs}ms.`);
}

async function startRuntimeProcess() {
  registerCleanup();

  const child = spawn('python3', ['-m', 'local_audio_runtime.server'], {
    cwd: runtimeRoot,
    env: {
      ...process.env,
      PYTHONPATH: buildPythonPath(),
      PYTHONUNBUFFERED: '1',
    },
    stdio: 'pipe',
  });

  runtimeProcess = child;
  wireRuntimeLogs(child);

  child.once('exit', () => {
    runtimeProcess = null;
    startupPromise = null;
  });

  await waitForRuntimeReady(child);
}

export async function ensureLocalAudioRuntime() {
  if (await isRuntimeHealthy()) {
    return;
  }

  if (process.env.LOCAL_AUDIO_ENGINE_AUTOSTART === 'false') {
    throw new Error(
      'Local audio runtime is unavailable. Start python-runtime manually or enable LOCAL_AUDIO_ENGINE_AUTOSTART.',
    );
  }

  if (!startupPromise) {
    startupPromise = startRuntimeProcess().finally(() => {
      startupPromise = null;
    });
  }

  return startupPromise;
}

export function getLocalAudioRuntimeBaseUrl() {
  return getRuntimeBaseUrl();
}


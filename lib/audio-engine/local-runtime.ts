import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import config from '../config.js';

const runtimeRoot = fileURLToPath(new URL('../../python-runtime', import.meta.url));
const runtimeSourcePath = path.join(runtimeRoot, 'src');

let runtimeProcess: ChildProcessWithoutNullStreams | null = null;
let startupPromise: Promise<void> | null = null;
let cleanupRegistered = false;

function normalizeBaseUrl(url: string) {
  return url.replace(/\/$/, '');
}

function getDefaultRuntimeBaseUrl() {
  return config.localAudioEngine.baseUrl;
}

function getRuntimeBaseUrl(baseUrlOverride?: string) {
  if (baseUrlOverride?.trim()) {
    return normalizeBaseUrl(baseUrlOverride);
  }

  return getDefaultRuntimeBaseUrl();
}

function buildPythonPath() {
  const currentPythonPath = process.env.PYTHONPATH;
  return currentPythonPath ? `${runtimeSourcePath}${path.delimiter}${currentPythonPath}` : runtimeSourcePath;
}

function getStartupTimeoutMs() {
  return config.localAudioEngine.startupTimeoutMs;
}

async function isRuntimeHealthy(baseUrlOverride?: string) {
  try {
    await axios.get(`${getRuntimeBaseUrl(baseUrlOverride)}/health`, {
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

async function waitForRuntimeReady(child: ChildProcessWithoutNullStreams, baseUrlOverride?: string) {
  const startedAt = Date.now();
  const timeoutMs = getStartupTimeoutMs();

  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`Local audio runtime exited early with code ${child.exitCode}.`);
    }

    if (await isRuntimeHealthy(baseUrlOverride)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(`Timed out waiting for local audio runtime after ${timeoutMs}ms.`);
}

async function startRuntimeProcess(baseUrlOverride?: string) {
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

  await waitForRuntimeReady(child, baseUrlOverride);
}

export async function ensureLocalAudioRuntime(baseUrlOverride?: string) {
  if (await isRuntimeHealthy(baseUrlOverride)) {
    return;
  }

  const defaultBaseUrl = getDefaultRuntimeBaseUrl();
  const usingExternalRuntime =
    Boolean(baseUrlOverride?.trim()) && getRuntimeBaseUrl(baseUrlOverride) !== defaultBaseUrl;

  if (usingExternalRuntime) {
    throw new Error('Configured local audio runtime URL is unavailable. Start that runtime manually first.');
  }

  if (!config.localAudioEngine.autostart) {
    throw new Error(
      'Local audio runtime is unavailable. Start python-runtime manually or enable LOCAL_AUDIO_ENGINE_AUTOSTART.',
    );
  }

  if (!startupPromise) {
    startupPromise = startRuntimeProcess(baseUrlOverride).finally(() => {
      startupPromise = null;
    });
  }

  return startupPromise;
}

export function getLocalAudioRuntimeBaseUrl(baseUrlOverride?: string) {
  return getRuntimeBaseUrl(baseUrlOverride);
}

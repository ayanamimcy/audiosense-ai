import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'fs/promises';
import path from 'path';
import type { AudioFileMetadata } from './types.js';

const execFileAsync = promisify(execFile);

function readNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function toRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function inspectAudioFile(
  filePath: string,
  options: {
    mimeType?: string;
    fileName?: string;
  } = {},
) {
  const stats = await fs.stat(filePath);
  const metadata: AudioFileMetadata = {
    filePath,
    fileName: options.fileName || path.basename(filePath),
    extension: path.extname(options.fileName || filePath).toLowerCase(),
    sizeBytes: stats.size,
    mimeType: options.mimeType,
  };
  const warnings: string[] = [];

  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]);
    const probe = JSON.parse(stdout) as {
      format?: Record<string, unknown>;
      streams?: unknown[];
    };
    const format = toRecord(probe.format);
    const streams = Array.isArray(probe.streams) ? probe.streams.map(toRecord).filter(Boolean) : [];
    const audioStream =
      streams.find((stream) => readString(stream?.codec_type) === 'audio') || streams[0] || null;

    if (format) {
      metadata.durationSeconds = readNumber(format.duration);
      metadata.formatName = readString(format.format_name);
      const bitRate = readNumber(format.bit_rate);
      metadata.bitRateKbps = bitRate ? Math.round(bitRate / 1000) : undefined;
    }

    if (audioStream) {
      metadata.codecName = readString(audioStream.codec_name);
      metadata.sampleRateHz = readNumber(audioStream.sample_rate);
      metadata.channelCount = readNumber(audioStream.channels);
      metadata.durationSeconds = metadata.durationSeconds || readNumber(audioStream.duration);
      const streamBitRate = readNumber(audioStream.bit_rate);
      metadata.bitRateKbps = metadata.bitRateKbps || (streamBitRate ? Math.round(streamBitRate / 1000) : undefined);
    }
  } catch (error) {
    warnings.push(error instanceof Error ? `ffprobe unavailable: ${error.message}` : 'ffprobe unavailable');
  }

  return { metadata, warnings };
}


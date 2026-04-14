import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { pipeline } from 'stream/promises';
import { v4 as uuidv4 } from 'uuid';
import logger from '../lib/shared/logger.js';
import { createUploadTask, type UploadTaskInput } from '../lib/tasks/upload-service.js';
import { asyncRoute, requireAuthUser, uploadDir, uploadMaxFileSize } from './middleware.js';

const log = logger.child('routes:chunked-upload');

const chunksBaseDir = path.join(uploadDir, 'chunks');
if (!fs.existsSync(chunksBaseDir)) {
  fs.mkdirSync(chunksBaseDir, { recursive: true });
}

const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB
const CHUNK_UPLOAD_LIMIT = CHUNK_SIZE + 1024;

const chunkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CHUNK_UPLOAD_LIMIT },
});

type SessionStatus = 'uploading' | 'merging' | 'merged';

interface SessionMeta {
  userId: string;
  fileName: string;
  totalSize: number;
  fileMd5: string;
  totalChunks: number;
  createdAt: number;
  status: SessionStatus;
  /** Set after a successful merge+task creation so retries can return it. */
  taskId?: string;
}

function getSessionDir(uploadId: string) {
  const safe = uploadId.replace(/[^a-zA-Z0-9\-]/g, '');
  return path.join(chunksBaseDir, safe);
}

function getUploadedChunkIndexes(sessionDir: string): number[] {
  if (!fs.existsSync(sessionDir)) return [];
  return fs
    .readdirSync(sessionDir)
    .filter((name) => /^chunk_\d+$/.test(name))
    .map((name) => Number(name.replace('chunk_', '')))
    .sort((a, b) => a - b);
}

function readMeta(sessionDir: string): SessionMeta | null {
  const metaPath = path.join(sessionDir, '_meta.json');
  if (!fs.existsSync(metaPath)) return null;
  return JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as SessionMeta;
}

function writeMeta(sessionDir: string, meta: SessionMeta) {
  fs.writeFileSync(path.join(sessionDir, '_meta.json'), JSON.stringify(meta));
}

function assertSessionOwner(meta: SessionMeta, userId: string) {
  if (meta.userId !== userId) {
    throw Object.assign(new Error('Upload session belongs to another user.'), { status: 403 });
  }
}

function findExistingSession(userId: string, fileMd5: string): string | null {
  if (!fileMd5 || !fs.existsSync(chunksBaseDir)) return null;
  for (const entry of fs.readdirSync(chunksBaseDir)) {
    const meta = readMeta(path.join(chunksBaseDir, entry));
    if (
      meta
      && meta.userId === userId
      && meta.fileMd5 === fileMd5
      && meta.status === 'uploading'
    ) {
      return entry;
    }
  }
  return null;
}

const router = express.Router();

// ─── POST /upload/init ───────────────────────────────────────────────
router.post('/upload/init', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);

  const fileName = String(req.body.fileName || '').trim();
  const totalSize = Number(req.body.totalSize || 0);
  const fileMd5 = String(req.body.fileMd5 || '').trim();

  if (!fileName || !totalSize) {
    return res.status(400).json({ error: 'fileName and totalSize are required.' });
  }

  // Validate totalSize: must be positive and within server limit
  if (totalSize <= 0 || totalSize > uploadMaxFileSize) {
    return res.status(400).json({
      error: `File size must be between 1 byte and ${Math.round(uploadMaxFileSize / (1024 * 1024))} MB.`,
    });
  }

  // Resume: find an existing session for this (user, md5)
  let uploadId = findExistingSession(user.id, fileMd5);
  if (!uploadId) {
    uploadId = uuidv4();
  }

  const sessionDir = getSessionDir(uploadId);
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  const existingMeta = readMeta(sessionDir);
  if (existingMeta) {
    assertSessionOwner(existingMeta, user.id);
  } else {
    const meta: SessionMeta = {
      userId: user.id,
      fileName,
      totalSize,
      fileMd5,
      totalChunks: Math.ceil(totalSize / CHUNK_SIZE),
      status: 'uploading',
      createdAt: Date.now(),
    };
    writeMeta(sessionDir, meta);
  }

  const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);
  return res.json({
    uploadId,
    chunkSize: CHUNK_SIZE,
    totalChunks,
    uploadedChunkIndexes: getUploadedChunkIndexes(sessionDir),
  });
}));

// ─── POST /upload/chunk ──────────────────────────────────────────────
router.post('/upload/chunk', (req, res, next) => {
  chunkUpload.single('chunk')(req, res, (error) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: `Chunk exceeds the ${Math.round(CHUNK_UPLOAD_LIMIT / (1024 * 1024))} MB limit.`,
      });
    }
    if (error) {
      return next(error);
    }

    void (async () => {
      const user = requireAuthUser(req);
      const uploadId = String(req.body.uploadId || '').trim();
      const chunkIndex = Number(req.body.chunkIndex);

      if (!uploadId || !Number.isFinite(chunkIndex) || chunkIndex < 0) {
        return res.status(400).json({ error: 'uploadId and chunkIndex are required.' });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'No chunk data.' });
      }

      const sessionDir = getSessionDir(uploadId);
      const meta = readMeta(sessionDir);
      if (!meta) {
        return res.status(400).json({ error: 'Upload not initialized. Call /upload/init first.' });
      }
      assertSessionOwner(meta, user.id);

      if (meta.status === 'merged') {
        return res.status(400).json({ error: 'Upload already merged.' });
      }
      if (meta.status === 'merging') {
        return res.status(409).json({ error: 'Upload merge already in progress.' });
      }

      if (chunkIndex >= meta.totalChunks) {
        return res.status(400).json({
          error: `Invalid chunkIndex ${chunkIndex}. Expected 0..${meta.totalChunks - 1}.`,
        });
      }

      const isLastChunk = chunkIndex === meta.totalChunks - 1;
      const expectedMaxSize = isLastChunk
        ? meta.totalSize - chunkIndex * CHUNK_SIZE
        : CHUNK_SIZE;
      if (req.file.size > expectedMaxSize + 1024) {
        return res.status(400).json({ error: `Chunk ${chunkIndex} is too large.` });
      }

      const destPath = path.join(sessionDir, `chunk_${chunkIndex}`);
      fs.writeFileSync(destPath, req.file.buffer);
      return res.json({ success: true, chunkIndex });
    })().catch(next);
  });
});

// ─── POST /upload/merge ──────────────────────────────────────────────
router.post('/upload/merge', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);

  const uploadId = String(req.body.uploadId || '').trim();
  if (!uploadId) {
    return res.status(400).json({ error: 'uploadId is required.' });
  }

  const sessionDir = getSessionDir(uploadId);
  const meta = readMeta(sessionDir);
  if (!meta) {
    return res.status(400).json({ error: 'Upload metadata not found.' });
  }
  assertSessionOwner(meta, user.id);

  // ── Idempotency: if already merged, return the existing taskId ──
  if (meta.status === 'merged' && meta.taskId) {
    return res.json({ taskId: meta.taskId, message: 'Already merged.' });
  }

  // ── Atomic lock: create a lockfile with O_EXCL to prevent concurrent merges ──
  const lockPath = path.join(sessionDir, '_merge.lock');
  let lockFd: number;
  try {
    lockFd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
    fs.closeSync(lockFd);
  } catch {
    // Lock already exists — another merge is in progress
    return res.status(409).json({ error: 'Merge already in progress. Please wait.' });
  }

  // From this point, we own the lock. Clean up lock on every exit path.
  const releaseLock = () => {
    try { if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath); } catch { /* ignore */ }
  };

  try {
    // Re-read meta after acquiring lock (another request may have finished)
    const freshMeta = readMeta(sessionDir);
    if (freshMeta?.status === 'merged' && freshMeta.taskId) {
      releaseLock();
      return res.json({ taskId: freshMeta.taskId, message: 'Already merged.' });
    }

    // Validate: all chunk indexes must be exactly 0..totalChunks-1
    const uploadedIndexes = getUploadedChunkIndexes(sessionDir);
    const expectedIndexes = Array.from({ length: meta.totalChunks }, (_, i) => i);
    if (
      uploadedIndexes.length !== meta.totalChunks ||
      !uploadedIndexes.every((idx, i) => idx === expectedIndexes[i])
    ) {
      releaseLock();
      return res.status(400).json({
        error: `Incomplete upload. Expected chunks 0..${meta.totalChunks - 1}, got [${uploadedIndexes.join(',')}].`,
      });
    }

    // ── Mark as merging ──────────────────────────────────────────
    meta.status = 'merging';
    writeMeta(sessionDir, meta);

    // ── Merge with proper streaming + backpressure ───────────────
    const ext = path.extname(meta.fileName) || '.webm';
    const finalFilename = `${uuidv4()}${ext}`;
    const finalPath = path.join(uploadDir, finalFilename);

    const hash = crypto.createHash('md5');
    const writeStream = fs.createWriteStream(finalPath);

    try {
      for (let i = 0; i < meta.totalChunks; i++) {
        const chunkPath = path.join(sessionDir, `chunk_${i}`);
        const readStream = fs.createReadStream(chunkPath);
        readStream.on('data', (chunk: Buffer) => hash.update(chunk));
        await pipeline(readStream, writeStream, { end: false });
      }
      writeStream.end();
      await new Promise<void>((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });
    } catch (error) {
      if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
      meta.status = 'uploading';
      writeMeta(sessionDir, meta);
      releaseLock();
      throw error;
    }

    // ── Verify merged byte count matches declared totalSize ──────
    const stat = fs.statSync(finalPath);
    if (Math.abs(stat.size - meta.totalSize) > 1024) {
      fs.unlinkSync(finalPath);
      meta.status = 'uploading';
      writeMeta(sessionDir, meta);
      releaseLock();
      return res.status(400).json({
        error: `Merged file size (${stat.size}) does not match declared totalSize (${meta.totalSize}).`,
      });
    }

    // ── Verify MD5 if provided ───────────────────────────────────
    const computedMd5 = hash.digest('hex');
    if (meta.fileMd5 && meta.fileMd5 !== computedMd5) {
      fs.unlinkSync(finalPath);
      meta.status = 'uploading';
      writeMeta(sessionDir, meta);
      releaseLock();
      return res.status(400).json({
        error: 'MD5 mismatch after merge. File may be corrupted.',
        expected: meta.fileMd5,
        actual: computedMd5,
      });
    }

    // ── Create the transcription task ────────────────────────────
    const taskInput: UploadTaskInput = {
      userId: user.id,
      file: {
        filename: finalFilename,
        originalname: meta.fileName,
        mimetype: guessMimeType(ext),
        size: stat.size,
      },
      body: req.body,
    };

    let taskId: string;
    try {
      taskId = await createUploadTask(taskInput);
    } catch (error) {
      if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
      meta.status = 'uploading';
      writeMeta(sessionDir, meta);
      releaseLock();
      log.error('Failed to create task after merge', { error: error instanceof Error ? error.message : String(error) });
      return res.status(500).json({ error: 'Failed to create task.' });
    }

    // ── Success: persist taskId, clean up chunks, release lock ───
    meta.status = 'merged';
    meta.taskId = taskId;
    writeMeta(sessionDir, meta);

    for (const file of fs.readdirSync(sessionDir)) {
      if (file !== '_meta.json' && file !== '_merge.lock') {
        fs.unlinkSync(path.join(sessionDir, file));
      }
    }

    releaseLock();
    return res.json({ taskId, message: 'Upload merged and task queued.' });
  } catch (error) {
    releaseLock();
    throw error;
  }
}));

function guessMimeType(ext: string): string {
  const map: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.webm': 'audio/webm',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska',
  };
  return map[ext.toLowerCase()] || 'application/octet-stream';
}

export const chunkedUploadRouter = router;

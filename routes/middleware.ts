import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  getSessionCookieName,
  getSessionUser,
  readCookie,
  serializeClearedSessionCookie,
  serializeSessionCookie,
  type AuthUser,
} from '../lib/auth.js';

const configuredUploadDir = process.env.UPLOAD_DIR?.trim();
export const uploadDir = path.resolve(configuredUploadDir || path.join(process.cwd(), 'uploads'));
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const DEFAULT_UPLOAD_MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024;
const configuredUploadMaxFileSize = Number(process.env.UPLOAD_MAX_FILE_SIZE_BYTES || '');
const uploadMaxFileSize =
  Number.isFinite(configuredUploadMaxFileSize) && configuredUploadMaxFileSize > 0
    ? configuredUploadMaxFileSize
    : DEFAULT_UPLOAD_MAX_FILE_SIZE_BYTES;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`);
  },
});

export { uploadMaxFileSize };

export const upload = multer({
  storage,
  limits: { fileSize: uploadMaxFileSize },
});

export function setSessionCookie(res: express.Response, token: string) {
  res.setHeader('Set-Cookie', serializeSessionCookie(token));
}

export function clearSessionCookie(res: express.Response) {
  res.setHeader('Set-Cookie', serializeClearedSessionCookie());
}

export async function authenticateRequest(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  const token = readCookie(req.headers.cookie, getSessionCookieName());
  const session = await getSessionUser(token);
  if (!session) {
    clearSessionCookie(res);
    return res.status(401).json({ error: 'Authentication required.' });
  }

  req.authUser = session.user;
  req.authSessionId = session.sessionId;
  return next();
}

export function requireAuthUser(req: express.Request) {
  if (!req.authUser) {
    throw new Error('Authenticated user is missing from request context.');
  }

  return req.authUser;
}

export function asyncRoute(
  handler: (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => Promise<unknown>,
) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
}

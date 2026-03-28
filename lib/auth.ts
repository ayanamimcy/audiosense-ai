import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'crypto';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db.js';

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = 'audiosense_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  createdAt: number;
}

interface UserRow extends AuthUser {
  passwordHash: string;
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function parsePasswordHash(value: string) {
  const [salt, hash] = value.split(':');
  return { salt, hash };
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, passwordHash: string) {
  const { salt, hash } = parsePasswordHash(passwordHash);
  if (!salt || !hash) {
    return false;
  }

  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, 'hex');
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

export async function createUser(input: { name: string; email: string; password: string }) {
  const existing = (await db('users').whereRaw('lower(email) = ?', [input.email.toLowerCase()]).first()) as
    | UserRow
    | undefined;
  if (existing) {
    throw new Error('Email is already registered.');
  }

  const user: UserRow = {
    id: uuidv4(),
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    passwordHash: await hashPassword(input.password),
    createdAt: Date.now(),
  };

  await db('users').insert(user);
  return sanitizeUser(user);
}

export async function authenticateUser(email: string, password: string) {
  const user = (await db('users').whereRaw('lower(email) = ?', [email.trim().toLowerCase()]).first()) as
    | UserRow
    | undefined;
  if (!user) {
    return null;
  }

  const valid = await verifyPassword(password, user.passwordHash);
  return valid ? sanitizeUser(user) : null;
}

export async function updateUserProfile(input: { userId: string; name: string }) {
  const nextName = input.name.trim();
  if (!nextName) {
    throw new Error('Display name is required.');
  }

  await db('users').where({ id: input.userId }).update({ name: nextName });
  const user = (await db('users').where({ id: input.userId }).first()) as UserRow | undefined;
  if (!user) {
    throw new Error('User not found.');
  }

  return sanitizeUser(user);
}

export async function changeUserPassword(input: {
  userId: string;
  currentPassword: string;
  newPassword: string;
}) {
  const currentPassword = input.currentPassword || '';
  const newPassword = input.newPassword || '';
  if (!currentPassword) {
    throw new Error('Current password is required.');
  }
  if (newPassword.length < 8) {
    throw new Error('New password must be at least 8 characters.');
  }

  await db.transaction(async (trx) => {
    const user = (await trx('users').where({ id: input.userId }).first()) as UserRow | undefined;
    if (!user) {
      throw new Error('User not found.');
    }

    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) {
      throw new Error('Current password is incorrect.');
    }

    await trx('users').where({ id: input.userId }).update({
      passwordHash: await hashPassword(newPassword),
    });

    await trx('sessions').where({ userId: input.userId }).delete();
  });
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();

  await db('sessions').insert({
    id: uuidv4(),
    userId,
    tokenHash: hashToken(token),
    expiresAt: now + SESSION_TTL_MS,
    createdAt: now,
    lastSeenAt: now,
  });

  return token;
}

export async function getSessionUser(token: string | undefined) {
  if (!token) {
    return null;
  }

  const hashed = hashToken(token);
  const session = await db('sessions')
    .join('users', 'sessions.userId', 'users.id')
    .select(
      'users.id',
      'users.name',
      'users.email',
      'users.createdAt',
      'sessions.id as sessionId',
      'sessions.expiresAt',
    )
    .where('sessions.tokenHash', hashed)
    .first();

  if (!session) {
    return null;
  }

  if (Number(session.expiresAt) < Date.now()) {
    await db('sessions').where({ id: session.sessionId }).delete();
    return null;
  }

  await db('sessions').where({ id: session.sessionId }).update({ lastSeenAt: Date.now() });

  return {
    user: sanitizeUser(session),
    sessionId: String(session.sessionId),
  };
}

export async function destroySession(token: string | undefined) {
  if (!token) {
    return;
  }

  await db('sessions').where({ tokenHash: hashToken(token) }).delete();
}

export function getSessionCookieName() {
  return SESSION_COOKIE;
}

export function serializeSessionCookie(token: string) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${maxAge}`;
}

export function serializeClearedSessionCookie() {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`;
}

export function readCookie(header: string | undefined, name: string) {
  if (!header) {
    return undefined;
  }

  const parts = header.split(';').map((entry) => entry.trim());
  for (const part of parts) {
    const [key, ...rest] = part.split('=');
    if (key === name) {
      return decodeURIComponent(rest.join('='));
    }
  }

  return undefined;
}

function sanitizeUser(user: Pick<UserRow, 'id' | 'name' | 'email' | 'createdAt'>) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
  };
}

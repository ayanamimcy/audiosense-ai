import { db } from '../client.js';

export interface UserAuthRow {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: number;
}

export interface SessionRow {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: number;
  createdAt: number;
  lastSeenAt: number;
}

export interface SessionUserRow {
  id: string;
  name: string;
  email: string;
  createdAt: number;
  sessionId: string;
  expiresAt: number;
}

export async function findUserAuthRowByEmail(email: string) {
  return (await db('users').whereRaw('lower(email) = ?', [email.toLowerCase()]).first()) as
    | UserAuthRow
    | undefined;
}

export async function findUserAuthRowById(userId: string) {
  return (await db('users').where({ id: userId }).first()) as UserAuthRow | undefined;
}

export async function insertUserAuthRow(row: UserAuthRow) {
  await db('users').insert(row);
}

export async function updateUserAuthRowById(userId: string, updates: Partial<UserAuthRow>) {
  await db('users').where({ id: userId }).update(updates);
}

export async function listUserAuthRows() {
  return (await db('users')
    .select('id', 'name', 'email', 'createdAt')
    .orderBy('createdAt', 'asc')) as Array<Pick<UserAuthRow, 'id' | 'name' | 'email' | 'createdAt'>>;
}

export async function deleteUserAuthRowById(userId: string) {
  return db('users').where({ id: userId }).delete();
}

export async function insertSessionRow(row: SessionRow) {
  await db('sessions').insert(row);
}

export async function findSessionUserRowByTokenHash(tokenHash: string) {
  return (await db('sessions')
    .join('users', 'sessions.userId', 'users.id')
    .select(
      'users.id',
      'users.name',
      'users.email',
      'users.createdAt',
      'sessions.id as sessionId',
      'sessions.expiresAt',
    )
    .where('sessions.tokenHash', tokenHash)
    .first()) as SessionUserRow | undefined;
}

export async function updateSessionRowById(sessionId: string, updates: Partial<SessionRow>) {
  await db('sessions').where({ id: sessionId }).update(updates);
}

export async function deleteSessionRowById(sessionId: string) {
  await db('sessions').where({ id: sessionId }).delete();
}

export async function deleteSessionRowsByUserId(userId: string) {
  await db('sessions').where({ userId }).delete();
}

export async function deleteSessionRowByTokenHash(tokenHash: string) {
  await db('sessions').where({ tokenHash }).delete();
}

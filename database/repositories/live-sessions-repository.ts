import { db } from '../client.js';

/** A live session that has not heartbeated for this long is treated as gone. */
export const LIVE_SESSION_STALE_MS = 30_000;

export async function insertLiveSession(row: { id: string; userId: string; startedAt: number }) {
  await db('live_sessions').insert({ ...row, heartbeatAt: row.startedAt });
}

export async function touchLiveSession(id: string, now = Date.now()) {
  await db('live_sessions').where({ id }).update({ heartbeatAt: now });
}

export async function deleteLiveSession(id: string) {
  await db('live_sessions').where({ id }).delete();
}

export async function hasActiveLiveSession(now = Date.now()) {
  const row = await db('live_sessions')
    .where('heartbeatAt', '>', now - LIVE_SESSION_STALE_MS)
    .first('id');
  return Boolean(row);
}

export async function countProcessingJobs() {
  const row = await db('task_jobs').where({ status: 'processing' }).count<{ count: number | string }[]>({ count: '*' });
  return Number(row[0]?.count || 0);
}

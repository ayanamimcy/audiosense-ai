import { db } from '../client.js';

export interface ApiTokenRow {
  id: string;
  userId: string;
  name: string;
  tokenHash: string;
  scopes: string;
  expiresAt: number | null;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface ApiTokenUserRow {
  id: string;
  name: string;
  email: string;
  createdAt: number;
  tokenId: string;
  scopes: string;
  expiresAt: number | null;
}

export async function insertApiTokenRow(row: ApiTokenRow) {
  await db('api_tokens').insert(row);
}

export async function findApiTokenUserRowByTokenHash(tokenHash: string) {
  return (await db('api_tokens')
    .join('users', 'api_tokens.userId', 'users.id')
    .select(
      'users.id',
      'users.name',
      'users.email',
      'users.createdAt',
      'api_tokens.id as tokenId',
      'api_tokens.scopes',
      'api_tokens.expiresAt',
    )
    .where('api_tokens.tokenHash', tokenHash)
    .first()) as ApiTokenUserRow | undefined;
}

export async function listApiTokenRowsByUserId(userId: string) {
  return (await db('api_tokens')
    .select('id', 'name', 'scopes', 'expiresAt', 'createdAt', 'lastUsedAt')
    .where({ userId })
    .orderBy('createdAt', 'desc')) as Array<
    Pick<ApiTokenRow, 'id' | 'name' | 'scopes' | 'expiresAt' | 'createdAt' | 'lastUsedAt'>
  >;
}

export async function deleteApiTokenRowById(userId: string, tokenId: string) {
  return db('api_tokens').where({ id: tokenId, userId }).delete();
}

export async function updateApiTokenLastUsedAt(tokenId: string, timestamp: number) {
  await db('api_tokens').where({ id: tokenId }).update({ lastUsedAt: timestamp });
}

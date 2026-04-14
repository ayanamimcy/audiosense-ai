import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/setup.js';

const { db, resetDb, cleanup } = await setupTestDb();

const { createUser, authenticateUser, createSession, getSessionUser, destroySession } =
  await import('../lib/auth/auth.js');

test('auth', async (t) => {
  t.after(async () => {
    await cleanup();
  });

  await t.test('createUser creates a user and default workspace', async () => {
    await resetDb();
    const user = await createUser({
      name: 'Test User',
      email: 'test@example.com',
      password: 'password123',
    });

    assert.ok(user.id);
    assert.equal(user.name, 'Test User');
    assert.equal(user.email, 'test@example.com');
    assert.ok(user.createdAt);
  });

  await t.test('createUser rejects duplicate email', async () => {
    await resetDb();
    await createUser({ name: 'User 1', email: 'dupe@example.com', password: 'password123' });
    await assert.rejects(
      createUser({ name: 'User 2', email: 'dupe@example.com', password: 'password456' }),
    );
  });

  await t.test('authenticateUser with correct password', async () => {
    await resetDb();
    const created = await createUser({ name: 'Auth Test', email: 'auth@example.com', password: 'correctpass' });
    const user = await authenticateUser('auth@example.com', 'correctpass');
    assert.ok(user);
    assert.equal(user!.id, created.id);
  });

  await t.test('authenticateUser with wrong password returns null', async () => {
    await resetDb();
    await createUser({ name: 'Auth Test', email: 'auth2@example.com', password: 'correctpass' });
    const user = await authenticateUser('auth2@example.com', 'wrongpass');
    assert.equal(user, null);
  });

  await t.test('authenticateUser with unknown email returns null', async () => {
    await resetDb();
    const user = await authenticateUser('unknown@example.com', 'anypass');
    assert.equal(user, null);
  });

  await t.test('session lifecycle: create, get, destroy', async () => {
    await resetDb();
    const created = await createUser({ name: 'Session Test', email: 'session@example.com', password: 'pass12345' });

    const token = await createSession(created.id);
    assert.ok(token);
    assert.equal(typeof token, 'string');

    const session = await getSessionUser(token);
    assert.ok(session);
    assert.equal(session!.user.id, created.id);
    assert.equal(session!.user.email, 'session@example.com');

    await destroySession(token);
    const afterDestroy = await getSessionUser(token);
    assert.equal(afterDestroy, null);
  });

  await t.test('getSessionUser with invalid token returns null', async () => {
    const session = await getSessionUser('invalid-token-12345');
    assert.equal(session, null);
  });

  await t.test('getSessionUser with undefined token returns null', async () => {
    const session = await getSessionUser(undefined);
    assert.equal(session, null);
  });
});

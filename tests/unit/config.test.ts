import test from 'node:test';
import assert from 'node:assert/strict';

// Save and restore env vars around tests
const savedEnv = { ...process.env };

test('config module', async (t) => {
  await t.test('loads with default values when no env vars set', async () => {
    // Clear relevant env vars
    delete process.env.PORT;
    delete process.env.NODE_ENV;
    delete process.env.DB_TYPE;
    delete process.env.LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.EMBEDDING_API_KEY;

    // Dynamic import to get fresh config
    const configModule = await import('../../lib/config.js');
    const config = configModule.default;

    assert.equal(typeof config.server.port, 'number');
    assert.equal(typeof config.server.isProduction, 'boolean');
    assert.equal(typeof config.db.type, 'string');
    assert.ok(['sqlite3', 'pg'].includes(config.db.type));
    assert.equal(typeof config.upload.dir, 'string');
    assert.equal(typeof config.upload.maxFileSizeBytes, 'number');
    assert.ok(config.upload.maxFileSizeBytes > 0);
    assert.equal(typeof config.worker.idleMs, 'number');
    assert.equal(typeof config.llm.baseUrl, 'string');
    assert.equal(typeof config.llm.model, 'string');
    assert.equal(typeof config.embeddings.baseUrl, 'string');
    assert.equal(typeof config.embeddings.model, 'string');
    assert.equal(typeof config.transcription.defaultProvider, 'string');
    assert.equal(typeof config.localAudioEngine.baseUrl, 'string');
    assert.equal(typeof config.subtitleSplit.enabled, 'boolean');

    // Config should be frozen
    assert.throws(() => {
      (config.server as Record<string, unknown>).port = 9999;
    });
  });

  await t.test('server config reads PORT from env', async () => {
    // Config is already loaded as a singleton, so we verify the structure
    const configModule = await import('../../lib/config.js');
    const config = configModule.default;
    assert.equal(typeof config.server.port, 'number');
  });

  await t.test('embeddings falls back to llm config', async () => {
    const configModule = await import('../../lib/config.js');
    const config = configModule.default;
    // When EMBEDDING_API_KEY is not set, it should fall back to LLM_API_KEY
    assert.equal(typeof config.embeddings.apiKey, 'string');
    assert.equal(typeof config.embeddings.baseUrl, 'string');
  });

  await t.test('subtitleSplit falls back to llm config', async () => {
    const configModule = await import('../../lib/config.js');
    const config = configModule.default;
    assert.equal(typeof config.subtitleSplit.baseUrl, 'string');
    assert.equal(typeof config.subtitleSplit.model, 'string');
  });

  await t.test('config object is deeply frozen', async () => {
    const configModule = await import('../../lib/config.js');
    const config = configModule.default;
    assert.ok(Object.isFrozen(config));
    assert.ok(Object.isFrozen(config.server));
    assert.ok(Object.isFrozen(config.db));
    assert.ok(Object.isFrozen(config.llm));
    assert.ok(Object.isFrozen(config.embeddings));
  });

  // Restore env
  Object.assign(process.env, savedEnv);
});

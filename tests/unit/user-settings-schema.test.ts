import test from 'node:test';
import assert from 'node:assert/strict';

// Ensure test env
process.env.DB_TYPE = 'sqlite3';
process.env.NODE_ENV = 'test';

const { sanitizeUserSettings, getDefaultSettings, mergeUserSettings } =
  await import('../../lib/settings/user-settings-schema.js');

test('user-settings-schema', async (t) => {
  await t.test('getDefaultSettings returns a complete settings object', () => {
    const defaults = getDefaultSettings();

    assert.equal(typeof defaults.parseLanguage, 'string');
    assert.equal(typeof defaults.enableDiarization, 'boolean');
    assert.equal(typeof defaults.defaultProvider, 'string');
    assert.ok(Array.isArray(defaults.fallbackProviders));
    assert.equal(typeof defaults.autoGenerateSummary, 'boolean');
    assert.equal(typeof defaults.circuitBreakerThreshold, 'number');
    assert.equal(typeof defaults.circuitBreakerCooldownMs, 'number');
    assert.equal(typeof defaults.retrievalMode, 'string');
    assert.ok(['hybrid', 'fts', 'vector'].includes(defaults.retrievalMode));
    assert.equal(typeof defaults.maxKnowledgeChunks, 'number');

    // Nested settings
    assert.equal(typeof defaults.openaiWhisper.enabled, 'boolean');
    assert.equal(typeof defaults.openaiWhisper.baseUrl, 'string');
    assert.equal(typeof defaults.localRuntime.enabled, 'boolean');
    assert.equal(typeof defaults.localRuntime.baseUrl, 'string');
    assert.equal(typeof defaults.llm.baseUrl, 'string');
    assert.equal(typeof defaults.llm.model, 'string');
    assert.equal(typeof defaults.subtitleSplit.enabled, 'boolean');
  });

  await t.test('sanitizeUserSettings clamps circuitBreakerThreshold', () => {
    const result = sanitizeUserSettings({ circuitBreakerThreshold: 100 });
    assert.ok(result.circuitBreakerThreshold <= 10);
    assert.ok(result.circuitBreakerThreshold >= 1);

    const result2 = sanitizeUserSettings({ circuitBreakerThreshold: -5 });
    assert.ok(result2.circuitBreakerThreshold >= 1);
  });

  await t.test('sanitizeUserSettings clamps maxKnowledgeChunks', () => {
    const result = sanitizeUserSettings({ maxKnowledgeChunks: 50 });
    assert.ok(result.maxKnowledgeChunks <= 20);

    const result2 = sanitizeUserSettings({ maxKnowledgeChunks: 1 });
    assert.ok(result2.maxKnowledgeChunks >= 3);
  });

  await t.test('sanitizeUserSettings validates retrievalMode', () => {
    const result = sanitizeUserSettings({ retrievalMode: 'invalid' as any });
    assert.ok(['hybrid', 'fts', 'vector'].includes(result.retrievalMode));

    const result2 = sanitizeUserSettings({ retrievalMode: 'vector' });
    assert.equal(result2.retrievalMode, 'vector');
  });

  await t.test('sanitizeUserSettings rejects unknown provider', () => {
    const defaults = getDefaultSettings();
    const result = sanitizeUserSettings({ defaultProvider: 'nonexistent-provider' });
    assert.equal(result.defaultProvider, defaults.defaultProvider);
  });

  await t.test('sanitizeUserSettings deduplicates fallback providers', () => {
    const result = sanitizeUserSettings({
      defaultProvider: 'local-python',
      fallbackProviders: ['openai-compatible', 'openai-compatible', 'local-python'],
    });
    // Should not contain duplicates or the default provider
    const unique = new Set(result.fallbackProviders);
    assert.equal(result.fallbackProviders.length, unique.size);
    assert.ok(!result.fallbackProviders.includes(result.defaultProvider));
  });

  await t.test('mergeUserSettings deep-merges nested objects', () => {
    const base = getDefaultSettings();
    const result = mergeUserSettings(base, {
      llm: { apiKey: 'test-key' } as any,
    });
    // Should keep base values for other llm fields
    assert.equal(result.llm?.apiKey, 'test-key');
    assert.equal(result.llm?.baseUrl, base.llm.baseUrl);
    assert.equal(result.llm?.model, base.llm.model);
  });

  await t.test('sanitizeUserSettings strips trailing slashes from URLs', () => {
    const result = sanitizeUserSettings({
      llm: {
        baseUrl: 'https://api.example.com/v1/',
        apiKey: 'test',
        model: 'gpt-4',
      },
      openaiWhisper: {
        enabled: true,
        baseUrl: 'https://whisper.example.com/',
        apiKey: 'test',
        model: 'whisper-1',
        transcriptionPath: '/audio/transcriptions',
        translationPath: '/audio/translations',
        responseFormat: 'verbose_json',
        disableTimestampGranularities: false,
      },
    });
    assert.ok(!result.llm.baseUrl.endsWith('/'));
    assert.ok(!result.openaiWhisper.baseUrl.endsWith('/'));
  });
});

/**
 * Keyword search for text written without spaces (Chinese, Japanese).
 *
 * SQLite: rewrite the FTS table so every CJK character is its own token (separated by an
 * invisible U+200B). Keep this in sync with toFtsIndexText() in lib/search/search-terms.ts.
 *
 * PostgreSQL: keyword search uses ILIKE on the tasks table. Add pg_trgm GIN indexes when the
 * extension can be enabled; without them search still works, it just scans.
 *
 * @param {import('knex').Knex} knex
 */

const SEPARATOR = '​';
const CJK = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}';
const CJK_BOUNDARY = new RegExp(`(?<=[${CJK}])(?=\\S)|(?<=\\S)(?=[${CJK}])`, 'gu');
const BATCH_SIZE = 500;

function toFtsIndexText(text) {
  return String(text || '').replace(/​/g, '').replace(CJK_BOUNDARY, SEPARATOR);
}

function tagsText(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.join(' ') : '';
  } catch {
    return '';
  }
}

const TRGM_INDEXES = [
  ['idx_tasks_trgm_original_name', 'originalName'],
  ['idx_tasks_trgm_summary', 'summary'],
  ['idx_tasks_trgm_transcript', 'transcript'],
  ['idx_tasks_trgm_tags', 'tags'],
];

async function rebuildSqliteFts(knex, transform) {
  await knex.raw('DELETE FROM task_chunk_fts');

  for (let offset = 0; ; offset += BATCH_SIZE) {
    const rows = await knex('task_chunks')
      .innerJoin('tasks', 'tasks.id', 'task_chunks.taskId')
      .whereNull('task_chunks.parentId')
      .orderBy('task_chunks.id')
      .offset(offset)
      .limit(BATCH_SIZE)
      .select(
        'task_chunks.id as taskChunkId',
        'task_chunks.taskId as taskId',
        'task_chunks.userId as userId',
        'task_chunks.workspaceId as workspaceId',
        'tasks.originalName as title',
        'tasks.summary as summary',
        'tasks.tags as tags',
        'task_chunks.content as content',
      );

    for (const row of rows) {
      await knex.raw(
        'INSERT INTO task_chunk_fts (taskChunkId, taskId, userId, workspaceId, title, summary, tags, content) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [
          row.taskChunkId,
          row.taskId,
          row.userId,
          row.workspaceId,
          transform(row.title),
          transform(row.summary),
          transform(tagsText(row.tags)),
          transform(row.content),
        ],
      );
    }

    if (rows.length < BATCH_SIZE) break;
  }
}

exports.up = async function up(knex) {
  if (knex.client.config.client === 'pg') {
    // Creating an extension needs elevated rights on some hosts; skip the indexes rather than
    // failing the deployment.
    await knex.raw(`
      DO $$
      BEGIN
        CREATE EXTENSION IF NOT EXISTS pg_trgm;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'pg_trgm is not available (%); keyword search will run without trigram indexes.', SQLERRM;
      END
      $$;
    `);
    const result = await knex.raw("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') AS enabled");
    if (!result.rows[0]?.enabled) return;

    for (const [name, column] of TRGM_INDEXES) {
      await knex.raw(`CREATE INDEX IF NOT EXISTS ${name} ON tasks USING gin ("${column}" gin_trgm_ops)`);
    }
    return;
  }

  await rebuildSqliteFts(knex, toFtsIndexText);
};

exports.down = async function down(knex) {
  if (knex.client.config.client === 'pg') {
    for (const [name] of TRGM_INDEXES) {
      await knex.raw(`DROP INDEX IF EXISTS ${name}`);
    }
    return;
  }

  await rebuildSqliteFts(knex, (text) => String(text || ''));
};

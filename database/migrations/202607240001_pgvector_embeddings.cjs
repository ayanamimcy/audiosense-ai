exports.up = async function up(knex) {
  if (knex.client.config.client !== 'pg') {
    return;
  }

  const extensionResult = await knex.raw(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_extension
      WHERE extname = 'vector'
    ) AS enabled
  `);
  if (!extensionResult.rows[0]?.enabled) {
    throw new Error(
      'pgvector is not enabled in the current database. Connect as a database administrator and run: CREATE EXTENSION vector;',
    );
  }

  const dimensions = Number.parseInt(process.env.EMBEDDING_DIMENSIONS || '1536', 10);
  if (!Number.isSafeInteger(dimensions) || dimensions <= 0 || dimensions > 4000) {
    throw new Error('EMBEDDING_DIMENSIONS must be an integer between 1 and 4000 for HNSW halfvec indexing.');
  }

  const hasVectorColumn = await knex.schema.hasColumn('task_chunks', 'embeddingVector');
  if (!hasVectorColumn) {
    await knex.raw(`ALTER TABLE task_chunks ADD COLUMN "embeddingVector" halfvec(${dimensions})`);
  }

  await knex.raw(`
    UPDATE task_chunks
    SET "embeddingVector" = embedding::halfvec
    WHERE embedding IS NOT NULL
      AND "embeddingVector" IS NULL
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_task_chunks_embedding_hnsw
    ON task_chunks
    USING hnsw ("embeddingVector" halfvec_cosine_ops)
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_task_chunks_vector_scope
    ON task_chunks ("userId", "workspaceId", "embeddingModel")
    WHERE "embeddingVector" IS NOT NULL
  `);

  // PostgreSQL uses the native vector column; retain JSON only on SQLite.
  await knex('task_chunks')
    .whereNotNull('embeddingVector')
    .update({ embedding: null });
};

exports.down = async function down(knex) {
  if (knex.client.config.client !== 'pg') {
    return;
  }

  const hasVectorColumn = await knex.schema.hasColumn('task_chunks', 'embeddingVector');
  if (hasVectorColumn) {
    await knex.raw('ALTER TABLE task_chunks DROP COLUMN "embeddingVector"');
  }
};

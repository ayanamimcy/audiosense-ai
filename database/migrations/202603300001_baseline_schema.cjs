async function ensureColumn(knex, tableName, columnName, alter) {
  const hasColumn = await knex.schema.hasColumn(tableName, columnName);
  if (!hasColumn) {
    await knex.schema.alterTable(tableName, alter);
  }
}

async function ensureIndex(knex, tableName, indexName, columns, unique = false) {
  try {
    await knex.schema.alterTable(tableName, (table) => {
      if (unique) {
        table.unique(columns, { indexName });
      } else {
        table.index(columns, indexName);
      }
    });
  } catch {
    // Ignore duplicate index creation when baselining an existing database.
  }
}

async function ensureSqliteFts(knex) {
  if (knex.client.config.client !== 'sqlite3') {
    return;
  }

  await knex.raw(
    `CREATE VIRTUAL TABLE IF NOT EXISTS task_chunk_fts USING fts5(
      taskChunkId UNINDEXED,
      taskId UNINDEXED,
      userId UNINDEXED,
      title,
      summary,
      tags,
      content
    )`,
  );
}

exports.up = async function up(knex) {
  const hasUsers = await knex.schema.hasTable('users');
  if (!hasUsers) {
    await knex.schema.createTable('users', (table) => {
      table.string('id').primary();
      table.string('name').notNullable();
      table.string('email').notNullable().unique();
      table.string('passwordHash').notNullable();
      table.bigInteger('createdAt').notNullable();
    });
  }

  const hasSessions = await knex.schema.hasTable('sessions');
  if (!hasSessions) {
    await knex.schema.createTable('sessions', (table) => {
      table.string('id').primary();
      table.string('userId').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.string('tokenHash').notNullable().unique();
      table.bigInteger('expiresAt').notNullable();
      table.bigInteger('createdAt').notNullable();
      table.bigInteger('lastSeenAt').notNullable();
    });
  }

  const hasUserSettings = await knex.schema.hasTable('user_settings');
  if (!hasUserSettings) {
    await knex.schema.createTable('user_settings', (table) => {
      table.string('userId').primary().references('id').inTable('users').onDelete('CASCADE');
      table.text('settings').notNullable();
      table.bigInteger('createdAt').notNullable();
      table.bigInteger('updatedAt').notNullable();
    });
  }

  const hasProviderHealth = await knex.schema.hasTable('provider_health');
  if (!hasProviderHealth) {
    await knex.schema.createTable('provider_health', (table) => {
      table.string('provider').primary();
      table.integer('failureCount').notNullable().defaultTo(0);
      table.integer('successCount').notNullable().defaultTo(0);
      table.bigInteger('circuitOpenUntil');
      table.bigInteger('lastFailureAt');
      table.text('lastError');
      table.bigInteger('updatedAt').notNullable();
    });
  }

  const hasNotebooks = await knex.schema.hasTable('notebooks');
  if (!hasNotebooks) {
    await knex.schema.createTable('notebooks', (table) => {
      table.string('id').primary();
      table.string('userId').references('id').inTable('users').onDelete('CASCADE');
      table.string('name').notNullable();
      table.string('description');
      table.string('color');
      table.bigInteger('createdAt').notNullable();
    });
  } else {
    await ensureColumn(knex, 'notebooks', 'userId', (table) => {
      table.string('userId').references('id').inTable('users').onDelete('CASCADE');
    });
    await ensureColumn(knex, 'notebooks', 'description', (table) => {
      table.string('description');
    });
    await ensureColumn(knex, 'notebooks', 'color', (table) => {
      table.string('color');
    });
  }

  const hasTasks = await knex.schema.hasTable('tasks');
  if (!hasTasks) {
    await knex.schema.createTable('tasks', (table) => {
      table.string('id').primary();
      table.string('userId').references('id').inTable('users').onDelete('CASCADE');
      table.string('filename').notNullable();
      table.string('originalName').notNullable();
      table.string('status').notNullable();
      table.text('result');
      table.text('transcript');
      table.text('summary');
      table.text('summaryPrompt');
      table.text('segments');
      table.text('speakers');
      table.text('metadata');
      table.bigInteger('createdAt').notNullable();
      table.string('notebookId').references('id').inTable('notebooks').onDelete('SET NULL');
      table.bigInteger('eventDate');
      table.text('tags');
      table.string('language');
      table.string('provider');
      table.string('sourceType');
      table.float('durationSeconds');
      table.bigInteger('startedAt');
      table.bigInteger('completedAt');
      table.bigInteger('updatedAt');
    });
  } else {
    await ensureColumn(knex, 'tasks', 'userId', (table) => {
      table.string('userId').references('id').inTable('users').onDelete('CASCADE');
    });
    await ensureColumn(knex, 'tasks', 'transcript', (table) => {
      table.text('transcript');
    });
    await ensureColumn(knex, 'tasks', 'summary', (table) => {
      table.text('summary');
    });
    await ensureColumn(knex, 'tasks', 'summaryPrompt', (table) => {
      table.text('summaryPrompt');
    });
    await ensureColumn(knex, 'tasks', 'segments', (table) => {
      table.text('segments');
    });
    await ensureColumn(knex, 'tasks', 'speakers', (table) => {
      table.text('speakers');
    });
    await ensureColumn(knex, 'tasks', 'metadata', (table) => {
      table.text('metadata');
    });
    await ensureColumn(knex, 'tasks', 'language', (table) => {
      table.string('language');
    });
    await ensureColumn(knex, 'tasks', 'provider', (table) => {
      table.string('provider');
    });
    await ensureColumn(knex, 'tasks', 'sourceType', (table) => {
      table.string('sourceType');
    });
    await ensureColumn(knex, 'tasks', 'durationSeconds', (table) => {
      table.float('durationSeconds');
    });
    await ensureColumn(knex, 'tasks', 'startedAt', (table) => {
      table.bigInteger('startedAt');
    });
    await ensureColumn(knex, 'tasks', 'completedAt', (table) => {
      table.bigInteger('completedAt');
    });
    await ensureColumn(knex, 'tasks', 'updatedAt', (table) => {
      table.bigInteger('updatedAt');
    });
  }

  const hasMessages = await knex.schema.hasTable('task_messages');
  if (!hasMessages) {
    await knex.schema.createTable('task_messages', (table) => {
      table.string('id').primary();
      table.string('taskId').notNullable().references('id').inTable('tasks').onDelete('CASCADE');
      table.string('role').notNullable();
      table.text('content').notNullable();
      table.bigInteger('createdAt').notNullable();
    });
  }

  const hasJobs = await knex.schema.hasTable('task_jobs');
  if (!hasJobs) {
    await knex.schema.createTable('task_jobs', (table) => {
      table.string('id').primary();
      table.string('taskId').notNullable().references('id').inTable('tasks').onDelete('CASCADE');
      table.string('userId').references('id').inTable('users').onDelete('CASCADE');
      table.string('status').notNullable();
      table.string('provider').notNullable();
      table.integer('attemptCount').notNullable().defaultTo(0);
      table.text('payload');
      table.text('lastError');
      table.bigInteger('runAfter').notNullable();
      table.bigInteger('lockedAt');
      table.string('workerId');
      table.bigInteger('createdAt').notNullable();
      table.bigInteger('updatedAt').notNullable();
    });
  }

  const hasSummaryPrompts = await knex.schema.hasTable('summary_prompts');
  if (!hasSummaryPrompts) {
    await knex.schema.createTable('summary_prompts', (table) => {
      table.string('id').primary();
      table.string('userId').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.string('name').notNullable();
      table.text('prompt').notNullable();
      table.text('notebookIds');
      table.boolean('isDefault').notNullable().defaultTo(false);
      table.bigInteger('createdAt').notNullable();
      table.bigInteger('updatedAt').notNullable();
    });
  } else {
    await ensureColumn(knex, 'summary_prompts', 'notebookIds', (table) => {
      table.text('notebookIds');
    });
    await ensureColumn(knex, 'summary_prompts', 'isDefault', (table) => {
      table.boolean('isDefault').notNullable().defaultTo(false);
    });
    await ensureColumn(knex, 'summary_prompts', 'updatedAt', (table) => {
      table.bigInteger('updatedAt');
    });
    await knex('summary_prompts')
      .whereNull('updatedAt')
      .update({
        updatedAt: knex.raw('COALESCE("createdAt", ?)', [Date.now()]),
      })
      .catch(() => {});
  }

  const hasTaskChunks = await knex.schema.hasTable('task_chunks');
  if (!hasTaskChunks) {
    await knex.schema.createTable('task_chunks', (table) => {
      table.string('id').primary();
      table.string('taskId').notNullable().references('id').inTable('tasks').onDelete('CASCADE');
      table.string('userId').references('id').inTable('users').onDelete('CASCADE');
      table.integer('chunkIndex').notNullable();
      table.text('content').notNullable();
      table.text('embedding');
      table.string('embeddingModel');
      table.bigInteger('createdAt').notNullable();
      table.bigInteger('updatedAt').notNullable();
    });
  } else {
    await ensureColumn(knex, 'task_chunks', 'embedding', (table) => {
      table.text('embedding');
    });
    await ensureColumn(knex, 'task_chunks', 'embeddingModel', (table) => {
      table.string('embeddingModel');
    });
  }

  await ensureIndex(knex, 'notebooks', 'idx_notebooks_user_created', ['userId', 'createdAt']);
  await ensureIndex(knex, 'tasks', 'idx_tasks_user_created', ['userId', 'createdAt']);
  await ensureIndex(knex, 'tasks', 'idx_tasks_user_notebook', ['userId', 'notebookId']);
  await ensureIndex(knex, 'task_messages', 'idx_task_messages_task_created', ['taskId', 'createdAt']);
  await ensureIndex(knex, 'task_jobs', 'idx_task_jobs_status_run_after', ['status', 'runAfter']);
  await ensureIndex(knex, 'sessions', 'idx_sessions_user_expires', ['userId', 'expiresAt']);
  await ensureIndex(knex, 'task_chunks', 'idx_task_chunks_task_index', ['taskId', 'chunkIndex']);
  await ensureIndex(knex, 'task_chunks', 'idx_task_chunks_user', ['userId']);
  await ensureIndex(knex, 'summary_prompts', 'idx_summary_prompts_user_updated', ['userId', 'updatedAt']);

  await ensureSqliteFts(knex);
};

exports.down = async function down(knex) {
  if (knex.client.config.client === 'sqlite3') {
    await knex.raw('DROP TABLE IF EXISTS task_chunk_fts');
  }

  await knex.schema.dropTableIfExists('task_chunks');
  await knex.schema.dropTableIfExists('summary_prompts');
  await knex.schema.dropTableIfExists('task_jobs');
  await knex.schema.dropTableIfExists('task_messages');
  await knex.schema.dropTableIfExists('tasks');
  await knex.schema.dropTableIfExists('notebooks');
  await knex.schema.dropTableIfExists('provider_health');
  await knex.schema.dropTableIfExists('user_settings');
  await knex.schema.dropTableIfExists('sessions');
  await knex.schema.dropTableIfExists('users');
};

const { randomUUID } = require('crypto');

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
    // Ignore duplicate index creation when a baseline DB already has the index.
  }
}

async function ensureWorkspaceTable(knex) {
  const hasWorkspaces = await knex.schema.hasTable('workspaces');
  if (!hasWorkspaces) {
    await knex.schema.createTable('workspaces', (table) => {
      table.string('id').primary();
      table.string('userId').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.string('name').notNullable();
      table.string('description');
      table.string('color');
      table.bigInteger('createdAt').notNullable();
      table.bigInteger('updatedAt').notNullable();
    });
  } else {
    await ensureColumn(knex, 'workspaces', 'description', (table) => {
      table.string('description');
    });
    await ensureColumn(knex, 'workspaces', 'color', (table) => {
      table.string('color');
    });
    await ensureColumn(knex, 'workspaces', 'updatedAt', (table) => {
      table.bigInteger('updatedAt');
    });
  }
}

async function ensureWorkspaceColumns(knex) {
  await ensureColumn(knex, 'notebooks', 'workspaceId', (table) => {
    table.string('workspaceId').references('id').inTable('workspaces').onDelete('CASCADE');
  });
  await ensureColumn(knex, 'tasks', 'workspaceId', (table) => {
    table.string('workspaceId').references('id').inTable('workspaces').onDelete('CASCADE');
  });
  await ensureColumn(knex, 'task_chunks', 'workspaceId', (table) => {
    table.string('workspaceId').references('id').inTable('workspaces').onDelete('CASCADE');
  });
  await ensureColumn(knex, 'knowledge_conversations', 'workspaceId', (table) => {
    table.string('workspaceId').references('id').inTable('workspaces').onDelete('CASCADE');
  });
  await ensureColumn(knex, 'summary_prompts', 'workspaceId', (table) => {
    table.string('workspaceId').references('id').inTable('workspaces').onDelete('CASCADE');
  });
}

async function ensureDefaultWorkspaces(knex) {
  const now = Date.now();
  const users = await knex('users').select('id');

  for (const user of users) {
    const existing = await knex('workspaces')
      .where({ userId: user.id })
      .orderBy('createdAt', 'asc')
      .first();

    if (!existing) {
      await knex('workspaces').insert({
        id: randomUUID(),
        userId: user.id,
        name: 'Default Workspace',
        description: null,
        color: '#4f46e5',
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}

async function buildWorkspaceMap(knex) {
  const rows = await knex('workspaces')
    .select('id', 'userId')
    .orderBy([{ column: 'userId', order: 'asc' }, { column: 'createdAt', order: 'asc' }]);
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.userId)) {
      map.set(row.userId, row.id);
    }
  }
  return map;
}

async function backfillWorkspaceIds(knex, workspaceMap) {
  for (const [userId, workspaceId] of workspaceMap.entries()) {
    await knex('notebooks').where({ userId }).whereNull('workspaceId').update({ workspaceId });
    await knex('tasks').where({ userId }).whereNull('workspaceId').update({ workspaceId });
    await knex('knowledge_conversations').where({ userId }).whereNull('workspaceId').update({ workspaceId });
    await knex('summary_prompts').where({ userId }).whereNull('workspaceId').update({ workspaceId });
  }

  if (await knex.schema.hasColumn('task_chunks', 'workspaceId')) {
    if (knex.client.config.client === 'sqlite3') {
      await knex.raw(`
        UPDATE task_chunks
        SET workspaceId = (
          SELECT tasks.workspaceId
          FROM tasks
          WHERE tasks.id = task_chunks.taskId
        )
        WHERE workspaceId IS NULL
      `);
    } else {
      await knex.raw(`
        UPDATE task_chunks
        SET "workspaceId" = tasks."workspaceId"
        FROM tasks
        WHERE tasks.id = task_chunks."taskId"
          AND task_chunks."workspaceId" IS NULL
      `);
    }
  }
}

async function rebuildSqliteFts(knex) {
  if (knex.client.config.client !== 'sqlite3') {
    return;
  }

  await knex.raw('DROP TABLE IF EXISTS task_chunk_fts');
  await knex.raw(
    `CREATE VIRTUAL TABLE task_chunk_fts USING fts5(
      taskChunkId UNINDEXED,
      taskId UNINDEXED,
      userId UNINDEXED,
      workspaceId UNINDEXED,
      title,
      summary,
      tags,
      content
    )`,
  );

  await knex.raw(`
    INSERT INTO task_chunk_fts (taskChunkId, taskId, userId, workspaceId, title, summary, tags, content)
    SELECT
      task_chunks.id,
      task_chunks.taskId,
      task_chunks.userId,
      task_chunks.workspaceId,
      tasks.originalName,
      COALESCE(tasks.summary, ''),
      COALESCE(tasks.tags, ''),
      task_chunks.content
    FROM task_chunks
    INNER JOIN tasks ON tasks.id = task_chunks.taskId
  `);
}

exports.up = async function up(knex) {
  await ensureWorkspaceTable(knex);
  await ensureWorkspaceColumns(knex);
  await ensureDefaultWorkspaces(knex);

  const workspaceMap = await buildWorkspaceMap(knex);
  await backfillWorkspaceIds(knex, workspaceMap);
  await rebuildSqliteFts(knex);

  await ensureIndex(knex, 'workspaces', 'idx_workspaces_user_updated', ['userId', 'updatedAt']);
  await ensureIndex(knex, 'notebooks', 'idx_notebooks_user_workspace_created', ['userId', 'workspaceId', 'createdAt']);
  await ensureIndex(knex, 'tasks', 'idx_tasks_user_workspace_created', ['userId', 'workspaceId', 'createdAt']);
  await ensureIndex(knex, 'tasks', 'idx_tasks_user_workspace_notebook', ['userId', 'workspaceId', 'notebookId']);
  await ensureIndex(knex, 'task_chunks', 'idx_task_chunks_user_workspace', ['userId', 'workspaceId']);
  await ensureIndex(knex, 'task_chunks', 'idx_task_chunks_workspace_task', ['workspaceId', 'taskId']);
  await ensureIndex(knex, 'knowledge_conversations', 'idx_knowledge_conversations_user_workspace_updated', ['userId', 'workspaceId', 'updatedAt']);
  await ensureIndex(knex, 'summary_prompts', 'idx_summary_prompts_user_workspace_updated', ['userId', 'workspaceId', 'updatedAt']);
};

exports.down = async function down(knex) {
  if (knex.client.config.client === 'sqlite3') {
    await knex.raw('DROP TABLE IF EXISTS task_chunk_fts');
    await knex.raw(
      `CREATE VIRTUAL TABLE task_chunk_fts USING fts5(
        taskChunkId UNINDEXED,
        taskId UNINDEXED,
        userId UNINDEXED,
        title,
        summary,
        tags,
        content
      )`,
    );
    await knex.raw(`
      INSERT INTO task_chunk_fts (taskChunkId, taskId, userId, title, summary, tags, content)
      SELECT
        task_chunks.id,
        task_chunks.taskId,
        task_chunks.userId,
        tasks.originalName,
        COALESCE(tasks.summary, ''),
        COALESCE(tasks.tags, ''),
        task_chunks.content
      FROM task_chunks
      INNER JOIN tasks ON tasks.id = task_chunks.taskId
    `);
  }

  const dropColumnIfExists = async (tableName, columnName) => {
    const hasColumn = await knex.schema.hasColumn(tableName, columnName);
    if (hasColumn) {
      await knex.schema.alterTable(tableName, (table) => {
        table.dropColumn(columnName);
      });
    }
  };

  await dropColumnIfExists('summary_prompts', 'workspaceId');
  await dropColumnIfExists('knowledge_conversations', 'workspaceId');
  await dropColumnIfExists('task_chunks', 'workspaceId');
  await dropColumnIfExists('tasks', 'workspaceId');
  await dropColumnIfExists('notebooks', 'workspaceId');
  await knex.schema.dropTableIfExists('workspaces');
};

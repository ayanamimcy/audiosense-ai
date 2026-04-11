/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasConversations = await knex.schema.hasTable('knowledge_conversations');
  if (!hasConversations) {
    await knex.schema.createTable('knowledge_conversations', (table) => {
      table.string('id').primary();
      table.string('userId').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.string('title').notNullable().defaultTo('New conversation');
      table.bigInteger('createdAt').notNullable();
      table.bigInteger('updatedAt').notNullable();
      table.index(['userId', 'updatedAt']);
    });
  }

  const hasMessages = await knex.schema.hasTable('knowledge_messages');
  if (!hasMessages) {
    await knex.schema.createTable('knowledge_messages', (table) => {
      table.string('id').primary();
      table.string('conversationId').notNullable().references('id').inTable('knowledge_conversations').onDelete('CASCADE');
      table.string('role').notNullable();
      table.text('content').notNullable();
      table.text('mentions');
      table.text('metadata');
      table.bigInteger('createdAt').notNullable();
      table.index(['conversationId', 'createdAt']);
    });
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('knowledge_messages');
  await knex.schema.dropTableIfExists('knowledge_conversations');
};

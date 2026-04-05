/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasQueueState = await knex.schema.hasTable('queue_state');
  if (!hasQueueState) {
    await knex.schema.createTable('queue_state', (table) => {
      table.string('queueName').primary();
      table.boolean('paused').notNullable().defaultTo(false);
      table.string('reason');
      table.string('blockedJobId');
      table.string('blockedTaskId');
      table.string('provider');
      table.text('lastError');
      table.bigInteger('resumeCheckAfter');
      table.bigInteger('updatedAt').notNullable();
    });
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('queue_state');
};

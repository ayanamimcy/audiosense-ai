/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('task_associations');
  if (!hasTable) {
    await knex.schema.createTable('task_associations', (table) => {
      table.string('id').primary();
      table.string('userId').notNullable().references('id').inTable('users').onDelete('CASCADE');
      // Canonical pair: taskIdA < taskIdB (enforced by application code)
      table.string('taskIdA').notNullable().references('id').inTable('tasks').onDelete('CASCADE');
      table.string('taskIdB').notNullable().references('id').inTable('tasks').onDelete('CASCADE');
      table.float('score').notNullable();
      table.bigInteger('createdAt').notNullable();
      table.index(['userId', 'taskIdA']);
      table.index(['userId', 'taskIdB']);
      table.unique(['userId', 'taskIdA', 'taskIdB']);
    });
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('task_associations');
};

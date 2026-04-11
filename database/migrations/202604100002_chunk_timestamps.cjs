/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasStartTime = await knex.schema.hasColumn('task_chunks', 'startTime');
  if (!hasStartTime) {
    await knex.schema.alterTable('task_chunks', (table) => {
      table.float('startTime').nullable();
      table.float('endTime').nullable();
    });
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const hasStartTime = await knex.schema.hasColumn('task_chunks', 'startTime');
  if (hasStartTime) {
    await knex.schema.alterTable('task_chunks', (table) => {
      table.dropColumn('startTime');
      table.dropColumn('endTime');
    });
  }
};

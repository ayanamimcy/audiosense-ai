/**
 * Add unique constraint to task_associations if it doesn't exist.
 * Fixes: ON CONFLICT ("userId", "taskIdA", "taskIdB") requires a matching unique constraint.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  try {
    await knex.schema.alterTable('task_associations', (table) => {
      table.unique(['userId', 'taskIdA', 'taskIdB']);
    });
  } catch (_err) {
    // Constraint already exists — safe to ignore
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  try {
    await knex.schema.alterTable('task_associations', (table) => {
      table.dropUnique(['userId', 'taskIdA', 'taskIdB']);
    });
  } catch (_err) {
    // Ignore if constraint doesn't exist
  }
};

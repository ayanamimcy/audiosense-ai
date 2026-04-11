/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasParentId = await knex.schema.hasColumn('task_chunks', 'parentId');
  if (!hasParentId) {
    await knex.schema.alterTable('task_chunks', (table) => {
      // null for parent chunks, points to parent's id for child chunks
      table.string('parentId').nullable();
      table.index(['parentId']);
    });
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const hasParentId = await knex.schema.hasColumn('task_chunks', 'parentId');
  if (hasParentId) {
    await knex.schema.alterTable('task_chunks', (table) => {
      table.dropColumn('parentId');
    });
  }
};

/**
 * Each notebook can pick its own default summary template. NULL means the notebook uses the
 * workspace default.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('notebooks', 'defaultSummaryPromptId');
  if (!hasColumn) {
    await knex.schema.alterTable('notebooks', (table) => {
      table.string('defaultSummaryPromptId').nullable();
    });
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const hasColumn = await knex.schema.hasColumn('notebooks', 'defaultSummaryPromptId');
  if (hasColumn) {
    await knex.schema.alterTable('notebooks', (table) => {
      table.dropColumn('defaultSummaryPromptId');
    });
  }
};

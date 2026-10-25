/**
 * One row per LLM request: what ran, how long it took and what it used.
 * Prompt and response text are deliberately not stored — recordings are private.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable('llm_calls');
  if (exists) return;

  await knex.schema.createTable('llm_calls', (table) => {
    table.string('id').primary();
    table.string('userId').references('id').inTable('users').onDelete('CASCADE');
    table.string('taskId');
    table.string('operation').notNullable(); // summary | tag_suggestion | task_chat | knowledge_chat
    table.string('model').notNullable();
    table.string('providerHost'); // host of the base URL only, never the key
    table.string('promptVersion').notNullable(); // operation@<hash of the prompt template>
    table.boolean('streamed').notNullable().defaultTo(false);
    table.string('status').notNullable(); // ok | error | cancelled
    table.string('errorCategory'); // timeout | rate_limited | auth | client | server | network | empty_response | other
    table.integer('httpStatus');
    table.integer('latencyMs').notNullable();
    table.integer('firstTokenMs'); // streams only: time until the first delta arrived
    table.integer('inputTokens');
    table.integer('outputTokens');
    table.string('usageSource').notNullable(); // provider | estimated
    table.integer('inputChars').notNullable();
    table.integer('outputChars').notNullable();
    table.bigInteger('createdAt').notNullable();
    table.index(['userId', 'createdAt']);
    table.index(['taskId']);
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('llm_calls');
};

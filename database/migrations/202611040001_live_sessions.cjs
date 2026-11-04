/**
 * Live caption sessions in progress. While one has a recent heartbeat, the transcription
 * worker does not start new jobs, so the GPU is free for real-time captions. A session whose
 * process died simply stops heartbeating and is ignored, so a crash cannot stall the queue.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable('live_sessions');
  if (exists) return;

  await knex.schema.createTable('live_sessions', (table) => {
    table.string('id').primary();
    table.string('userId').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.bigInteger('startedAt').notNullable();
    table.bigInteger('heartbeatAt').notNullable();
    table.index(['heartbeatAt']);
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('live_sessions');
};

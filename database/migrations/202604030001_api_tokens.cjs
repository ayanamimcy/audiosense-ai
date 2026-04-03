exports.up = async function up(knex) {
  await knex.schema.createTable('api_tokens', (table) => {
    table.string('id').primary();
    table.string('userId').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('name').notNullable();
    table.string('tokenHash').notNullable().unique();
    table.text('scopes').notNullable();
    table.bigInteger('expiresAt');
    table.bigInteger('createdAt').notNullable();
    table.bigInteger('lastUsedAt');

    table.index(['userId', 'createdAt'], 'idx_api_tokens_user_created');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('api_tokens');
};

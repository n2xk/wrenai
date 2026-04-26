exports.up = async function (knex) {
  await knex.schema.alterTable('sql_pair', (table) => {
    table.timestamp('effective_from').nullable();
    table.timestamp('effective_to').nullable();
    table.string('approved_by').nullable();
    table.timestamp('approved_at').nullable();

    table.index(['effective_from']);
    table.index(['effective_to']);
    table.index(['approved_by']);
    table.index(['approved_at']);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('sql_pair', (table) => {
    table.dropIndex(['effective_from']);
    table.dropIndex(['effective_to']);
    table.dropIndex(['approved_by']);
    table.dropIndex(['approved_at']);

    table.dropColumn('effective_from');
    table.dropColumn('effective_to');
    table.dropColumn('approved_by');
    table.dropColumn('approved_at');
  });
};

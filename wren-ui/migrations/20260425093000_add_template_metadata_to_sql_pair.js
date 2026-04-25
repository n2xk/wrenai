exports.up = async function (knex) {
  await knex.schema.alterTable('sql_pair', (table) => {
    table.string('asset_kind').notNullable().defaultTo('sql_pair');
    table.string('template_level').notNullable().defaultTo('L0');
    table.string('template_mode').notNullable().defaultTo('reference');
    table.string('source_type').notNullable().defaultTo('user_saved');
    table.string('scope_type').notNullable().defaultTo('knowledge_base');
    table.jsonb('parameter_schema').nullable();
    table.jsonb('business_signature').nullable();
    table.integer('template_version').notNullable().defaultTo(1);
    table.string('status').notNullable().defaultTo('active');

    table.index(['asset_kind']);
    table.index(['template_level']);
    table.index(['template_mode']);
    table.index(['source_type']);
    table.index(['status']);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('sql_pair', (table) => {
    table.dropIndex(['asset_kind']);
    table.dropIndex(['template_level']);
    table.dropIndex(['template_mode']);
    table.dropIndex(['source_type']);
    table.dropIndex(['status']);

    table.dropColumn('asset_kind');
    table.dropColumn('template_level');
    table.dropColumn('template_mode');
    table.dropColumn('source_type');
    table.dropColumn('scope_type');
    table.dropColumn('parameter_schema');
    table.dropColumn('business_signature');
    table.dropColumn('template_version');
    table.dropColumn('status');
  });
};

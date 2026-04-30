exports.up = async function (knex) {
  await knex.schema.alterTable('knowledge_business_terms', (table) => {
    table
      .jsonb('applicable_scenarios')
      .notNullable()
      .defaultTo(knex.raw("'[]'::jsonb"));
    table
      .jsonb('not_applicable_scenarios')
      .notNullable()
      .defaultTo(knex.raw("'[]'::jsonb"));
    table
      .jsonb('required_slots')
      .notNullable()
      .defaultTo(knex.raw("'[]'::jsonb"));
  });

  await knex.schema.alterTable('knowledge_external_dependencies', (table) => {
    table
      .jsonb('trigger_when')
      .notNullable()
      .defaultTo(knex.raw("'[]'::jsonb"));
    table
      .jsonb('not_trigger_when')
      .notNullable()
      .defaultTo(knex.raw("'[]'::jsonb"));
    table.string('lifecycle').notNullable().defaultTo('per_question');
    table.jsonb('input_modes').notNullable().defaultTo(knex.raw("'[]'::jsonb"));
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('knowledge_external_dependencies', (table) => {
    table.dropColumn('input_modes');
    table.dropColumn('lifecycle');
    table.dropColumn('not_trigger_when');
    table.dropColumn('trigger_when');
  });

  await knex.schema.alterTable('knowledge_business_terms', (table) => {
    table.dropColumn('required_slots');
    table.dropColumn('not_applicable_scenarios');
    table.dropColumn('applicable_scenarios');
  });
};

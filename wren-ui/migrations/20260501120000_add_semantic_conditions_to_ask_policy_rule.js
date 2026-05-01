/**
 * Add structured semantic matching conditions for ask policy rules.
 *
 * These conditions are evaluated by AI service against SemanticPlan fields so
 * policies can target metrics/features/routes without relying only on keyword
 * substring cues.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('ask_policy_rule', (table) => {
    table
      .jsonb('semantic_conditions')
      .notNullable()
      .defaultTo(knex.raw("'{}'::jsonb"));
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('ask_policy_rule', (table) => {
    table.dropColumn('semantic_conditions');
  });
};

exports.up = async function (knex) {
  await knex.schema.alterTable('instruction', (table) => {
    table
      .jsonb('related_business_terms')
      .notNullable()
      .defaultTo(knex.raw("'[]'::jsonb"));
    table
      .jsonb('related_external_dependencies')
      .notNullable()
      .defaultTo(knex.raw("'[]'::jsonb"));
    table.jsonb('runtime_usage').nullable();
  });

  await knex.schema.createTable('knowledge_business_terms', (table) => {
    table.increments('id').primary();
    table.integer('project_id').nullable();
    table.string('workspace_id').nullable();
    table.string('knowledge_base_id').nullable();
    table.string('kb_snapshot_id').nullable();
    table.string('deploy_hash').nullable();
    table.string('actor_user_id').nullable();
    table.string('term_id').notNullable();
    table.string('name').notNullable();
    table.string('category').notNullable().defaultTo('metric');
    table.jsonb('aliases').notNullable().defaultTo(knex.raw("'[]'::jsonb"));
    table.text('definition').notNullable().defaultTo('');
    table.text('canonical_expression').nullable();
    table
      .jsonb('source_tables')
      .notNullable()
      .defaultTo(knex.raw("'[]'::jsonb"));
    table
      .jsonb('source_fields')
      .notNullable()
      .defaultTo(knex.raw("'[]'::jsonb"));
    table
      .jsonb('related_rules')
      .notNullable()
      .defaultTo(knex.raw("'[]'::jsonb"));
    table
      .jsonb('related_templates')
      .notNullable()
      .defaultTo(knex.raw("'[]'::jsonb"));
    table.jsonb('features').notNullable().defaultTo(knex.raw("'[]'::jsonb"));
    table
      .jsonb('conflict_terms')
      .notNullable()
      .defaultTo(knex.raw("'[]'::jsonb"));
    table.string('status').notNullable().defaultTo('active');
    table.string('created_by').nullable();
    table.string('updated_by').nullable();
    table.timestamps(true, true);

    table.foreign('project_id').references('project.id').onDelete('CASCADE');
    table
      .foreign('workspace_id')
      .references('id')
      .inTable('workspace')
      .onDelete('CASCADE');
    table
      .foreign('knowledge_base_id')
      .references('id')
      .inTable('knowledge_base')
      .onDelete('CASCADE');
    table.index(['project_id']);
    table.index(['workspace_id']);
    table.index(['knowledge_base_id']);
    table.index(['kb_snapshot_id']);
    table.index(['deploy_hash']);
    table.index(['term_id']);
    table.index(['category']);
    table.index(['status']);
    table.unique(['knowledge_base_id', 'term_id']);
  });

  await knex.schema.createTable('knowledge_external_dependencies', (table) => {
    table.increments('id').primary();
    table.integer('project_id').nullable();
    table.string('workspace_id').nullable();
    table.string('knowledge_base_id').nullable();
    table.string('kb_snapshot_id').nullable();
    table.string('deploy_hash').nullable();
    table.string('actor_user_id').nullable();
    table.string('dependency_id').notNullable();
    table.string('name').notNullable();
    table.jsonb('aliases').notNullable().defaultTo(knex.raw("'[]'::jsonb"));
    table.string('source_status').notNullable().defaultTo('missing');
    table.string('missing_behavior').notNullable().defaultTo('ask_user');
    table
      .jsonb('required_grain')
      .notNullable()
      .defaultTo(knex.raw("'[]'::jsonb"));
    table
      .jsonb('required_by_terms')
      .notNullable()
      .defaultTo(knex.raw("'[]'::jsonb"));
    table
      .jsonb('required_by_templates')
      .notNullable()
      .defaultTo(knex.raw("'[]'::jsonb"));
    table
      .jsonb('related_rules')
      .notNullable()
      .defaultTo(knex.raw("'[]'::jsonb"));
    table.text('ask_user_prompt').nullable();
    table.jsonb('validation').nullable();
    table.string('status').notNullable().defaultTo('active');
    table.string('created_by').nullable();
    table.string('updated_by').nullable();
    table.timestamps(true, true);

    table.foreign('project_id').references('project.id').onDelete('CASCADE');
    table
      .foreign('workspace_id')
      .references('id')
      .inTable('workspace')
      .onDelete('CASCADE');
    table
      .foreign('knowledge_base_id')
      .references('id')
      .inTable('knowledge_base')
      .onDelete('CASCADE');
    table.index(['project_id']);
    table.index(['workspace_id']);
    table.index(['knowledge_base_id']);
    table.index(['kb_snapshot_id']);
    table.index(['deploy_hash']);
    table.index(['dependency_id']);
    table.index(['source_status']);
    table.index(['missing_behavior']);
    table.index(['status']);
    table.unique(['knowledge_base_id', 'dependency_id']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('knowledge_external_dependencies');
  await knex.schema.dropTableIfExists('knowledge_business_terms');

  await knex.schema.alterTable('instruction', (table) => {
    table.dropColumn('related_business_terms');
    table.dropColumn('related_external_dependencies');
    table.dropColumn('runtime_usage');
  });
};

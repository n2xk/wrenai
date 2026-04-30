exports.up = async function (knex) {
  await knex.schema.createTable('ask_clarification_session', (table) => {
    table.increments('id').primary();
    table.string('session_id').notNullable().unique();

    table.integer('project_id').nullable();
    table.string('workspace_id').nullable();
    table.string('knowledge_base_id').nullable();
    table.string('kb_snapshot_id').nullable();
    table.string('deploy_hash').nullable();
    table.string('actor_user_id').nullable();

    table.integer('thread_id').nullable();
    table.integer('asking_task_id').nullable();
    table.string('status').notNullable().defaultTo('needs_clarification');
    table.text('original_question').nullable();
    table
      .jsonb('pending_slots')
      .notNullable()
      .defaultTo(knex.raw("'[]'::jsonb"));
    table
      .jsonb('resolved_slots')
      .notNullable()
      .defaultTo(knex.raw("'{}'::jsonb"));
    table
      .jsonb('clarification_state')
      .notNullable()
      .defaultTo(knex.raw("'{}'::jsonb"));
    table.timestamp('expires_at').nullable();
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
    table.foreign('thread_id').references('thread.id').onDelete('SET NULL');
    table
      .foreign('asking_task_id')
      .references('asking_task.id')
      .onDelete('SET NULL');

    table.index(['workspace_id', 'status']);
    table.index(['knowledge_base_id', 'status']);
    table.index(['thread_id']);
    table.index(['asking_task_id']);
    table.index(['expires_at']);
    table.index(['updated_at']);
  });

  await knex.schema.createTable('ask_policy_rule', (table) => {
    table.increments('id').primary();

    table.integer('project_id').nullable();
    table.string('workspace_id').notNullable();
    table.string('knowledge_base_id').nullable();
    table.string('actor_user_id').nullable();

    table.string('name').notNullable();
    table.string('status').notNullable().defaultTo('active');
    table.integer('version').notNullable().defaultTo(1);
    table
      .jsonb('query_contains_any')
      .notNullable()
      .defaultTo(knex.raw("'[]'::jsonb"));
    table
      .jsonb('template_ids')
      .notNullable()
      .defaultTo(knex.raw("'[]'::jsonb"));
    table
      .jsonb('forbidden_templates')
      .notNullable()
      .defaultTo(knex.raw("'[]'::jsonb"));
    table
      .jsonb('required_slots')
      .notNullable()
      .defaultTo(knex.raw("'[]'::jsonb"));
    table.string('reason_code').notNullable();
    table.text('description').nullable();
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

    table.index(['workspace_id', 'status']);
    table.index(['knowledge_base_id', 'status']);
    table.index(['updated_at']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('ask_policy_rule');
  await knex.schema.dropTableIfExists('ask_clarification_session');
};

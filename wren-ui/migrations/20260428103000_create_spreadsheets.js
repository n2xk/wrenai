exports.up = async function (knex) {
  await knex.schema.createTable('spreadsheet', (table) => {
    table.increments('id').primary();
    table.integer('project_id').nullable();
    table.string('workspace_id').nullable();
    table.string('knowledge_base_id').nullable();
    table.string('kb_snapshot_id').nullable();
    table.string('deploy_hash').nullable();
    table.string('actor_user_id').nullable();

    table.string('name').notNullable();
    table.text('sql').notNullable();
    table.string('sql_mode').nullable();
    table.text('matched_question').nullable();
    table.integer('matched_view_id').nullable();
    table.integer('source_thread_id').nullable();
    table.integer('source_response_id').nullable();

    table.integer('current_version').notNullable().defaultTo(1);
    table.boolean('is_shared').notNullable().defaultTo(false);
    table.string('folder_id').nullable();

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
    table
      .foreign('source_thread_id')
      .references('thread.id')
      .onDelete('SET NULL');
    table
      .foreign('source_response_id')
      .references('thread_response.id')
      .onDelete('SET NULL');
    table.foreign('matched_view_id').references('view.id').onDelete('SET NULL');

    table.index(['project_id']);
    table.index(['workspace_id']);
    table.index(['knowledge_base_id']);
    table.index(['kb_snapshot_id']);
    table.index(['deploy_hash']);
    table.index(['source_response_id']);
    table.index(['updated_at']);
  });

  await knex.schema.createTable('spreadsheet_setting', (table) => {
    table.increments('id').primary();
    table.integer('spreadsheet_id').notNullable();
    table
      .jsonb('hidden_columns')
      .notNullable()
      .defaultTo(knex.raw("'[]'::jsonb"));
    table
      .jsonb('pinned_columns')
      .notNullable()
      .defaultTo(knex.raw("'[]'::jsonb"));
    table
      .jsonb('unpinned_columns')
      .notNullable()
      .defaultTo(knex.raw("'[]'::jsonb"));
    table
      .jsonb('column_widths')
      .notNullable()
      .defaultTo(knex.raw("'{}'::jsonb"));
    table.timestamps(true, true);

    table
      .foreign('spreadsheet_id')
      .references('spreadsheet.id')
      .onDelete('CASCADE');
    table.unique(['spreadsheet_id']);
  });

  await knex.schema.createTable('spreadsheet_history', (table) => {
    table.increments('id').primary();
    table.integer('spreadsheet_id').notNullable();
    table.integer('version').notNullable();
    table.string('type').notNullable().defaultTo('SAVE');
    table.text('sql').notNullable();
    table.jsonb('payload').notNullable().defaultTo(knex.raw("'{}'::jsonb"));
    table.string('created_by').nullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());

    table
      .foreign('spreadsheet_id')
      .references('spreadsheet.id')
      .onDelete('CASCADE');
    table.unique(['spreadsheet_id', 'version']);
    table.index(['spreadsheet_id', 'created_at']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('spreadsheet_history');
  await knex.schema.dropTableIfExists('spreadsheet_setting');
  await knex.schema.dropTableIfExists('spreadsheet');
};

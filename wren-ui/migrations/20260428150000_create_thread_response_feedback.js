exports.up = async function (knex) {
  await knex.schema.createTable('thread_response_feedback', (table) => {
    table.increments('id').primary();
    table.integer('thread_response_id').notNullable();
    table.integer('thread_id').notNullable();

    table.integer('project_id').nullable();
    table.string('workspace_id').nullable();
    table.string('knowledge_base_id').nullable();
    table.string('kb_snapshot_id').nullable();
    table.string('deploy_hash').nullable();
    table.string('actor_user_id').nullable();

    table.string('rating').notNullable();
    table
      .jsonb('reason_codes')
      .notNullable()
      .defaultTo(knex.raw("'[]'::jsonb"));
    table.text('comment').nullable();
    table.string('source').notNullable().defaultTo('result_footer');
    table.jsonb('metadata').notNullable().defaultTo(knex.raw("'{}'::jsonb"));
    table.timestamps(true, true);

    table
      .foreign('thread_response_id')
      .references('thread_response.id')
      .onDelete('CASCADE');
    table.foreign('thread_id').references('thread.id').onDelete('CASCADE');
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

    table.index(['thread_response_id']);
    table.index(['thread_id']);
    table.index(['project_id']);
    table.index(['workspace_id']);
    table.index(['knowledge_base_id']);
    table.index(['kb_snapshot_id']);
    table.index(['deploy_hash']);
    table.index(['actor_user_id']);
    table.index(['rating']);
    table.index(['updated_at']);
  });

  await knex.raw(`
    CREATE UNIQUE INDEX thread_response_feedback_response_actor_unique
    ON thread_response_feedback (thread_response_id, COALESCE(actor_user_id, ''))
  `);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('thread_response_feedback');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.raw(`
    WITH ranked_dashboard_items AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY dashboard_id, type, detail->>'sourceResponseId'
          ORDER BY updated_at DESC NULLS LAST, id DESC
        ) AS row_number
      FROM dashboard_item
      WHERE detail->>'sourceResponseId' IS NOT NULL
    )
    DELETE FROM dashboard_item
    WHERE id IN (
      SELECT id
      FROM ranked_dashboard_items
      WHERE row_number > 1
    )
  `);

  await knex.raw(`
    WITH ranked_spreadsheets AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY source_response_id, COALESCE(actor_user_id, '')
          ORDER BY updated_at DESC NULLS LAST, id DESC
        ) AS row_number
      FROM spreadsheet
      WHERE source_response_id IS NOT NULL
    )
    DELETE FROM spreadsheet
    WHERE id IN (
      SELECT id
      FROM ranked_spreadsheets
      WHERE row_number > 1
    )
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS dashboard_item_source_response_unique
    ON dashboard_item (dashboard_id, type, (detail->>'sourceResponseId'))
    WHERE detail->>'sourceResponseId' IS NOT NULL
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS spreadsheet_source_response_actor_unique
    ON spreadsheet (source_response_id, COALESCE(actor_user_id, ''))
    WHERE source_response_id IS NOT NULL
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.raw('DROP INDEX IF EXISTS spreadsheet_source_response_actor_unique');
  await knex.raw('DROP INDEX IF EXISTS dashboard_item_source_response_unique');
};

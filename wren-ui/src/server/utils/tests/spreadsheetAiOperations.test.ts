import {
  buildStructuredSpreadsheetOperationSql,
  resolveStructuredSpreadsheetFilterCondition,
} from '../spreadsheetAiOperations';

describe('spreadsheet AI operation SQL helpers', () => {
  it('builds a structured equality filter with Trino-compatible identifiers', () => {
    expect(
      buildStructuredSpreadsheetOperationSql({
        operationType: 'FILTER',
        instruction: '只保留 biz_date 为 2026-04-05 的记录',
        sql: 'select * from login_daily;',
      }),
    ).toBe(
      `SELECT * FROM (select * from login_daily) AS spreadsheet_source WHERE "biz_date" = '2026-04-05'`,
    );
  });

  it('parses multiple deterministic filter conditions', () => {
    expect(
      resolveStructuredSpreadsheetFilterCondition(
        'tenant_id 为 990001 且 channel_id 为 990011 且 amount 大于等于 1000',
      ),
    ).toBe(
      '"tenant_id" = 990001 AND "channel_id" = 990011 AND "amount" >= 1000',
    );
  });

  it('parses ranges, in lists, null checks, not equals and contains filters', () => {
    expect(
      resolveStructuredSpreadsheetFilterCondition(
        'biz_date 从 2026-04-01 到 2026-04-07 且 channel_id 为 990011、990012 且 user_name 包含 vip 且 status 不等于 test 且 deleted_at 为空',
      ),
    ).toBe(
      '"biz_date" BETWEEN \'2026-04-01\' AND \'2026-04-07\' AND "channel_id" IN (990011, 990012) AND "user_name" LIKE \'%vip%\' AND "status" <> \'test\' AND "deleted_at" IS NULL',
    );
  });

  it('keeps raw where clauses as an explicit escape hatch', () => {
    expect(
      resolveStructuredSpreadsheetFilterCondition(
        "where platform_id = 990001 and biz_date >= date '2026-04-01';",
      ),
    ).toBe("platform_id = 990001 and biz_date >= date '2026-04-01'");
  });

  it('builds deterministic weekday/weekend enrichment for common date labeling', () => {
    expect(
      buildStructuredSpreadsheetOperationSql({
        operationType: 'ENRICHMENT',
        instruction: '增加一列，标记登录日期是工作日还是周末',
        sql: 'select biz_date, login_users from login_daily',
      }),
    ).toBe(
      `SELECT spreadsheet_source.*, CASE WHEN day_of_week(CAST(spreadsheet_source."biz_date" AS date)) IN (6, 7) THEN '周末' ELSE '工作日' END AS "day_type" FROM (select biz_date, login_users from login_daily) AS spreadsheet_source`,
    );
  });

  it('uses TiDB/MySQL weekday functions for dialect spreadsheet enrichment', () => {
    expect(
      buildStructuredSpreadsheetOperationSql({
        operationType: 'ENRICHMENT',
        instruction: '增加一列，标记登录日期是工作日还是周末',
        sql: 'select biz_date, login_users from login_daily',
        sqlMode: 'dialect',
      }),
    ).toBe(
      `SELECT spreadsheet_source.*, CASE WHEN DAYOFWEEK(CAST(spreadsheet_source."biz_date" AS DATE)) IN (1, 7) THEN '周末' ELSE '工作日' END AS "day_type" FROM (select biz_date, login_users from login_daily) AS spreadsheet_source`,
    );
  });

  it('returns null for unsupported instructions so the endpoint can fall back to AI rewrite', () => {
    expect(
      buildStructuredSpreadsheetOperationSql({
        operationType: 'FILTER',
        instruction: '帮我找一下最近表现异常的用户',
        sql: 'select * from login_daily',
      }),
    ).toBeNull();
  });
});

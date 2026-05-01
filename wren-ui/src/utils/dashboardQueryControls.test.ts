import {
  buildDashboardQueryControls,
  compileDashboardItemSql,
  detectDashboardTimeFilterCandidate,
  formatDashboardQueryControlsLabel,
  normalizeDashboardQueryControls,
  normalizeDashboardTimeFilterAiProposal,
} from './dashboardQueryControls';

describe('dashboardQueryControls', () => {
  it('detects a BETWEEN date range and compiles it as a rolling window', () => {
    const sql =
      "SELECT order_date, SUM(amount) FROM orders WHERE order_date BETWEEN '2026-04-03' AND '2026-04-07' GROUP BY order_date";
    const candidate = detectDashboardTimeFilterCandidate(sql, 'UTC');

    expect(candidate).toEqual(
      expect.objectContaining({
        field: 'order_date',
        originalStartDate: '2026-04-03',
        originalEndDate: '2026-04-07',
        windowDays: 5,
        sqlBinding: {
          kind: 'between',
          startLiteral: '2026-04-03',
          endLiteral: '2026-04-07',
        },
      }),
    );

    const queryControls = buildDashboardQueryControls({
      candidate: candidate!,
      mode: 'rolling_window',
      anchor: 'last_complete_day',
    });

    expect(
      compileDashboardItemSql({
        sql,
        queryControls,
        now: new Date('2026-05-01T12:00:00.000Z'),
      }),
    ).toContain("BETWEEN '2026-04-26' AND '2026-04-30'");
  });

  it('detects inclusive lower and exclusive upper bounds', () => {
    const sql =
      "SELECT * FROM orders WHERE created_at >= '2026-04-03' AND created_at < '2026-04-08'";
    const candidate = detectDashboardTimeFilterCandidate(sql, 'UTC');

    expect(candidate).toEqual(
      expect.objectContaining({
        field: 'created_at',
        originalStartDate: '2026-04-03',
        originalEndDate: '2026-04-08',
        windowDays: 5,
        sqlBinding: {
          kind: 'gte_lt',
          startLiteral: '2026-04-03',
          endLiteral: '2026-04-08',
        },
      }),
    );

    const queryControls = buildDashboardQueryControls({
      candidate: candidate!,
      mode: 'rolling_window',
      anchor: 'last_complete_day',
    });

    expect(
      compileDashboardItemSql({
        sql,
        queryControls,
        now: new Date('2026-05-01T12:00:00.000Z'),
      }),
    ).toContain("created_at >= '2026-04-26' AND created_at < '2026-05-01'");
  });

  it('detects DATE literals and date-cast field expressions', () => {
    const dateLiteralSql =
      "SELECT * FROM orders WHERE order_date BETWEEN DATE '2026-04-03' AND DATE '2026-04-07'";
    expect(detectDashboardTimeFilterCandidate(dateLiteralSql, 'UTC')).toEqual(
      expect.objectContaining({
        field: 'order_date',
        originalStartDate: '2026-04-03',
        originalEndDate: '2026-04-07',
      }),
    );

    const dateFunctionSql =
      "SELECT * FROM orders WHERE DATE(created_at) BETWEEN '2026-04-03' AND '2026-04-07'";
    expect(detectDashboardTimeFilterCandidate(dateFunctionSql, 'UTC')).toEqual(
      expect.objectContaining({
        field: 'DATE(created_at)',
        windowDays: 5,
      }),
    );

    const castSql =
      "SELECT * FROM orders WHERE CAST(created_at AS DATE) >= DATE '2026-04-03' AND CAST(created_at AS DATE) < DATE '2026-04-08'";
    expect(detectDashboardTimeFilterCandidate(castSql, 'UTC')).toEqual(
      expect.objectContaining({
        field: 'CAST(created_at AS DATE)',
        sqlBinding: expect.objectContaining({
          kind: 'gte_lt',
        }),
        windowDays: 5,
      }),
    );
  });

  it('preserves timestamp suffixes when compiling rolling windows', () => {
    const sql =
      "SELECT * FROM orders WHERE created_at >= '2026-04-03 00:00:00' AND created_at < '2026-04-08 00:00:00'";
    const candidate = detectDashboardTimeFilterCandidate(sql, 'UTC');

    expect(candidate).toEqual(
      expect.objectContaining({
        originalStartDate: '2026-04-03',
        originalEndDate: '2026-04-08',
        sqlBinding: {
          kind: 'gte_lt',
          startLiteral: '2026-04-03 00:00:00',
          endLiteral: '2026-04-08 00:00:00',
        },
        windowDays: 5,
      }),
    );

    const queryControls = buildDashboardQueryControls({
      candidate: candidate!,
      mode: 'rolling_window',
      anchor: 'last_complete_day',
    });

    expect(
      compileDashboardItemSql({
        sql,
        queryControls,
        now: new Date('2026-05-01T12:00:00.000Z'),
      }),
    ).toContain(
      "created_at >= '2026-04-26 00:00:00' AND created_at < '2026-05-01 00:00:00'",
    );
  });

  it('detects DATE_ADD one-day exclusive upper bounds', () => {
    const sql =
      "SELECT * FROM deposits d WHERE d.callback_time >= '2026-04-01' AND d.callback_time < DATE_ADD('2026-04-03', INTERVAL 1 DAY)";
    const candidate = detectDashboardTimeFilterCandidate(sql, 'UTC');

    expect(candidate).toEqual(
      expect.objectContaining({
        field: 'd.callback_time',
        originalStartDate: '2026-04-01',
        originalEndDate: '2026-04-04',
        sqlBinding: {
          endLiteral: '2026-04-03',
          endLiteralOffsetDays: 1,
          kind: 'gte_lt',
          startLiteral: '2026-04-01',
        },
        windowDays: 3,
      }),
    );

    const queryControls = buildDashboardQueryControls({
      candidate: candidate!,
      mode: 'rolling_window',
      anchor: 'last_complete_day',
    });

    expect(
      compileDashboardItemSql({
        sql,
        queryControls,
        now: new Date('2026-05-01T12:00:00.000Z'),
      }),
    ).toContain(
      "d.callback_time >= '2026-04-28' AND d.callback_time < DATE_ADD('2026-04-30', INTERVAL 1 DAY)",
    );
  });

  it('detects timestamp casts around fields and literals', () => {
    const sql =
      "SELECT * FROM deposits WHERE CAST(finished_time AS TIMESTAMP WITH TIME ZONE) >= CAST('2026-04-01 00:00:00' AS TIMESTAMP WITH TIME ZONE) AND CAST(finished_time AS TIMESTAMP WITH TIME ZONE) < CAST('2026-04-04 00:00:00' AS TIMESTAMP WITH TIME ZONE)";
    const candidate = detectDashboardTimeFilterCandidate(sql, 'UTC');

    expect(candidate).toEqual(
      expect.objectContaining({
        field: 'CAST(finished_time AS TIMESTAMP WITH TIME ZONE)',
        originalStartDate: '2026-04-01',
        originalEndDate: '2026-04-04',
        windowDays: 3,
      }),
    );
  });

  it('keeps SQL unchanged for fixed controls', () => {
    const sql =
      "SELECT * FROM orders WHERE order_date BETWEEN '2026-04-03' AND '2026-04-07'";
    const candidate = detectDashboardTimeFilterCandidate(sql, 'UTC');
    const queryControls = buildDashboardQueryControls({
      candidate: candidate!,
      mode: 'fixed',
    });

    expect(
      compileDashboardItemSql({
        sql,
        queryControls,
        now: new Date('2026-05-01T12:00:00.000Z'),
      }),
    ).toBe(sql);
  });

  it('formats dashboard query control labels for dashboard cards', () => {
    const sql =
      "SELECT * FROM orders WHERE created_at >= '2026-04-03' AND created_at < '2026-04-08'";
    const candidate = detectDashboardTimeFilterCandidate(sql, 'UTC');

    expect(
      formatDashboardQueryControlsLabel(
        buildDashboardQueryControls({
          candidate: candidate!,
          mode: 'rolling_window',
          anchor: 'today',
        }),
      ),
    ).toBe('日期策略：滚动 5 天 · 到今天');

    expect(
      formatDashboardQueryControlsLabel(
        buildDashboardQueryControls({
          candidate: candidate!,
          mode: 'fixed',
        }),
      ),
    ).toBe('日期策略：固定 2026-04-03 至 2026-04-07');
  });

  it('rejects malformed query controls instead of compiling arbitrary input', () => {
    expect(
      normalizeDashboardQueryControls({
        version: 'dashboard-query-controls-v1',
        timeFilters: [
          {
            id: 'bad',
            field: 'order_date',
            mode: 'rolling_window',
            originalStartDate: '2026-04-03',
            originalEndDate: 'not-a-date',
            windowDays: 5,
            anchor: 'last_complete_day',
            timezone: 'UTC',
            sqlBinding: {
              kind: 'between',
              startLiteral: '2026-04-03',
              endLiteral: '2026-04-07',
            },
          },
        ],
      }),
    ).toBeNull();
  });

  it('safely declines unsupported or ambiguous date ranges', () => {
    expect(
      detectDashboardTimeFilterCandidate(
        "SELECT * FROM orders WHERE order_date BETWEEN '2026-04-03' AND '2026-04-07' AND created_at BETWEEN '2026-04-03' AND '2026-04-07'",
        'UTC',
      ),
    ).toBeNull();

    expect(
      detectDashboardTimeFilterCandidate(
        "SELECT * FROM orders WHERE order_date >= '2026-04-03' AND created_at < '2026-04-08'",
        'UTC',
      ),
    ).toBeNull();

    expect(
      detectDashboardTimeFilterCandidate(
        "SELECT * FROM orders WHERE order_date BETWEEN '2026-13-03' AND '2026-13-07'",
        'UTC',
      ),
    ).toBeNull();

    expect(
      detectDashboardTimeFilterCandidate(
        'SELECT * FROM orders WHERE order_date >= CURRENT_DATE - INTERVAL 7 DAY',
        'UTC',
      ),
    ).toBeNull();
  });

  it('normalizes validated AI proposals when rule detection cannot select one candidate', () => {
    const sql =
      "SELECT * FROM orders WHERE order_date BETWEEN '2026-04-03' AND '2026-04-07' AND created_at BETWEEN '2026-04-01' AND '2026-04-30'";

    expect(detectDashboardTimeFilterCandidate(sql, 'UTC')).toBeNull();

    const candidate = normalizeDashboardTimeFilterAiProposal({
      sql,
      timezone: 'UTC',
      proposal: {
        field: 'order_date',
        sqlBinding: {
          kind: 'between',
          startLiteral: '2026-04-03',
          endLiteral: '2026-04-07',
        },
      },
    });

    expect(candidate).toEqual(
      expect.objectContaining({
        field: 'order_date',
        originalStartDate: '2026-04-03',
        originalEndDate: '2026-04-07',
        windowDays: 5,
      }),
    );
  });

  it('rejects AI proposals that do not bind literals safely to the original SQL', () => {
    const sql =
      "SELECT * FROM orders WHERE order_date BETWEEN '2026-04-03' AND '2026-04-07'";

    expect(
      normalizeDashboardTimeFilterAiProposal({
        sql,
        timezone: 'UTC',
        proposal: {
          field: 'order_date',
          sqlBinding: {
            kind: 'between',
            startLiteral: '2026-04-01',
            endLiteral: '2026-04-07',
          },
        },
      }),
    ).toBeNull();

    expect(
      normalizeDashboardTimeFilterAiProposal({
        sql,
        timezone: 'UTC',
        proposal: {
          field: 'order_date',
          sqlBinding: {
            kind: 'between',
            startLiteral: '2026-04-07',
            endLiteral: '2026-04-03',
          },
        },
      }),
    ).toBeNull();
  });
});

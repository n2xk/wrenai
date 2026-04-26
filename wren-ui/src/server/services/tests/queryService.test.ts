import { TelemetryEvent } from '../../telemetry/telemetry';
import { DataSourceName } from '../../types';
import { QueryService } from '../queryService';

describe('QueryService', () => {
  let mockIbisAdaptor: any;
  let mockWrenEngineAdaptor: any;
  let mockTelemetry: any;
  let queryService: any;

  beforeEach(() => {
    mockIbisAdaptor = {
      query: jest.fn(),
      dryRun: jest.fn(),
      modelSubstitute: jest.fn(),
    };
    mockWrenEngineAdaptor = {
      prepareDuckDB: jest.fn().mockResolvedValue(undefined),
      patchConfig: jest.fn().mockResolvedValue(undefined),
      dryRun: jest.fn().mockResolvedValue([]),
      previewData: jest.fn().mockResolvedValue({ data: [], columns: [] }),
    };
    mockTelemetry = new MockTelemetry();

    queryService = new QueryService({
      ibisAdaptor: mockIbisAdaptor,
      wrenEngineAdaptor: mockWrenEngineAdaptor,
      telemetry: mockTelemetry,
    });
  });

  afterEach(() => {
    mockTelemetry.records = [];
    jest.clearAllMocks();
  });

  it('should return true and send event when previewing via ibis dry run succeeds', async () => {
    mockIbisAdaptor.dryRun.mockResolvedValue({
      correlationId: '123',
      processTime: '1s',
    });

    const res = await queryService.preview('SELECT * FROM test', {
      project: { type: DataSourceName.POSTGRES, connectionInfo: {} },
      manifest: {},
      dryRun: true,
    });

    expect(res).toEqual({ correlationId: '123' });
    expect(mockTelemetry.records).toHaveLength(1);
    expect(mockTelemetry.records[0]).toEqual({
      event: TelemetryEvent.IBIS_DRY_RUN,
      properties: {
        correlationId: '123',
        processTime: '1s',
        sql: 'SELECT * FROM test',
        dataSource: DataSourceName.POSTGRES,
      },
      actionSuccess: true,
    });
  });

  it('should send event when previewing via ibis dry run fails', async () => {
    mockIbisAdaptor.dryRun.mockRejectedValue({
      message: 'Error message',
      extensions: {
        other: {
          correlationId: '123',
          processTime: '1s',
        },
      },
    });

    try {
      await queryService.preview('SELECT * FROM test', {
        project: { type: DataSourceName.POSTGRES, connectionInfo: {} },
        manifest: {},
        dryRun: true,
      });
    } catch (e: any) {
      expect(e.message).toEqual('Error message');
      expect(e.extensions.other.correlationId).toEqual('123');
      expect(e.extensions.other.processTime).toEqual('1s');
    }

    expect(mockTelemetry.records).toHaveLength(1);
    expect(mockTelemetry.records[0]).toEqual({
      event: TelemetryEvent.IBIS_DRY_RUN,
      properties: {
        correlationId: '123',
        processTime: '1s',
        sql: 'SELECT * FROM test',
        dataSource: DataSourceName.POSTGRES,
        error: 'Error message',
      },
      actionSuccess: false,
      service: undefined,
    });
  });

  it('should return data and send event when previewing via ibis query succeeds', async () => {
    mockIbisAdaptor.query.mockResolvedValue({
      data: [],
      columns: [],
      dtypes: [],
      correlationId: '123',
      processTime: '1s',
    });

    const res = await queryService.preview('SELECT * FROM test', {
      project: { type: DataSourceName.POSTGRES, connectionInfo: {} },
      manifest: {},
      limit: 10,
    });

    expect(res.data).toEqual([]);
    expect(mockTelemetry.records).toHaveLength(1);
    expect(mockTelemetry.records[0]).toEqual({
      event: TelemetryEvent.IBIS_QUERY,
      properties: {
        correlationId: '123',
        processTime: '1s',
        sql: 'SELECT * FROM test',
        dataSource: DataSourceName.POSTGRES,
      },
      actionSuccess: true,
    });
  });

  it('normalizes preview NaN sentinels to null before returning ibis query data', async () => {
    mockIbisAdaptor.query.mockResolvedValue({
      data: [[1, ' nan ', Number.NaN, 'keep']],
      columns: ['cohort_day', 'kill_rate', 'bet_deposit_ratio', 'label'],
      dtypes: {
        cohort_day: 'int64',
        kill_rate: 'float64',
        bet_deposit_ratio: 'float64',
        label: 'object',
      },
      correlationId: 'nan-1',
      processTime: '1s',
    });

    const res = await queryService.preview('SELECT * FROM test', {
      project: { type: DataSourceName.POSTGRES, connectionInfo: {} },
      manifest: {},
      limit: 10,
    });

    expect(res).toEqual({
      correlationId: 'nan-1',
      processTime: '1s',
      columns: [
        { name: 'cohort_day', type: 'int64' },
        { name: 'kill_rate', type: 'float64' },
        { name: 'bet_deposit_ratio', type: 'float64' },
        { name: 'label', type: 'string' },
      ],
      data: [[1, null, null, 'keep']],
      cacheHit: undefined,
      cacheCreatedAt: undefined,
      cacheOverrodeAt: undefined,
      override: undefined,
    });
  });

  it('prefers manifest source bindings when model-substituting dialect template SQL', async () => {
    mockIbisAdaptor.modelSubstitute.mockResolvedValue(
      'SELECT * FROM mdl_orders',
    );
    mockIbisAdaptor.query.mockResolvedValue({
      data: [],
      columns: [],
      dtypes: [],
      correlationId: 'dialect-1',
      processTime: '1s',
    });

    await queryService.preview('SELECT * FROM orders', {
      project: {
        type: DataSourceName.POSTGRES,
        connectionInfo: {},
        catalog: 'wrenai',
        schema: 'public',
      },
      manifest: {
        models: [
          {
            tableReference: {
              catalog: undefined,
              schema: 'tidb_business_demo',
            },
          },
        ],
      },
      sqlMode: 'dialect',
    });

    expect(mockIbisAdaptor.modelSubstitute).toHaveBeenCalledWith(
      'SELECT * FROM orders',
      expect.objectContaining({
        dataSource: DataSourceName.POSTGRES,
        connectionInfo: {},
        catalog: undefined,
        schema: 'tidb_business_demo',
      }),
    );
    expect(mockIbisAdaptor.query).toHaveBeenCalledWith(
      'SELECT * FROM mdl_orders',
      expect.objectContaining({
        dataSource: DataSourceName.POSTGRES,
      }),
    );
    expect(mockTelemetry.records.at(-1)).toEqual({
      event: TelemetryEvent.IBIS_QUERY,
      properties: {
        correlationId: 'dialect-1',
        processTime: '1s',
        sql: 'SELECT * FROM orders',
        dataSource: DataSourceName.POSTGRES,
      },
      actionSuccess: true,
    });
  });

  it('falls back to runtime project bindings when the manifest does not expose a source binding', async () => {
    mockIbisAdaptor.modelSubstitute.mockResolvedValue(
      'SELECT * FROM mdl_orders',
    );
    mockIbisAdaptor.query.mockResolvedValue({
      data: [],
      columns: [],
      dtypes: [],
      correlationId: 'dialect-2',
      processTime: '1s',
    });

    await queryService.preview('SELECT * FROM orders', {
      project: {
        type: DataSourceName.POSTGRES,
        connectionInfo: {},
        catalog: 'analytics',
        schema: 'public',
      },
      manifest: {
        models: [
          {
            tableReference: {},
          },
        ],
      },
      sqlMode: 'dialect',
    });

    expect(mockIbisAdaptor.modelSubstitute).toHaveBeenCalledWith(
      'SELECT * FROM orders',
      expect.objectContaining({
        catalog: 'analytics',
        schema: 'public',
      }),
    );
  });

  it('falls back to raw recursive dialect SQL when substituted preview hits a column-alias mismatch', async () => {
    const recursiveSql = `
WITH RECURSIVE seq AS (
  SELECT 1 AS relative_day_no
  UNION ALL
  SELECT relative_day_no + 1
  FROM seq
  WHERE relative_day_no < 7
)
SELECT * FROM seq
`.trim();

    mockIbisAdaptor.modelSubstitute.mockResolvedValue(
      'SELECT * FROM substituted_seq',
    );
    mockIbisAdaptor.query
      .mockRejectedValueOnce({
        message:
          'java.lang.IllegalArgumentException: Column alias count does not match query column count',
      })
      .mockResolvedValueOnce({
        data: [[1]],
        columns: ['relative_day_no'],
        dtypes: { relative_day_no: 'int64' },
        correlationId: 'dialect-fallback',
        processTime: '1s',
      });

    await expect(
      queryService.preview(recursiveSql, {
        project: {
          type: DataSourceName.POSTGRES,
          connectionInfo: {},
          catalog: 'analytics',
          schema: 'public',
        },
        manifest: {
          models: [
            {
              tableReference: {},
            },
          ],
        },
        sqlMode: 'dialect',
      }),
    ).resolves.toEqual({
      correlationId: 'dialect-fallback',
      processTime: '1s',
      columns: [{ name: 'relative_day_no', type: 'int64' }],
      data: [[1]],
      cacheHit: undefined,
      cacheCreatedAt: undefined,
      cacheOverrodeAt: undefined,
      override: undefined,
    });

    expect(mockIbisAdaptor.query).toHaveBeenNthCalledWith(
      1,
      'SELECT * FROM substituted_seq',
      expect.objectContaining({
        dataSource: DataSourceName.POSTGRES,
      }),
    );
    expect(mockIbisAdaptor.query).toHaveBeenNthCalledWith(
      2,
      recursiveSql,
      expect.objectContaining({
        dataSource: DataSourceName.POSTGRES,
      }),
    );
    expect(mockTelemetry.records).toHaveLength(1);
    expect(mockTelemetry.records[0]).toEqual({
      event: TelemetryEvent.IBIS_QUERY,
      properties: {
        correlationId: 'dialect-fallback',
        processTime: '1s',
        sql: recursiveSql,
        dataSource: DataSourceName.POSTGRES,
      },
      actionSuccess: true,
    });
  });

  it('falls back to raw recursive dialect SQL when model substitution itself fails with the alias-count parser error', async () => {
    const recursiveSql = `
WITH RECURSIVE seq AS (
  SELECT 1 AS relative_day_no
  UNION ALL
  SELECT relative_day_no + 1
  FROM seq
  WHERE relative_day_no < 7
)
SELECT * FROM seq
`.trim();

    mockIbisAdaptor.modelSubstitute.mockRejectedValue(
      new Error(
        'java.lang.IllegalArgumentException: Column alias count does not match query column count',
      ),
    );
    mockIbisAdaptor.query.mockResolvedValue({
      data: [[1]],
      columns: ['relative_day_no'],
      dtypes: { relative_day_no: 'int64' },
      correlationId: 'dialect-raw',
      processTime: '1s',
    });

    await expect(
      queryService.preview(recursiveSql, {
        project: {
          type: DataSourceName.POSTGRES,
          connectionInfo: {},
          catalog: 'analytics',
          schema: 'public',
        },
        manifest: {
          models: [
            {
              tableReference: {},
            },
          ],
        },
        sqlMode: 'dialect',
      }),
    ).resolves.toEqual({
      correlationId: 'dialect-raw',
      processTime: '1s',
      columns: [{ name: 'relative_day_no', type: 'int64' }],
      data: [[1]],
      cacheHit: undefined,
      cacheCreatedAt: undefined,
      cacheOverrodeAt: undefined,
      override: undefined,
    });

    expect(mockIbisAdaptor.modelSubstitute).toHaveBeenCalledWith(
      recursiveSql,
      expect.objectContaining({
        dataSource: DataSourceName.POSTGRES,
      }),
    );
    expect(mockIbisAdaptor.query).toHaveBeenCalledWith(
      recursiveSql,
      expect.objectContaining({
        dataSource: DataSourceName.POSTGRES,
      }),
    );
    expect(mockTelemetry.records).toHaveLength(1);
    expect(mockTelemetry.records[0]).toEqual({
      event: TelemetryEvent.IBIS_QUERY,
      properties: {
        correlationId: 'dialect-raw',
        processTime: '1s',
        sql: recursiveSql,
        dataSource: DataSourceName.POSTGRES,
      },
      actionSuccess: true,
    });
  });

  it('normalizes mysql DATE_ADD/DATEDIFF syntax and strips trailing semicolons before retrying raw recursive dialect SQL', async () => {
    const recursiveSql = `
WITH RECURSIVE seq AS (
  SELECT 1 AS relative_day_no
  UNION ALL
  SELECT relative_day_no + 1
  FROM seq
  WHERE relative_day_no < 7
)
SELECT
  DATEDIFF(event_day, base_day) + 1 AS relative_day_no,
  DATE_ADD(base_day, INTERVAL 7 DAY) AS end_day
FROM (
  SELECT DATE '2026-04-03' AS base_day, DATE '2026-04-05' AS event_day
) seeded
;
`.trim();

    mockIbisAdaptor.modelSubstitute.mockRejectedValue(
      new Error("INTERVAL expression expected but got '1'"),
    );
    mockIbisAdaptor.query
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce({
        data: [[3, '2026-04-10']],
        columns: ['relative_day_no', 'end_day'],
        dtypes: { relative_day_no: 'int64', end_day: 'string' },
        correlationId: 'dialect-normalized',
        processTime: '1s',
      });

    await expect(
      queryService.preview(recursiveSql, {
        project: {
          type: DataSourceName.POSTGRES,
          connectionInfo: {},
          catalog: 'analytics',
          schema: 'public',
        },
        manifest: {
          models: [
            {
              tableReference: {},
            },
          ],
        },
        sqlMode: 'dialect',
      }),
    ).resolves.toEqual({
      correlationId: 'dialect-normalized',
      processTime: '1s',
      columns: [
        { name: 'relative_day_no', type: 'int64' },
        { name: 'end_day', type: 'string' },
      ],
      data: [[3, '2026-04-10']],
      cacheHit: undefined,
      cacheCreatedAt: undefined,
      cacheOverrodeAt: undefined,
      override: undefined,
    });

    const normalizedFallbackSql = mockIbisAdaptor.query.mock.calls[0][0];
    expect(normalizedFallbackSql).toContain("date_add('day', 7, base_day)");
    expect(normalizedFallbackSql).toContain(
      "date_diff('day', base_day, event_day) + 1 AS relative_day_no",
    );
    expect(normalizedFallbackSql).not.toMatch(/;\s*$/);
    expect(mockIbisAdaptor.query).toHaveBeenCalledWith(
      normalizedFallbackSql,
      expect.objectContaining({
        dataSource: DataSourceName.POSTGRES,
      }),
    );
    expect(mockIbisAdaptor.query).toHaveBeenNthCalledWith(
      2,
      normalizedFallbackSql,
      expect.objectContaining({
        dataSource: DataSourceName.POSTGRES,
      }),
    );
  });

  it('falls back to raw non-recursive dialect SQL when substituted preview hits the INTERVAL parser error', async () => {
    const bucketSql = `
WITH first_deposit AS (
  SELECT
    DATE(d.callback_time) AS first_deposit_date,
    d.channel_id,
    d.player_id,
    d.actual_amount
  FROM dwd_order_deposit d
  WHERE d.status = 2
    AND d.times = 1
    AND d.tenant_plat_id = 990001
    AND d.channel_id = 990011
    AND d.callback_time >= '2026-04-01'
    AND d.callback_time < DATE_ADD('2026-04-03', INTERVAL 1 DAY)
)
SELECT * FROM first_deposit
`.trim();

    mockIbisAdaptor.modelSubstitute.mockResolvedValue(
      'SELECT * FROM substituted_first_deposit',
    );
    mockIbisAdaptor.query
      .mockRejectedValueOnce(
        new Error("INTERVAL expression expected but got '1'"),
      )
      .mockResolvedValueOnce({
        data: [[990011, 990101]],
        columns: ['channel_id', 'player_id'],
        dtypes: { channel_id: 'int64', player_id: 'int64' },
        correlationId: 'dialect-non-recursive-fallback',
        processTime: '1s',
      });

    await expect(
      queryService.preview(bucketSql, {
        project: {
          type: DataSourceName.POSTGRES,
          connectionInfo: {},
          catalog: 'analytics',
          schema: 'public',
        },
        manifest: {
          models: [
            {
              tableReference: {},
            },
          ],
        },
        sqlMode: 'dialect',
      }),
    ).resolves.toEqual({
      correlationId: 'dialect-non-recursive-fallback',
      processTime: '1s',
      columns: [
        { name: 'channel_id', type: 'int64' },
        { name: 'player_id', type: 'int64' },
      ],
      data: [[990011, 990101]],
      cacheHit: undefined,
      cacheCreatedAt: undefined,
      cacheOverrodeAt: undefined,
      override: undefined,
    });

    expect(mockIbisAdaptor.query).toHaveBeenNthCalledWith(
      1,
      'SELECT * FROM substituted_first_deposit',
      expect.objectContaining({
        dataSource: DataSourceName.POSTGRES,
      }),
    );

    const normalizedFallbackSql = mockIbisAdaptor.query.mock.calls[1][0];
    expect(normalizedFallbackSql).toContain(
      "date_add('day', 1, DATE '2026-04-03')",
    );
    expect(mockIbisAdaptor.query).toHaveBeenNthCalledWith(
      2,
      normalizedFallbackSql,
      expect.objectContaining({
        dataSource: DataSourceName.POSTGRES,
      }),
    );
  });

  it('falls back to raw dialect SQL when model substitution cannot resolve a physical table', async () => {
    mockIbisAdaptor.modelSubstitute.mockRejectedValue(
      new Error(
        'java.lang.IllegalArgumentException: dataset not found: dim_player',
      ),
    );
    mockIbisAdaptor.dryRun.mockResolvedValue({
      correlationId: 'dialect-raw-fallback',
      processTime: '1s',
    });

    await expect(
      queryService.preview(
        'SELECT * FROM dim_player WHERE tenant_plat_id = 990001',
        {
          project: {
            type: DataSourceName.POSTGRES,
            connectionInfo: {},
            catalog: 'analytics',
            schema: 'public',
          },
          manifest: {
            models: [
              {
                tableReference: {},
              },
            ],
          },
          dryRun: true,
          sqlMode: 'dialect',
        },
      ),
    ).resolves.toEqual({
      correlationId: 'dialect-raw-fallback',
    });

    expect(mockIbisAdaptor.dryRun).toHaveBeenCalledWith(
      'SELECT * FROM dim_player WHERE tenant_plat_id = 990001',
      expect.objectContaining({
        dataSource: DataSourceName.POSTGRES,
      }),
    );
  });

  it('should send event when previewing via ibis query fails', async () => {
    mockIbisAdaptor.query.mockRejectedValue({
      message: 'Error message',
      extensions: {
        other: {
          correlationId: '123',
          processTime: '1s',
        },
      },
    });

    await expect(
      queryService.preview('SELECT * FROM test', {
        project: { type: DataSourceName.POSTGRES, connectionInfo: {} },
        manifest: {},
      }),
    ).rejects.toMatchObject({
      message: 'Error message',
      extensions: {
        other: {
          correlationId: '123',
          processTime: '1s',
        },
      },
    });

    expect(mockTelemetry.records).toHaveLength(1);
    expect(mockTelemetry.records[0]).toEqual({
      event: TelemetryEvent.IBIS_QUERY,
      properties: {
        correlationId: '123',
        processTime: '1s',
        sql: 'SELECT * FROM test',
        dataSource: DataSourceName.POSTGRES,
        error: 'Error message',
      },
      actionSuccess: false,
      service: undefined,
    });
  });

  it('prepares duckdb runtime before dryRun preview', async () => {
    await queryService.preview('SELECT * FROM test', {
      project: {
        type: DataSourceName.DUCKDB,
        connectionInfo: {
          initSql: 'CREATE TABLE test AS SELECT 1 AS id;',
          extensions: ['httpfs'],
          configurations: { timezone: 'UTC' },
        },
      },
      manifest: {},
      dryRun: true,
    });

    expect(mockWrenEngineAdaptor.prepareDuckDB).toHaveBeenCalledWith({
      initSql: 'INSTALL httpfs;\nCREATE TABLE test AS SELECT 1 AS id;',
      sessionProps: { timezone: 'UTC' },
    });
    expect(mockWrenEngineAdaptor.patchConfig).toHaveBeenCalledWith({
      'wren.datasource.type': 'duckdb',
    });
    expect(mockWrenEngineAdaptor.dryRun).toHaveBeenCalledWith(
      'SELECT * FROM test',
      {
        manifest: {},
        limit: undefined,
      },
    );
  });

  it('reuses duckdb runtime when connection settings stay the same', async () => {
    const project = {
      type: DataSourceName.DUCKDB,
      connectionInfo: {
        initSql: 'CREATE TABLE test AS SELECT 1 AS id;',
        extensions: [],
        configurations: {},
      },
    };

    await queryService.preview('SELECT * FROM test', {
      project,
      manifest: {},
      dryRun: true,
    });
    await queryService.preview('SELECT * FROM test LIMIT 10', {
      project,
      manifest: {},
      dryRun: true,
    });

    expect(mockWrenEngineAdaptor.prepareDuckDB).toHaveBeenCalledTimes(1);
    expect(mockWrenEngineAdaptor.patchConfig).toHaveBeenCalledTimes(1);
    expect(mockWrenEngineAdaptor.dryRun).toHaveBeenCalledTimes(2);
  });

  it('re-prepares duckdb runtime after switching to a different initSql', async () => {
    await queryService.preview('SELECT 1', {
      project: {
        type: DataSourceName.DUCKDB,
        connectionInfo: {
          initSql: 'CREATE TABLE test_a AS SELECT 1 AS id;',
          extensions: [],
          configurations: {},
        },
      },
      manifest: {},
      dryRun: true,
    });
    await queryService.preview('SELECT 2', {
      project: {
        type: DataSourceName.DUCKDB,
        connectionInfo: {
          initSql: 'CREATE TABLE test_b AS SELECT 2 AS id;',
          extensions: [],
          configurations: {},
        },
      },
      manifest: {},
      dryRun: true,
    });

    expect(mockWrenEngineAdaptor.prepareDuckDB).toHaveBeenCalledTimes(2);
    expect(mockWrenEngineAdaptor.patchConfig).toHaveBeenCalledTimes(2);
  });

  it('re-prepares duckdb runtime once when dry run hits a stale runtime table-missing error', async () => {
    mockWrenEngineAdaptor.dryRun
      .mockRejectedValueOnce(
        new Error(
          'java.sql.SQLException: Catalog Error: Table with name olist_customers_dataset does not exist!',
        ),
      )
      .mockResolvedValueOnce([]);

    await expect(
      queryService.preview('SELECT * FROM test', {
        project: {
          type: DataSourceName.DUCKDB,
          connectionInfo: {
            initSql: 'CREATE TABLE test AS SELECT 1 AS id;',
            extensions: [],
            configurations: {},
          },
        },
        manifest: {},
        dryRun: true,
      }),
    ).resolves.toBe(true);

    expect(mockWrenEngineAdaptor.prepareDuckDB).toHaveBeenCalledTimes(2);
    expect(mockWrenEngineAdaptor.patchConfig).toHaveBeenCalledTimes(2);
    expect(mockWrenEngineAdaptor.dryRun).toHaveBeenCalledTimes(2);
  });

  it('re-prepares duckdb runtime once when preview hits a socket reset error', async () => {
    mockWrenEngineAdaptor.previewData
      .mockRejectedValueOnce(new Error('read ECONNRESET'))
      .mockResolvedValueOnce({
        data: [[1]],
        columns: [{ name: 'id', type: 'INTEGER' }],
      });

    await expect(
      queryService.preview('SELECT * FROM test', {
        project: {
          type: DataSourceName.DUCKDB,
          connectionInfo: {
            initSql: 'CREATE TABLE test AS SELECT 1 AS id;',
            extensions: [],
            configurations: {},
          },
        },
        manifest: {},
        dryRun: false,
      }),
    ).resolves.toEqual({
      data: [[1]],
      columns: [{ name: 'id', type: 'INTEGER' }],
    });

    expect(mockWrenEngineAdaptor.prepareDuckDB).toHaveBeenCalledTimes(2);
    expect(mockWrenEngineAdaptor.patchConfig).toHaveBeenCalledTimes(2);
    expect(mockWrenEngineAdaptor.previewData).toHaveBeenCalledTimes(2);
  });

  it('re-prepares duckdb runtime once when preview hits a closed pool error', async () => {
    mockWrenEngineAdaptor.previewData
      .mockRejectedValueOnce(
        new Error(
          'HikariDataSource HikariDataSource (DUCKDB_POOL) has been closed.',
        ),
      )
      .mockResolvedValueOnce({
        data: [[1]],
        columns: [{ name: 'id', type: 'INTEGER' }],
      });

    await expect(
      queryService.preview('SELECT * FROM test', {
        project: {
          type: DataSourceName.DUCKDB,
          connectionInfo: {
            initSql: 'CREATE TABLE test AS SELECT 1 AS id;',
            extensions: [],
            configurations: {},
          },
        },
        manifest: {},
        dryRun: false,
      }),
    ).resolves.toEqual({
      data: [[1]],
      columns: [{ name: 'id', type: 'INTEGER' }],
    });

    expect(mockWrenEngineAdaptor.prepareDuckDB).toHaveBeenCalledTimes(2);
    expect(mockWrenEngineAdaptor.patchConfig).toHaveBeenCalledTimes(2);
    expect(mockWrenEngineAdaptor.previewData).toHaveBeenCalledTimes(2);
  });
});

class MockTelemetry {
  records: any[] = [];
  sendEvent(
    event: TelemetryEvent,
    properties: Record<string, any> = {},
    service: any,
    actionSuccess: boolean = true,
  ) {
    this.records.push({ event, properties, service, actionSuccess });
  }
}

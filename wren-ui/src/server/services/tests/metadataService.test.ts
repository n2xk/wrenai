import { ConnectionMetadataService } from '../metadataService';
import { DataSourceName } from '@server/types';

describe('ConnectionMetadataService', () => {
  it('prepares DuckDB runtime before listing tables', async () => {
    const tables = [{ name: 'orders', columns: [] }];
    const wrenEngineAdaptor = {
      prepareDuckDB: jest.fn().mockResolvedValue(undefined),
      patchConfig: jest.fn().mockResolvedValue(undefined),
      listTables: jest.fn().mockResolvedValue(tables),
    };
    const service = new ConnectionMetadataService({
      ibisAdaptor: {} as any,
      wrenEngineAdaptor: wrenEngineAdaptor as any,
    });

    await expect(
      service.listTables({
        id: 1,
        type: DataSourceName.DUCKDB,
        displayName: 'DuckDB',
        connectionInfo: {
          initSql: 'CREATE TABLE orders AS SELECT 1 AS id;',
          extensions: ['httpfs'],
          configurations: { memory_limit: '1GB' },
        },
      } as any),
    ).resolves.toEqual(tables);

    expect(wrenEngineAdaptor.prepareDuckDB).toHaveBeenCalledWith({
      initSql: 'INSTALL httpfs;\nCREATE TABLE orders AS SELECT 1 AS id;',
      sessionProps: { memory_limit: '1GB' },
    });
    expect(wrenEngineAdaptor.patchConfig).toHaveBeenCalledWith({
      'wren.datasource.type': 'duckdb',
    });
    expect(wrenEngineAdaptor.listTables).toHaveBeenCalledTimes(1);
  });

  it('prepares DuckDB runtime and returns a runtime version label', async () => {
    const wrenEngineAdaptor = {
      prepareDuckDB: jest.fn().mockResolvedValue(undefined),
      patchConfig: jest.fn().mockResolvedValue(undefined),
      listTables: jest.fn(),
    };
    const ibisAdaptor = {
      getVersion: jest.fn(),
    };
    const service = new ConnectionMetadataService({
      ibisAdaptor: ibisAdaptor as any,
      wrenEngineAdaptor: wrenEngineAdaptor as any,
    });

    await expect(
      service.getVersion({
        id: 1,
        type: DataSourceName.DUCKDB,
        displayName: 'DuckDB',
        connectionInfo: {
          initSql: 'CREATE TABLE orders AS SELECT 1 AS id;',
          extensions: [],
          configurations: {},
        },
      } as any),
    ).resolves.toEqual('DuckDB runtime');

    expect(wrenEngineAdaptor.prepareDuckDB).toHaveBeenCalledWith({
      initSql: 'CREATE TABLE orders AS SELECT 1 AS id;',
      sessionProps: {},
    });
    expect(wrenEngineAdaptor.patchConfig).toHaveBeenCalledWith({
      'wren.datasource.type': 'duckdb',
    });
    expect(ibisAdaptor.getVersion).not.toHaveBeenCalled();
  });
});

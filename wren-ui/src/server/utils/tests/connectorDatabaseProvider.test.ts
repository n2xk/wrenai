import {
  buildDatabaseConnectorConnectionInfo,
  generateTrinoCatalogName,
} from '../connectorDatabaseProvider';

describe('connectorDatabaseProvider', () => {
  it('generates distinct Trino catalog names for distinct connector ids', () => {
    expect(generateTrinoCatalogName('kb-1', 'connector-1')).toBe(
      'kb_kb1_nnector1',
    );
    expect(generateTrinoCatalogName('kb-1', 'connector-2')).toBe(
      'kb_kb1_nnector2',
    );
  });

  it('builds postgres connection info from generic connector config', () => {
    expect(
      buildDatabaseConnectorConnectionInfo({
        provider: 'postgres',
        config: {
          host: '127.0.0.1',
          port: '5432',
          database: 'analytics',
          user: 'postgres',
          ssl: true,
        },
        secret: {
          password: 'postgres',
        },
      }),
    ).toEqual({
      host: '127.0.0.1',
      port: 5432,
      database: 'analytics',
      user: 'postgres',
      password: 'postgres',
      ssl: true,
    });
  });

  it('builds connection info for providers that replaced legacy setup connections', () => {
    expect(
      buildDatabaseConnectorConnectionInfo({
        provider: 'duckdb',
        config: {
          initSql: 'CREATE TABLE orders AS SELECT 1 AS id;',
          extensions: ['httpfs'],
          configurations: { memory_limit: '1GB' },
        },
      }),
    ).toEqual({
      initSql: 'CREATE TABLE orders AS SELECT 1 AS id;',
      extensions: ['httpfs'],
      configurations: { memory_limit: '1GB' },
    });

    expect(
      buildDatabaseConnectorConnectionInfo({
        provider: 'mssql',
        config: {
          host: 'sqlserver.internal',
          port: '1433',
          database: 'analytics',
          user: 'sa',
          trustServerCertificate: true,
        },
        secret: { password: 'secret' },
      }),
    ).toEqual({
      host: 'sqlserver.internal',
      port: 1433,
      database: 'analytics',
      user: 'sa',
      password: 'secret',
      trustServerCertificate: true,
    });

    expect(
      buildDatabaseConnectorConnectionInfo({
        provider: 'databricks',
        config: {
          serverHostname: 'adb.example.azuredatabricks.net',
          httpPath: '/sql/1.0/warehouses/abc',
          databricksType: 'token',
        },
        secret: { accessToken: 'dapi-token' },
      }),
    ).toEqual({
      serverHostname: 'adb.example.azuredatabricks.net',
      httpPath: '/sql/1.0/warehouses/abc',
      accessToken: 'dapi-token',
      databricksType: 'token',
    });
  });
});

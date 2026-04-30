import { DataSourceName } from '@server/types';
import {
  IbisDatabricksConnectionType,
  IbisRedshiftConnectionType,
} from '@server/adaptors/ibisAdaptor';
import {
  ATHENA_CONNECTION_INFO,
  BIG_QUERY_CONNECTION_INFO,
  CLICK_HOUSE_CONNECTION_INFO,
  DATABRICKS_CONNECTION_INFO,
  DUCKDB_CONNECTION_INFO,
  MS_SQL_CONNECTION_INFO,
  MYSQL_CONNECTION_INFO,
  ORACLE_CONNECTION_INFO,
  POSTGRES_CONNECTION_INFO,
  REDSHIFT_CONNECTION_INFO,
  REDSHIFT_IAM_AUTH,
  REDSHIFT_PASSWORD_AUTH,
  SNOWFLAKE_CONNECTION_INFO,
  TRINO_CONNECTION_INFO,
  WREN_AI_CONNECTION_INFO,
} from '@server/repositories';
import { SecretPayload } from '@server/services/secretService';

export const DATABASE_CONNECTOR_PROVIDERS = [
  'postgres',
  'mysql',
  'bigquery',
  'duckdb',
  'oracle',
  'mssql',
  'clickhouse',
  'athena',
  'snowflake',
  'redshift',
  'trino',
  'databricks',
] as const;

export type DatabaseConnectorProvider =
  (typeof DATABASE_CONNECTOR_PROVIDERS)[number];

export type DatabaseConnectorShape = {
  id?: string;
  knowledgeBaseId?: string | null;
  type?: string | null;
  databaseProvider?: string | null;
  configJson?: Record<string, any> | null;
};

export type FederatedSchemaBinding = {
  catalog: string;
  schema: string;
};

const PROVIDER_TO_DATASOURCE: Record<
  DatabaseConnectorProvider,
  DataSourceName
> = {
  postgres: DataSourceName.POSTGRES,
  mysql: DataSourceName.MYSQL,
  bigquery: DataSourceName.BIG_QUERY,
  duckdb: DataSourceName.DUCKDB,
  oracle: DataSourceName.ORACLE,
  mssql: DataSourceName.MSSQL,
  clickhouse: DataSourceName.CLICK_HOUSE,
  athena: DataSourceName.ATHENA,
  snowflake: DataSourceName.SNOWFLAKE,
  redshift: DataSourceName.REDSHIFT,
  trino: DataSourceName.TRINO,
  databricks: DataSourceName.DATABRICKS,
};

const AUTO_FEDERATABLE_PROVIDERS = new Set<DatabaseConnectorProvider>([
  'postgres',
  'mysql',
  'bigquery',
  'snowflake',
  'redshift',
]);

export const normalizeDatabaseProvider = (
  value: unknown,
): DatabaseConnectorProvider | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return (DATABASE_CONNECTOR_PROVIDERS as readonly string[]).includes(
    normalized,
  )
    ? (normalized as DatabaseConnectorProvider)
    : null;
};

export const requireDatabaseProvider = (
  value: unknown,
): DatabaseConnectorProvider => {
  const provider = normalizeDatabaseProvider(value);
  if (!provider) {
    throw new Error(
      `数据库连接器的 databaseProvider 必须是以下之一：${DATABASE_CONNECTOR_PROVIDERS.join(', ')}`,
    );
  }

  return provider;
};

export const getConnectionTypeForDatabaseProvider = (
  provider: DatabaseConnectorProvider,
): DataSourceName => PROVIDER_TO_DATASOURCE[provider];

export const isAutoFederatableDatabaseProvider = (
  provider: DatabaseConnectorProvider,
): boolean => AUTO_FEDERATABLE_PROVIDERS.has(provider);

export const isDatabaseConnector = (
  connector?: Pick<DatabaseConnectorShape, 'type'> | null,
): boolean => connector?.type === 'database';

export const generateTrinoCatalogName = (
  knowledgeBaseId: string,
  connectorId: string,
): string =>
  `kb_${toCatalogFragment(knowledgeBaseId)}_${toCatalogFragment(connectorId)}`;

export const extractFederatedSchemaBindings = ({
  provider,
  config,
  catalogName,
}: {
  provider: DatabaseConnectorProvider;
  config?: Record<string, any> | null;
  catalogName: string;
}): FederatedSchemaBinding[] => {
  const explicitSchemas = parseSchemaList(config?.schemas ?? config?.schema);
  const schemaCandidates =
    explicitSchemas.length > 0
      ? explicitSchemas
      : provider === 'mysql'
        ? [requireString(config?.database, 'MySQL 数据库名称')]
        : provider === 'bigquery'
          ? [requireString(config?.datasetId, 'BigQuery datasetId')]
          : provider === 'snowflake'
            ? [requireString(config?.schema, 'Snowflake schema')]
            : provider === 'trino'
              ? []
              : ['public'];

  return schemaCandidates.map((schema) => ({
    catalog: catalogName,
    schema,
  }));
};

export const buildDatabaseConnectorConnectionInfo = ({
  provider,
  config,
  secret,
}: {
  provider: DatabaseConnectorProvider;
  config?: Record<string, any> | null;
  secret?: SecretPayload | null;
}): WREN_AI_CONNECTION_INFO => {
  switch (provider) {
    case 'postgres':
      return buildPostgresConnectionInfo(config, secret);
    case 'mysql':
      return buildMysqlConnectionInfo(config, secret);
    case 'bigquery':
      return buildBigQueryConnectionInfo(config, secret);
    case 'duckdb':
      return buildDuckDbConnectionInfo(config);
    case 'oracle':
      return buildOracleConnectionInfo(config, secret);
    case 'mssql':
      return buildMsSqlConnectionInfo(config, secret);
    case 'clickhouse':
      return buildClickHouseConnectionInfo(config, secret);
    case 'athena':
      return buildAthenaConnectionInfo(config, secret);
    case 'snowflake':
      return buildSnowflakeConnectionInfo(config, secret);
    case 'redshift':
      return buildRedshiftConnectionInfo(config, secret);
    case 'trino':
      return buildTrinoConnectionInfo(config, secret);
    case 'databricks':
      return buildDatabricksConnectionInfo(config, secret);
    default:
      throw new Error(`Unsupported database provider: ${provider}`);
  }
};

export const canAutoFederateConnector = ({
  provider,
  config,
  secret,
}: {
  provider: DatabaseConnectorProvider;
  config?: Record<string, any> | null;
  secret?: SecretPayload | null;
}): boolean => {
  if (!isAutoFederatableDatabaseProvider(provider)) {
    return false;
  }

  try {
    buildTrinoCatalogProperties({
      provider,
      config,
      secret,
      catalogName: 'noop',
    });
    return true;
  } catch {
    return false;
  }
};

export const buildTrinoCatalogProperties = ({
  provider,
  config,
  secret,
  catalogName: _catalogName,
}: {
  provider: DatabaseConnectorProvider;
  config?: Record<string, any> | null;
  secret?: SecretPayload | null;
  catalogName: string;
}): Record<string, string> => {
  switch (provider) {
    case 'postgres': {
      const connection = buildPostgresConnectionInfo(config, secret);
      const sslQuery = connection.ssl ? '?sslmode=require' : '';
      return {
        'connector.name': 'postgresql',
        'connection-url': `jdbc:postgresql://${connection.host}:${connection.port}/${connection.database}${sslQuery}`,
        'connection-user': connection.user,
        'connection-password': connection.password,
      };
    }
    case 'mysql': {
      const connection = buildMysqlConnectionInfo(config, secret);
      const sslQuery = connection.ssl ? '?sslMode=REQUIRED' : '';
      return {
        'connector.name': 'mysql',
        'connection-url': `jdbc:mysql://${connection.host}:${connection.port}/${connection.database}${sslQuery}`,
        'connection-user': connection.user,
        'connection-password': connection.password,
      };
    }
    case 'bigquery': {
      const connection = buildBigQueryConnectionInfo(config, secret);
      return {
        'connector.name': 'bigquery',
        'bigquery.project-id': connection.projectId,
        'bigquery.credentials-key': Buffer.from(
          JSON.stringify(connection.credentials),
        ).toString('base64'),
      };
    }
    case 'snowflake': {
      const connection = buildSnowflakeConnectionInfo(config, secret);
      if (!connection.password) {
        throw new Error('Snowflake 联邦暂不支持仅 privateKey 认证的 connector');
      }
      return {
        'connector.name': 'snowflake',
        'connection-url': `jdbc:snowflake://${connection.account}.snowflakecomputing.com`,
        'connection-user': connection.user,
        'connection-password': connection.password,
        'snowflake.account': connection.account,
        'snowflake.database': connection.database,
        ...(connection.warehouse
          ? { 'snowflake.warehouse': connection.warehouse }
          : {}),
      };
    }
    case 'redshift': {
      const connection = buildRedshiftConnectionInfo(config, secret);
      if (isRedshiftIAMAuth(connection)) {
        throw new Error('Redshift 联邦暂不支持 IAM 鉴权 connector');
      }
      return {
        'connector.name': 'redshift',
        'connection-url': `jdbc:redshift://${connection.host}:${connection.port}/${connection.database}`,
        'connection-user': connection.user,
        'connection-password': connection.password,
      };
    }
    case 'trino':
      throw new Error('自动联邦暂未实现 Trino-to-Trino catalog 映射');
    default:
      throw new Error(`Unsupported database provider: ${provider}`);
  }
};

const buildPostgresConnectionInfo = (
  config?: Record<string, any> | null,
  secret?: SecretPayload | null,
): POSTGRES_CONNECTION_INFO => {
  const host = requireString(config?.host, '数据库 Host');
  const database = requireString(config?.database, '数据库名称');
  const user = requireString(config?.user ?? config?.username, '数据库用户名');
  const password = requireString(secret?.password, '数据库密码');
  const port = requirePositiveInteger(config?.port, '数据库端口');

  return {
    host,
    port,
    database,
    user,
    password,
    ssl: Boolean(config?.ssl ?? false),
  };
};

const buildMysqlConnectionInfo = (
  config?: Record<string, any> | null,
  secret?: SecretPayload | null,
): MYSQL_CONNECTION_INFO => {
  const host = requireString(config?.host, 'MySQL Host');
  const database = requireString(config?.database, 'MySQL 数据库名称');
  const user = requireString(config?.user ?? config?.username, 'MySQL 用户名');
  const password = optionalString(secret?.password) ?? '';
  const port = requirePositiveInteger(config?.port, 'MySQL 端口');

  return {
    host,
    port,
    database,
    user,
    password,
    ssl: Boolean(config?.ssl ?? false),
  };
};

const buildBigQueryConnectionInfo = (
  config?: Record<string, any> | null,
  secret?: SecretPayload | null,
): BIG_QUERY_CONNECTION_INFO => {
  const projectId = requireString(config?.projectId, 'BigQuery projectId');
  const datasetId = requireString(config?.datasetId, 'BigQuery datasetId');
  const credentials = secret?.credentials ?? config?.credentials;

  if (
    !credentials ||
    typeof credentials !== 'object' ||
    Array.isArray(credentials)
  ) {
    throw new Error('BigQuery credentials 必须是 JSON 对象');
  }

  return {
    projectId,
    datasetId,
    credentials: credentials as string,
  } as BIG_QUERY_CONNECTION_INFO;
};

const buildDuckDbConnectionInfo = (
  config?: Record<string, any> | null,
): DUCKDB_CONNECTION_INFO => {
  const extensions = config?.extensions;
  const configurations = config?.configurations;
  return {
    initSql: optionalString(config?.initSql) || '',
    extensions: Array.isArray(extensions)
      ? extensions
          .map((extension) => optionalString(extension))
          .filter((extension): extension is string => Boolean(extension))
      : [],
    configurations:
      configurations &&
      typeof configurations === 'object' &&
      !Array.isArray(configurations)
        ? configurations
        : {},
  };
};

const buildOracleConnectionInfo = (
  config?: Record<string, any> | null,
  secret?: SecretPayload | null,
): ORACLE_CONNECTION_INFO => {
  const user = requireString(config?.user ?? config?.username, 'Oracle 用户名');
  const password = requireString(secret?.password, 'Oracle 密码');
  const dsn = optionalString(secret?.dsn ?? config?.dsn) || undefined;
  const host = optionalString(config?.host) || undefined;
  const port =
    config?.port === undefined || config?.port === null || config?.port === ''
      ? undefined
      : requirePositiveInteger(config.port, 'Oracle 端口');
  const database = optionalString(config?.database) || undefined;

  if (!dsn && !host) {
    throw new Error('Oracle 需要 DSN 或 Host');
  }

  return {
    user,
    password,
    ...(host ? { host } : {}),
    ...(port ? { port } : {}),
    ...(database ? { database } : {}),
    ...(dsn ? { dsn } : {}),
  };
};

const buildMsSqlConnectionInfo = (
  config?: Record<string, any> | null,
  secret?: SecretPayload | null,
): MS_SQL_CONNECTION_INFO => ({
  host: requireString(config?.host, 'SQL Server Host'),
  port: requirePositiveInteger(config?.port, 'SQL Server 端口'),
  database: requireString(config?.database, 'SQL Server 数据库名称'),
  user: requireString(config?.user ?? config?.username, 'SQL Server 用户名'),
  password: requireString(secret?.password, 'SQL Server 密码'),
  trustServerCertificate: Boolean(config?.trustServerCertificate ?? true),
});

const buildClickHouseConnectionInfo = (
  config?: Record<string, any> | null,
  secret?: SecretPayload | null,
): CLICK_HOUSE_CONNECTION_INFO => ({
  host: requireString(config?.host, 'ClickHouse Host'),
  port: requirePositiveInteger(config?.port, 'ClickHouse 端口'),
  database: requireString(config?.database, 'ClickHouse 数据库名称'),
  user: requireString(config?.user ?? config?.username, 'ClickHouse 用户名'),
  password: requireString(secret?.password, 'ClickHouse 密码'),
  ssl: Boolean(config?.ssl ?? false),
});

const buildAthenaConnectionInfo = (
  config?: Record<string, any> | null,
  secret?: SecretPayload | null,
): ATHENA_CONNECTION_INFO => {
  const schema = requireString(
    config?.schema ?? config?.database,
    'Athena schema',
  );
  const authType = optionalString(config?.athenaAuthType) || 'classic';
  const base = {
    database: optionalString(config?.database) || schema,
    schema,
    s3StagingDir: requireString(config?.s3StagingDir, 'Athena S3 暂存目录'),
    awsRegion: requireString(config?.awsRegion, 'AWS Region'),
  };

  if (authType === 'instance_profile') {
    return base;
  }

  if (authType === 'oidc') {
    return {
      ...base,
      webIdentityToken: requireString(
        secret?.webIdentityToken,
        'Athena Web Identity Token',
      ),
      roleArn: requireString(config?.roleArn, 'AWS Role ARN'),
      roleSessionName: optionalString(config?.roleSessionName) || undefined,
    };
  }

  return {
    ...base,
    awsAccessKey: requireString(secret?.awsAccessKey, 'AWS Access Key'),
    awsSecretKey: requireString(secret?.awsSecretKey, 'AWS Secret Key'),
  };
};

const buildSnowflakeConnectionInfo = (
  config?: Record<string, any> | null,
  secret?: SecretPayload | null,
): SNOWFLAKE_CONNECTION_INFO => {
  const user = requireString(
    config?.user ?? config?.username,
    'Snowflake 用户名',
  );
  const account = requireString(config?.account, 'Snowflake account');
  const database = requireString(config?.database, 'Snowflake 数据库名称');
  const schema = requireString(config?.schema, 'Snowflake schema');
  const password = optionalString(secret?.password);
  const privateKey = optionalString(secret?.privateKey);

  if (!password && !privateKey) {
    throw new Error('Snowflake 需要 password 或 privateKey');
  }

  return {
    user,
    account,
    database,
    schema,
    password: password || undefined,
    privateKey: privateKey || undefined,
    warehouse: optionalString(config?.warehouse) || undefined,
  };
};

const buildRedshiftConnectionInfo = (
  config?: Record<string, any> | null,
  secret?: SecretPayload | null,
): REDSHIFT_CONNECTION_INFO => {
  const redshiftType = optionalString(config?.redshiftType) || 'redshift';
  if (redshiftType === IbisRedshiftConnectionType.REDSHIFT_IAM) {
    return {
      clusterIdentifier: requireString(
        config?.clusterIdentifier,
        'Redshift clusterIdentifier',
      ),
      user: requireString(config?.user ?? config?.username, 'Redshift 用户名'),
      database: requireString(config?.database, 'Redshift 数据库名称'),
      awsRegion: requireString(config?.awsRegion, 'AWS Region'),
      awsAccessKey: requireString(secret?.awsAccessKey, 'AWS Access Key'),
      awsSecretKey: requireString(secret?.awsSecretKey, 'AWS Secret Key'),
      redshiftType: IbisRedshiftConnectionType.REDSHIFT_IAM,
    } satisfies REDSHIFT_IAM_AUTH;
  }

  return {
    host: requireString(config?.host, 'Redshift Host'),
    port: requirePositiveInteger(config?.port, 'Redshift 端口'),
    user: requireString(config?.user ?? config?.username, 'Redshift 用户名'),
    password: requireString(secret?.password, 'Redshift 密码'),
    database: requireString(config?.database, 'Redshift 数据库名称'),
    redshiftType: IbisRedshiftConnectionType.REDSHIFT,
  } satisfies REDSHIFT_PASSWORD_AUTH;
};

const buildTrinoConnectionInfo = (
  config?: Record<string, any> | null,
  secret?: SecretPayload | null,
): TRINO_CONNECTION_INFO => {
  const host = requireString(config?.host, 'Trino Host');
  const port = requirePositiveInteger(config?.port, 'Trino 端口');
  const schemas = parseSchemaList(config?.schemas)
    .map((value) => value.trim())
    .filter(Boolean);
  if (schemas.length === 0) {
    throw new Error('Trino schemas 不能为空，格式应为 catalog.schema');
  }

  const username = requireString(
    config?.username ?? config?.user,
    'Trino 用户名',
  );

  return {
    host,
    port,
    schemas: schemas.join(','),
    username,
    password: optionalString(secret?.password) || '',
    ssl: Boolean(config?.ssl ?? false),
  };
};

const buildDatabricksConnectionInfo = (
  config?: Record<string, any> | null,
  secret?: SecretPayload | null,
): DATABRICKS_CONNECTION_INFO => {
  const databricksType =
    optionalString(config?.databricksType) ||
    IbisDatabricksConnectionType.TOKEN;
  const serverHostname = requireString(
    config?.serverHostname,
    'Databricks Server Hostname',
  );
  const httpPath = requireString(config?.httpPath, 'Databricks HTTP Path');

  if (databricksType === IbisDatabricksConnectionType.SERVICE_PRINCIPAL) {
    return {
      serverHostname,
      httpPath,
      clientId: requireString(config?.clientId, 'Databricks Client ID'),
      clientSecret: requireString(
        secret?.clientSecret,
        'Databricks Client Secret',
      ),
      azureTenantId: optionalString(config?.azureTenantId) || undefined,
      databricksType: IbisDatabricksConnectionType.SERVICE_PRINCIPAL,
    };
  }

  return {
    serverHostname,
    httpPath,
    accessToken: requireString(secret?.accessToken, 'Databricks Access Token'),
    databricksType: IbisDatabricksConnectionType.TOKEN,
  };
};

export const isRedshiftIAMAuth = (
  connectionInfo: REDSHIFT_CONNECTION_INFO,
): connectionInfo is REDSHIFT_IAM_AUTH =>
  (connectionInfo as REDSHIFT_IAM_AUTH).clusterIdentifier !== undefined;

const parseSchemaList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((item) => optionalString(item))
      .filter((item): item is string => Boolean(item));
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
};

const toCatalogFragment = (value: string): string => {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!normalized) {
    return 'default';
  }

  return normalized.slice(-8);
};

const requireString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label}不能为空`);
  }

  return value.trim();
};

const optionalString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const requirePositiveInteger = (value: unknown, label: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label}必须是有效的正整数`);
  }

  return parsed;
};

import { getConfig } from '../config';
import type {
  BIG_QUERY_CONNECTION_INFO,
  DATABRICKS_CONNECTION_INFO,
  Project,
  REDSHIFT_CONNECTION_INFO,
  SNOWFLAKE_CONNECTION_INFO,
  TRINO_CONNECTION_INFO,
  WREN_AI_CONNECTION_INFO,
} from '../repositories';
import type { SecretPayload } from '../services/secretService';
import { DataSource, DataSourceName } from '../types';
import type { DatabaseConnectorProvider } from './connectorDatabaseProvider';
import { Encryptor } from './encryptor';

const config = getConfig();
const encryptor = new Encryptor({
  encryptionPassword: config.encryptionPassword,
  encryptionSalt: config.encryptionSalt,
});

const DATA_SOURCE_TO_PROVIDER: Partial<
  Record<DataSourceName, DatabaseConnectorProvider>
> = {
  [DataSourceName.POSTGRES]: 'postgres',
  [DataSourceName.MYSQL]: 'mysql',
  [DataSourceName.BIG_QUERY]: 'bigquery',
  [DataSourceName.DUCKDB]: 'duckdb',
  [DataSourceName.ORACLE]: 'oracle',
  [DataSourceName.MSSQL]: 'mssql',
  [DataSourceName.CLICK_HOUSE]: 'clickhouse',
  [DataSourceName.ATHENA]: 'athena',
  [DataSourceName.SNOWFLAKE]: 'snowflake',
  [DataSourceName.REDSHIFT]: 'redshift',
  [DataSourceName.TRINO]: 'trino',
  [DataSourceName.DATABRICKS]: 'databricks',
};

const PROVIDER_TO_DATA_SOURCE = Object.entries(DATA_SOURCE_TO_PROVIDER).reduce<
  Partial<Record<DatabaseConnectorProvider, DataSourceName>>
>((accumulator, [dataSource, provider]) => {
  if (provider) {
    accumulator[provider] = dataSource as DataSourceName;
  }
  return accumulator;
}, {});

const SENSITIVE_FIELDS_BY_DATA_SOURCE: Partial<
  Record<DataSourceName, string[]>
> = {
  [DataSourceName.POSTGRES]: ['password'],
  [DataSourceName.MYSQL]: ['password'],
  [DataSourceName.BIG_QUERY]: ['credentials'],
  [DataSourceName.ORACLE]: ['password', 'dsn'],
  [DataSourceName.MSSQL]: ['password'],
  [DataSourceName.CLICK_HOUSE]: ['password'],
  [DataSourceName.ATHENA]: ['awsSecretKey', 'webIdentityToken'],
  [DataSourceName.SNOWFLAKE]: ['password', 'privateKey'],
  [DataSourceName.REDSHIFT]: ['password', 'awsSecretKey'],
  [DataSourceName.TRINO]: ['password'],
  [DataSourceName.DATABRICKS]: ['accessToken', 'clientSecret'],
};

const pickDefined = <T extends Record<string, any>>(value: T) =>
  Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;

const readString = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

const readOptionalString = (value: unknown) => {
  const normalized = readString(value);
  return normalized.length > 0 ? normalized : undefined;
};

const readOptionalSecretValue = (value: unknown) => {
  if (typeof value !== 'string') {
    return undefined;
  }

  return value;
};

const readOptionalPositiveInteger = (value: unknown) => {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  }

  return undefined;
};

const readStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value
        .map((item) => readOptionalString(item))
        .filter((item): item is string => Boolean(item))
    : [];

const readOptionalPlainObject = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : undefined;

const decryptSecretField = (
  encryptedValue: unknown,
  field: string,
): unknown | undefined => {
  if (typeof encryptedValue !== 'string' || encryptedValue.length === 0) {
    return undefined;
  }

  const decrypted = encryptor.decrypt(encryptedValue);
  return JSON.parse(decrypted)?.[field];
};

export const getConnectorDatabaseProviderForDataSource = (
  type: DataSourceName,
): DatabaseConnectorProvider | null => DATA_SOURCE_TO_PROVIDER[type] ?? null;

export const getConnectionTypeForConnectorProvider = (
  provider?: string | null,
): DataSourceName | null => {
  if (!provider) {
    return null;
  }

  return PROVIDER_TO_DATA_SOURCE[provider as DatabaseConnectorProvider] ?? null;
};

export const canBridgeConnectionTypeToConnector = (
  type?: DataSourceName | null,
) => Boolean(type && getConnectorDatabaseProviderForDataSource(type));

type ConnectorBridgePayload = {
  type: 'database';
  databaseProvider: DatabaseConnectorProvider;
  displayName: string;
  config: Record<string, any>;
  secret?: SecretPayload | null;
};

const buildConnectorBridgeFromProperties = (
  type: DataSourceName,
  properties: Record<string, any>,
): ConnectorBridgePayload | null => {
  const provider = getConnectorDatabaseProviderForDataSource(type);
  const displayName = readString(properties.displayName);

  if (!provider || !displayName) {
    return null;
  }

  switch (type) {
    case DataSourceName.POSTGRES: {
      const password = readOptionalSecretValue(properties.password);
      return {
        type: 'database',
        databaseProvider: provider,
        displayName,
        config: pickDefined({
          host: readOptionalString(properties.host),
          port: readOptionalPositiveInteger(properties.port),
          database: readOptionalString(properties.database),
          user: readOptionalString(properties.user ?? properties.username),
          ssl:
            properties.ssl === undefined ? undefined : Boolean(properties.ssl),
        }),
        ...(password ? { secret: { password } } : {}),
      };
    }
    case DataSourceName.MYSQL: {
      const password = readOptionalSecretValue(properties.password);
      return {
        type: 'database',
        databaseProvider: provider,
        displayName,
        config: pickDefined({
          host: readOptionalString(properties.host),
          port: readOptionalPositiveInteger(properties.port),
          database: readOptionalString(properties.database),
          user: readOptionalString(properties.user ?? properties.username),
          ssl:
            properties.ssl === undefined ? undefined : Boolean(properties.ssl),
        }),
        ...(password ? { secret: { password } } : {}),
      };
    }
    case DataSourceName.BIG_QUERY: {
      const credentials =
        properties.credentials &&
        typeof properties.credentials === 'object' &&
        !Array.isArray(properties.credentials)
          ? properties.credentials
          : undefined;

      return {
        type: 'database',
        databaseProvider: provider,
        displayName,
        config: pickDefined({
          projectId: readOptionalString(properties.projectId),
          datasetId: readOptionalString(properties.datasetId),
        }),
        ...(credentials ? { secret: { credentials } } : {}),
      };
    }
    case DataSourceName.DUCKDB:
      return {
        type: 'database',
        databaseProvider: provider,
        displayName,
        config: pickDefined({
          initSql: readOptionalString(properties.initSql) || '',
          extensions: readStringArray(properties.extensions),
          configurations:
            readOptionalPlainObject(properties.configurations) || {},
        }),
      };
    case DataSourceName.ORACLE: {
      const password = readOptionalSecretValue(properties.password);
      const dsn = readOptionalSecretValue(properties.dsn);
      return {
        type: 'database',
        databaseProvider: provider,
        displayName,
        config: pickDefined({
          host: readOptionalString(properties.host),
          port: readOptionalPositiveInteger(properties.port),
          database: readOptionalString(properties.database),
          user: readOptionalString(properties.user ?? properties.username),
        }),
        ...(password || dsn
          ? {
              secret: pickDefined({
                password,
                dsn,
              }),
            }
          : {}),
      };
    }
    case DataSourceName.MSSQL: {
      const password = readOptionalSecretValue(properties.password);
      return {
        type: 'database',
        databaseProvider: provider,
        displayName,
        config: pickDefined({
          host: readOptionalString(properties.host),
          port: readOptionalPositiveInteger(properties.port),
          database: readOptionalString(properties.database),
          user: readOptionalString(properties.user ?? properties.username),
          trustServerCertificate:
            properties.trustServerCertificate === undefined
              ? undefined
              : Boolean(properties.trustServerCertificate),
        }),
        ...(password ? { secret: { password } } : {}),
      };
    }
    case DataSourceName.CLICK_HOUSE: {
      const password = readOptionalSecretValue(properties.password);
      return {
        type: 'database',
        databaseProvider: provider,
        displayName,
        config: pickDefined({
          host: readOptionalString(properties.host),
          port: readOptionalPositiveInteger(properties.port),
          database: readOptionalString(properties.database),
          user: readOptionalString(properties.user ?? properties.username),
          ssl:
            properties.ssl === undefined ? undefined : Boolean(properties.ssl),
        }),
        ...(password ? { secret: { password } } : {}),
      };
    }
    case DataSourceName.ATHENA: {
      const awsAccessKey = readOptionalSecretValue(properties.awsAccessKey);
      const awsSecretKey = readOptionalSecretValue(properties.awsSecretKey);
      const webIdentityToken = readOptionalSecretValue(
        properties.webIdentityToken,
      );
      const athenaAuthType =
        webIdentityToken && readOptionalString(properties.roleArn)
          ? 'oidc'
          : awsAccessKey || awsSecretKey
            ? 'classic'
            : 'instance_profile';
      return {
        type: 'database',
        databaseProvider: provider,
        displayName,
        config: pickDefined({
          database: readOptionalString(
            properties.database ?? properties.schema,
          ),
          schema: readOptionalString(properties.schema ?? properties.database),
          s3StagingDir: readOptionalString(properties.s3StagingDir),
          awsRegion: readOptionalString(properties.awsRegion),
          roleArn: readOptionalString(properties.roleArn),
          roleSessionName: readOptionalString(properties.roleSessionName),
          athenaAuthType,
        }),
        ...(awsAccessKey || awsSecretKey || webIdentityToken
          ? {
              secret: pickDefined({
                awsAccessKey,
                awsSecretKey,
                webIdentityToken,
              }),
            }
          : {}),
      };
    }
    case DataSourceName.SNOWFLAKE: {
      const privateKey = readOptionalSecretValue(properties.privateKey);
      const password = readOptionalSecretValue(properties.password);
      return {
        type: 'database',
        databaseProvider: provider,
        displayName,
        config: pickDefined({
          account: readOptionalString(properties.account),
          database: readOptionalString(properties.database),
          schema: readOptionalString(properties.schema),
          warehouse: readOptionalString(properties.warehouse),
          user: readOptionalString(properties.user ?? properties.username),
        }),
        ...(privateKey
          ? { secret: { privateKey } }
          : password
            ? { secret: { password } }
            : {}),
      };
    }
    case DataSourceName.REDSHIFT: {
      const redshiftType =
        readOptionalString(properties.redshiftType) || 'redshift';
      if (redshiftType === 'redshift_iam') {
        const awsAccessKey = readOptionalSecretValue(properties.awsAccessKey);
        const awsSecretKey = readOptionalSecretValue(properties.awsSecretKey);
        return {
          type: 'database',
          databaseProvider: provider,
          displayName,
          config: pickDefined({
            redshiftType,
            clusterIdentifier: readOptionalString(properties.clusterIdentifier),
            database: readOptionalString(properties.database),
            user: readOptionalString(properties.user ?? properties.username),
            awsRegion: readOptionalString(properties.awsRegion),
          }),
          ...(awsAccessKey && awsSecretKey
            ? { secret: { awsAccessKey, awsSecretKey } }
            : {}),
        };
      }

      const password = readOptionalSecretValue(properties.password);
      return {
        type: 'database',
        databaseProvider: provider,
        displayName,
        config: pickDefined({
          redshiftType: 'redshift',
          host: readOptionalString(properties.host),
          port: readOptionalPositiveInteger(properties.port),
          database: readOptionalString(properties.database),
          user: readOptionalString(properties.user ?? properties.username),
        }),
        ...(password ? { secret: { password } } : {}),
      };
    }
    case DataSourceName.TRINO: {
      const password = readOptionalSecretValue(properties.password);
      return {
        type: 'database',
        databaseProvider: provider,
        displayName,
        config: pickDefined({
          host: readOptionalString(properties.host),
          port: readOptionalPositiveInteger(properties.port),
          schemas: readOptionalString(properties.schemas ?? properties.schema),
          username: readOptionalString(properties.username ?? properties.user),
          ssl:
            properties.ssl === undefined ? undefined : Boolean(properties.ssl),
        }),
        ...(password ? { secret: { password } } : {}),
      };
    }
    case DataSourceName.DATABRICKS: {
      const accessToken = readOptionalSecretValue(properties.accessToken);
      const clientSecret = readOptionalSecretValue(properties.clientSecret);
      return {
        type: 'database',
        databaseProvider: provider,
        displayName,
        config: pickDefined({
          serverHostname: readOptionalString(properties.serverHostname),
          httpPath: readOptionalString(properties.httpPath),
          databricksType:
            readOptionalString(properties.databricksType) ||
            (clientSecret ? 'service_principal' : 'token'),
          clientId: readOptionalString(properties.clientId),
          azureTenantId: readOptionalString(properties.azureTenantId),
        }),
        ...(accessToken || clientSecret
          ? {
              secret: pickDefined({
                accessToken,
                clientSecret,
              }),
            }
          : {}),
      };
    }
    default:
      return null;
  }
};

export const buildConnectorBridgeFromConnection = (
  connection: DataSource,
): ConnectorBridgePayload | null =>
  buildConnectorBridgeFromProperties(connection.type, connection.properties);

const decryptLegacyProjectSecret = (
  type: DataSourceName,
  connectionInfo: WREN_AI_CONNECTION_INFO,
): SecretPayload | undefined => {
  const sensitiveFields = SENSITIVE_FIELDS_BY_DATA_SOURCE[type] || [];
  const payload = sensitiveFields.reduce<Record<string, any>>(
    (accumulator, field) => {
      const decryptedValue = decryptSecretField(
        (connectionInfo as Record<string, any>)[field],
        field,
      );
      if (decryptedValue !== undefined) {
        accumulator[field] = decryptedValue;
      }
      return accumulator;
    },
    {},
  );

  return Object.keys(payload).length > 0 ? payload : undefined;
};

export const buildConnectorBridgeFromLegacyProject = (
  project: Project,
): ConnectorBridgePayload | null => {
  if (!canBridgeConnectionTypeToConnector(project.type)) {
    return null;
  }

  const secret = decryptLegacyProjectSecret(
    project.type,
    project.connectionInfo,
  );
  const properties = {
    displayName: project.displayName,
    ...(project.connectionInfo as Record<string, any>),
    ...(secret || {}),
  };

  return buildConnectorBridgeFromProperties(project.type, properties);
};

export const buildConnectionSettingsFromConnector = ({
  displayName,
  databaseProvider,
  config,
}: {
  displayName: string;
  databaseProvider?: string | null;
  config?: Record<string, any> | null;
}): DataSource | null => {
  const connectionType =
    getConnectionTypeForConnectorProvider(databaseProvider);
  if (!connectionType) {
    return null;
  }

  const normalizedConfig = config || {};
  const baseProperties = {
    displayName,
  };

  switch (connectionType) {
    case DataSourceName.POSTGRES:
      return {
        type: connectionType,
        properties: {
          ...baseProperties,
          host: normalizedConfig.host,
          port: normalizedConfig.port,
          database: normalizedConfig.database,
          user: normalizedConfig.user ?? normalizedConfig.username,
          ssl: Boolean(normalizedConfig.ssl),
        } as any,
      };
    case DataSourceName.MYSQL:
      return {
        type: connectionType,
        properties: {
          ...baseProperties,
          host: normalizedConfig.host,
          port: normalizedConfig.port,
          database: normalizedConfig.database,
          user: normalizedConfig.user ?? normalizedConfig.username,
          ssl: Boolean(normalizedConfig.ssl),
        } as any,
      };
    case DataSourceName.BIG_QUERY:
      return {
        type: connectionType,
        properties: {
          ...baseProperties,
          projectId: normalizedConfig.projectId,
          datasetId: normalizedConfig.datasetId,
        } as any,
      };
    case DataSourceName.DUCKDB:
      return {
        type: connectionType,
        properties: {
          ...baseProperties,
          initSql: normalizedConfig.initSql || '',
          extensions: Array.isArray(normalizedConfig.extensions)
            ? normalizedConfig.extensions
            : [],
          configurations: normalizedConfig.configurations || {},
        } as any,
      };
    case DataSourceName.ORACLE:
      return {
        type: connectionType,
        properties: {
          ...baseProperties,
          host: normalizedConfig.host,
          port: normalizedConfig.port,
          database: normalizedConfig.database,
          user: normalizedConfig.user ?? normalizedConfig.username,
        } as any,
      };
    case DataSourceName.MSSQL:
      return {
        type: connectionType,
        properties: {
          ...baseProperties,
          host: normalizedConfig.host,
          port: normalizedConfig.port,
          database: normalizedConfig.database,
          user: normalizedConfig.user ?? normalizedConfig.username,
          trustServerCertificate:
            normalizedConfig.trustServerCertificate !== false,
        } as any,
      };
    case DataSourceName.CLICK_HOUSE:
      return {
        type: connectionType,
        properties: {
          ...baseProperties,
          host: normalizedConfig.host,
          port: normalizedConfig.port,
          database: normalizedConfig.database,
          user: normalizedConfig.user ?? normalizedConfig.username,
          ssl: Boolean(normalizedConfig.ssl),
        } as any,
      };
    case DataSourceName.ATHENA:
      return {
        type: connectionType,
        properties: {
          ...baseProperties,
          database: normalizedConfig.database ?? normalizedConfig.schema,
          schema: normalizedConfig.schema ?? normalizedConfig.database,
          s3StagingDir: normalizedConfig.s3StagingDir,
          awsRegion: normalizedConfig.awsRegion,
          roleArn: normalizedConfig.roleArn,
          roleSessionName: normalizedConfig.roleSessionName,
          athenaAuthType: normalizedConfig.athenaAuthType,
        } as any,
      };
    case DataSourceName.SNOWFLAKE:
      return {
        type: connectionType,
        properties: {
          ...baseProperties,
          account: normalizedConfig.account,
          database: normalizedConfig.database,
          schema: normalizedConfig.schema,
          warehouse: normalizedConfig.warehouse,
          user: normalizedConfig.user ?? normalizedConfig.username,
        } as any,
      };
    case DataSourceName.REDSHIFT:
      return {
        type: connectionType,
        properties: {
          ...baseProperties,
          redshiftType: normalizedConfig.redshiftType,
          host: normalizedConfig.host,
          port: normalizedConfig.port,
          database: normalizedConfig.database,
          user: normalizedConfig.user ?? normalizedConfig.username,
          clusterIdentifier: normalizedConfig.clusterIdentifier,
          awsRegion: normalizedConfig.awsRegion,
        } as any,
      };
    case DataSourceName.TRINO:
      return {
        type: connectionType,
        properties: {
          ...baseProperties,
          host: normalizedConfig.host,
          port: normalizedConfig.port,
          schemas: normalizedConfig.schemas,
          username: normalizedConfig.username ?? normalizedConfig.user,
          ssl: Boolean(normalizedConfig.ssl),
        } as any,
      };
    case DataSourceName.DATABRICKS:
      return {
        type: connectionType,
        properties: {
          ...baseProperties,
          serverHostname: normalizedConfig.serverHostname,
          httpPath: normalizedConfig.httpPath,
          databricksType: normalizedConfig.databricksType,
          clientId: normalizedConfig.clientId,
          azureTenantId: normalizedConfig.azureTenantId,
        } as any,
      };
    default:
      return null;
  }
};

export const buildConnectorConfigFromProjectConnectionInfo = (
  project: Project,
) => {
  const bridge = buildConnectorBridgeFromLegacyProject(project);
  return bridge?.config ?? null;
};

export const buildConnectorSecretFromProjectConnectionInfo = (
  project: Project,
) => buildConnectorBridgeFromLegacyProject(project)?.secret;

export type SupportedProjectSecretConnectionInfo =
  | BIG_QUERY_CONNECTION_INFO
  | DATABRICKS_CONNECTION_INFO
  | REDSHIFT_CONNECTION_INFO
  | SNOWFLAKE_CONNECTION_INFO
  | TRINO_CONNECTION_INFO;

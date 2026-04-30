import type {
  ConnectorFormValues,
  ConnectorSubmitPayload,
  ConnectorTestPayload,
  ConnectorView,
  SecretReencryptPayload,
} from './connectorsPageUtils';

type DatabaseConnectorFormShape = Partial<ConnectorFormValues> & {
  databaseProvider?: string;
};

const parseOptionalJsonObject = (value?: string) => {
  if (!value || value.trim().length === 0) {
    return null;
  }

  const parsed = JSON.parse(value);
  if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
    throw new Error('JSON 内容必须是对象');
  }

  return parsed;
};

const readText = (value?: string | null) => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const readJsonObject = (value?: string | null, fallback = {}) => {
  const parsed = parseOptionalJsonObject(value || undefined);
  return parsed ?? fallback;
};

const readCsvList = (value?: string | null) =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

const pickDefinedObject = (value: Record<string, any>) =>
  Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );

const pickDefinedObjectOrNull = (value: Record<string, any>) => {
  const picked = pickDefinedObject(value);
  return Object.keys(picked).length > 0 ? picked : null;
};

const parsePositiveInteger = (value: string, field: string) => {
  const normalized = value.trim();
  const parsed = Number.parseInt(normalized, 10);

  if (!normalized || !Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${field} 必须是正整数`);
  }

  return parsed;
};

const hasStructuredDatabaseConfigInput = (values: DatabaseConnectorFormShape) =>
  Boolean(
    readText(values.dbHost) ||
    readText(values.dbPort) ||
    readText(values.dbDatabase) ||
    readText(values.dbUser) ||
    readText(values.dbSchema) ||
    readText(values.dbProjectId) ||
    readText(values.dbDatasetId) ||
    readText(values.dbSnowflakeAccount) ||
    readText(values.dbSnowflakeWarehouse) ||
    readText(values.dbClusterIdentifier) ||
    readText(values.dbAwsRegion) ||
    readText(values.dbTrinoSchemas) ||
    readText(values.dbInitSql) ||
    readText(values.dbConfigurationsText) ||
    readText(values.dbExtensionsText) ||
    readText(values.dbS3StagingDir) ||
    readText(values.dbRoleArn) ||
    readText(values.dbRoleSessionName) ||
    readText(values.dbServerHostname) ||
    readText(values.dbHttpPath) ||
    readText(values.dbClientId) ||
    readText(values.dbAzureTenantId),
  );

const hasStructuredDatabaseSecretInput = (values: DatabaseConnectorFormShape) =>
  Boolean(
    readText(values.dbPassword) ||
    readText(values.dbPrivateKey) ||
    readText(values.dbCredentialsText) ||
    readText(values.dbAwsAccessKey) ||
    readText(values.dbAwsSecretKey) ||
    readText(values.dbDsn) ||
    readText(values.dbWebIdentityToken) ||
    readText(values.dbAccessToken) ||
    readText(values.dbClientSecret),
  );

const buildDatabaseConnectorConfig = (values: DatabaseConnectorFormShape) => {
  const provider = values.databaseProvider?.trim();
  if (!provider) {
    throw new Error('请选择数据库 Provider');
  }

  switch (provider) {
    case 'postgres':
      return pickDefinedObject({
        host: readText(values.dbHost),
        port: parsePositiveInteger(values.dbPort || '', '数据库端口'),
        database: readText(values.dbDatabase),
        user: readText(values.dbUser),
        schema: readText(values.dbSchema) || undefined,
        ssl: Boolean(values.dbSsl),
      });
    case 'mysql':
      return {
        host: readText(values.dbHost),
        port: parsePositiveInteger(values.dbPort || '', 'MySQL 端口'),
        database: readText(values.dbDatabase),
        user: readText(values.dbUser),
        ssl: Boolean(values.dbSsl),
      };
    case 'duckdb':
      return {
        initSql: readText(values.dbInitSql) || '',
        extensions: readCsvList(values.dbExtensionsText),
        configurations: readJsonObject(values.dbConfigurationsText),
      };
    case 'oracle':
      return pickDefinedObject({
        host: readText(values.dbHost) || undefined,
        port: readText(values.dbPort)
          ? parsePositiveInteger(values.dbPort || '', 'Oracle 端口')
          : undefined,
        database: readText(values.dbDatabase) || undefined,
        user: readText(values.dbUser),
      });
    case 'mssql':
      return {
        host: readText(values.dbHost),
        port: parsePositiveInteger(values.dbPort || '', 'SQL Server 端口'),
        database: readText(values.dbDatabase),
        user: readText(values.dbUser),
        trustServerCertificate: Boolean(values.dbTrustServerCertificate),
      };
    case 'clickhouse':
      return {
        host: readText(values.dbHost),
        port: parsePositiveInteger(values.dbPort || '', 'ClickHouse 端口'),
        database: readText(values.dbDatabase),
        user: readText(values.dbUser),
        ssl: Boolean(values.dbSsl),
      };
    case 'bigquery':
      return {
        projectId: readText(values.dbProjectId),
        datasetId: readText(values.dbDatasetId),
      };
    case 'snowflake':
      return pickDefinedObject({
        account: readText(values.dbSnowflakeAccount),
        database: readText(values.dbDatabase),
        schema: readText(values.dbSchema),
        warehouse: readText(values.dbSnowflakeWarehouse) || undefined,
        user: readText(values.dbUser),
      });
    case 'redshift':
      if ((values.dbRedshiftAuthMode || 'redshift') === 'redshift_iam') {
        return {
          redshiftType: 'redshift_iam',
          clusterIdentifier: readText(values.dbClusterIdentifier),
          database: readText(values.dbDatabase),
          user: readText(values.dbUser),
          awsRegion: readText(values.dbAwsRegion),
        };
      }
      return pickDefinedObject({
        redshiftType: 'redshift',
        host: readText(values.dbHost),
        port: parsePositiveInteger(values.dbPort || '', 'Redshift 端口'),
        database: readText(values.dbDatabase),
        user: readText(values.dbUser),
        schema: readText(values.dbSchema) || undefined,
      });
    case 'trino':
      return {
        host: readText(values.dbHost),
        port: parsePositiveInteger(values.dbPort || '', 'Trino 端口'),
        schemas: readText(values.dbTrinoSchemas),
        username: readText(values.dbUser),
        ssl: Boolean(values.dbSsl),
      };
    case 'athena':
      return pickDefinedObject({
        schema: readText(values.dbSchema),
        database: readText(values.dbSchema),
        s3StagingDir: readText(values.dbS3StagingDir),
        awsRegion: readText(values.dbAwsRegion),
        athenaAuthType: values.dbAthenaAuthMode || 'classic',
        roleArn: readText(values.dbRoleArn) || undefined,
        roleSessionName: readText(values.dbRoleSessionName) || undefined,
      });
    case 'databricks':
      return pickDefinedObject({
        serverHostname: readText(values.dbServerHostname),
        httpPath: readText(values.dbHttpPath),
        databricksType: values.dbDatabricksAuthMode || 'token',
        clientId: readText(values.dbClientId) || undefined,
        azureTenantId: readText(values.dbAzureTenantId) || undefined,
      });
    default:
      throw new Error('未知数据库 Provider');
  }
};

const buildDatabaseConnectorSecret = (values: DatabaseConnectorFormShape) => {
  const provider = values.databaseProvider?.trim();
  if (!provider) {
    throw new Error('请选择数据库 Provider');
  }

  switch (provider) {
    case 'postgres':
    case 'mysql':
    case 'mssql':
    case 'clickhouse':
    case 'trino':
      return readText(values.dbPassword)
        ? { password: readText(values.dbPassword) }
        : null;
    case 'duckdb':
      return null;
    case 'oracle':
      return pickDefinedObjectOrNull({
        password: readText(values.dbPassword) || undefined,
        dsn: readText(values.dbDsn) || undefined,
      });
    case 'bigquery': {
      const credentials = parseOptionalJsonObject(values.dbCredentialsText);
      return credentials ? { credentials } : null;
    }
    case 'athena':
      if ((values.dbAthenaAuthMode || 'classic') === 'oidc') {
        return pickDefinedObjectOrNull({
          webIdentityToken: readText(values.dbWebIdentityToken) || undefined,
        });
      }
      if ((values.dbAthenaAuthMode || 'classic') === 'instance_profile') {
        return null;
      }
      return pickDefinedObjectOrNull({
        awsAccessKey: readText(values.dbAwsAccessKey) || undefined,
        awsSecretKey: readText(values.dbAwsSecretKey) || undefined,
      });
    case 'snowflake':
      if ((values.dbSnowflakeAuthMode || 'password') === 'privateKey') {
        return readText(values.dbPrivateKey)
          ? { privateKey: readText(values.dbPrivateKey) }
          : null;
      }
      return readText(values.dbPassword)
        ? { password: readText(values.dbPassword) }
        : null;
    case 'redshift':
      if ((values.dbRedshiftAuthMode || 'redshift') === 'redshift_iam') {
        const awsAccessKey = readText(values.dbAwsAccessKey);
        const awsSecretKey = readText(values.dbAwsSecretKey);
        return awsAccessKey && awsSecretKey
          ? { awsAccessKey, awsSecretKey }
          : null;
      }
      return readText(values.dbPassword)
        ? { password: readText(values.dbPassword) }
        : null;
    case 'databricks':
      if ((values.dbDatabricksAuthMode || 'token') === 'service_principal') {
        return readText(values.dbClientSecret)
          ? { clientSecret: readText(values.dbClientSecret) }
          : null;
      }
      return readText(values.dbAccessToken)
        ? { accessToken: readText(values.dbAccessToken) }
        : null;
    default:
      return null;
  }
};

const isDatabaseSecretRequired = (values: DatabaseConnectorFormShape) => {
  switch (values.databaseProvider?.trim()) {
    case 'duckdb':
    case 'mysql':
    case 'trino':
      return false;
    case 'athena':
      return (values.dbAthenaAuthMode || 'classic') !== 'instance_profile';
    default:
      return true;
  }
};

export const stringifyJson = (value?: Record<string, any> | null) =>
  value ? JSON.stringify(value, null, 2) : '';

export const getDatabaseConnectorFormValues = (
  connector: ConnectorView,
): Partial<ConnectorFormValues> => {
  const config = connector.config || {};
  const provider = connector.databaseProvider || 'postgres';

  switch (provider) {
    case 'postgres':
      return {
        dbHost: config.host || '',
        dbPort: config.port != null ? String(config.port) : '5432',
        dbDatabase: config.database || '',
        dbUser: config.user || config.username || '',
        dbSchema: config.schema || 'public',
        dbSsl: Boolean(config.ssl),
      };
    case 'mysql':
      return {
        dbHost: config.host || '',
        dbPort: config.port != null ? String(config.port) : '3306',
        dbDatabase: config.database || '',
        dbUser: config.user || config.username || '',
        dbSsl: Boolean(config.ssl),
      };
    case 'duckdb':
      return {
        dbInitSql: config.initSql || '',
        dbExtensionsText: Array.isArray(config.extensions)
          ? config.extensions.join(',')
          : '',
        dbConfigurationsText: stringifyJson(config.configurations || {}),
      };
    case 'oracle':
      return {
        dbHost: config.host || '',
        dbPort: config.port != null ? String(config.port) : '1521',
        dbDatabase: config.database || '',
        dbUser: config.user || config.username || '',
      };
    case 'mssql':
      return {
        dbHost: config.host || '',
        dbPort: config.port != null ? String(config.port) : '1433',
        dbDatabase: config.database || '',
        dbUser: config.user || config.username || '',
        dbTrustServerCertificate: config.trustServerCertificate !== false,
      };
    case 'clickhouse':
      return {
        dbHost: config.host || '',
        dbPort: config.port != null ? String(config.port) : '8443',
        dbDatabase: config.database || '',
        dbUser: config.user || config.username || '',
        dbSsl: Boolean(config.ssl),
      };
    case 'bigquery':
      return {
        dbProjectId: config.projectId || '',
        dbDatasetId: config.datasetId || '',
      };
    case 'athena':
      return {
        dbSchema: config.schema || config.database || '',
        dbS3StagingDir: config.s3StagingDir || '',
        dbAwsRegion: config.awsRegion || '',
        dbAthenaAuthMode: config.athenaAuthType || 'classic',
        dbRoleArn: config.roleArn || '',
        dbRoleSessionName: config.roleSessionName || '',
      };
    case 'snowflake':
      return {
        dbSnowflakeAccount: config.account || '',
        dbDatabase: config.database || '',
        dbSchema: config.schema || '',
        dbSnowflakeWarehouse: config.warehouse || '',
        dbUser: config.user || config.username || '',
        dbSnowflakeAuthMode: 'password',
      };
    case 'redshift':
      if ((config.redshiftType || 'redshift') === 'redshift_iam') {
        return {
          dbRedshiftAuthMode: 'redshift_iam',
          dbClusterIdentifier: config.clusterIdentifier || '',
          dbDatabase: config.database || '',
          dbUser: config.user || config.username || '',
          dbAwsRegion: config.awsRegion || '',
        };
      }
      return {
        dbRedshiftAuthMode: 'redshift',
        dbHost: config.host || '',
        dbPort: config.port != null ? String(config.port) : '5439',
        dbDatabase: config.database || '',
        dbUser: config.user || config.username || '',
        dbSchema: config.schema || 'public',
      };
    case 'trino':
      return {
        dbHost: config.host || '',
        dbPort: config.port != null ? String(config.port) : '8080',
        dbTrinoSchemas: config.schemas || '',
        dbUser: config.username || config.user || '',
        dbSsl: Boolean(config.ssl),
      };
    case 'databricks':
      return {
        dbServerHostname: config.serverHostname || '',
        dbHttpPath: config.httpPath || '',
        dbDatabricksAuthMode: config.databricksType || 'token',
        dbClientId: config.clientId || '',
        dbAzureTenantId: config.azureTenantId || '',
      };
    default:
      return {};
  }
};

export const buildSecretReencryptPayload = ({
  targetKeyVersionText,
  sourceKeyVersionText,
  scopeType,
  execute,
}: {
  targetKeyVersionText: string;
  sourceKeyVersionText?: string;
  scopeType?: string;
  execute?: boolean;
}): SecretReencryptPayload => {
  const payload: SecretReencryptPayload = {
    targetKeyVersion: parsePositiveInteger(
      targetKeyVersionText,
      '目标 key version',
    ),
    execute: Boolean(execute),
  };

  const normalizedSourceKeyVersion = sourceKeyVersionText?.trim();
  if (normalizedSourceKeyVersion) {
    payload.sourceKeyVersion = parsePositiveInteger(
      normalizedSourceKeyVersion,
      '源 key version',
    );
  }

  const normalizedScopeType = scopeType?.trim();
  if (normalizedScopeType) {
    payload.scopeType = normalizedScopeType;
  }

  return payload;
};

export const buildConnectorSubmitPayload = ({
  values,
  editing,
  preserveExistingSecret,
}: {
  values: ConnectorFormValues;
  editing: boolean;
  preserveExistingSecret?: boolean;
}): ConnectorSubmitPayload => {
  const isDatabase = values.type === 'database';
  const config =
    isDatabase && hasStructuredDatabaseConfigInput(values)
      ? buildDatabaseConnectorConfig(values)
      : parseOptionalJsonObject(values.configText);

  if (isDatabase && !config) {
    throw new Error('数据库连接配置不能为空');
  }

  const payload: ConnectorSubmitPayload = {
    type: values.type,
    ...(isDatabase
      ? { databaseProvider: values.databaseProvider?.trim() || null }
      : {}),
    displayName: values.displayName.trim(),
    config,
  };

  if (editing && values.clearSecret) {
    payload.secret = null;
    return payload;
  }

  const secret =
    isDatabase && hasStructuredDatabaseSecretInput(values)
      ? buildDatabaseConnectorSecret(values)
      : parseOptionalJsonObject(values.secretText);

  if (isDatabase && isDatabaseSecretRequired(values) && !secret) {
    if (!editing || !preserveExistingSecret) {
      throw new Error('数据库密钥不能为空');
    }
  }

  const secretText = values.secretText?.trim();
  if (
    isDatabase
      ? !editing || !preserveExistingSecret || Boolean(secret)
      : !editing || secretText
  ) {
    payload.secret = secret ?? null;
  }

  return payload;
};

export const buildConnectorTestPayload = ({
  values,
  editingConnectorId,
  preserveExistingSecret,
}: {
  values: Partial<ConnectorFormValues> & {
    type: string;
    databaseProvider?: string;
    clearSecret?: boolean;
  };
  editingConnectorId?: string | null;
  preserveExistingSecret?: boolean;
}): ConnectorTestPayload => {
  const isDatabase = values.type === 'database';
  const config =
    isDatabase && hasStructuredDatabaseConfigInput(values)
      ? buildDatabaseConnectorConfig(values as ConnectorFormValues)
      : parseOptionalJsonObject(values.configText);

  if (isDatabase && !config) {
    throw new Error('数据库连接配置不能为空');
  }

  const payload: ConnectorTestPayload = {
    type: values.type,
    ...(isDatabase
      ? { databaseProvider: values.databaseProvider?.trim() || null }
      : {}),
    config,
  };

  if (editingConnectorId) {
    payload.connectorId = editingConnectorId;
  }

  if (values.clearSecret) {
    payload.secret = null;
    return payload;
  }

  const secret =
    isDatabase &&
    hasStructuredDatabaseSecretInput(values as ConnectorFormValues)
      ? buildDatabaseConnectorSecret(values as ConnectorFormValues)
      : parseOptionalJsonObject(values.secretText);

  if (
    isDatabase &&
    isDatabaseSecretRequired(values as ConnectorFormValues) &&
    !secret &&
    (!editingConnectorId || !preserveExistingSecret)
  ) {
    throw new Error('数据库密钥不能为空');
  }

  const secretText = values.secretText?.trim();
  if (
    isDatabase
      ? !editingConnectorId || !preserveExistingSecret || Boolean(secret)
      : !editingConnectorId || !preserveExistingSecret || secretText
  ) {
    payload.secret = secret ?? null;
  }

  return payload;
};

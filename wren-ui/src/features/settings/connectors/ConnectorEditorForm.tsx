import { Form, Input, Select, Switch, Typography } from 'antd';
import type { ReactNode } from 'react';
import {
  ATHENA_AUTH_MODE_OPTIONS,
  CONNECTOR_CLEAR_SECRET_LABEL,
  CONNECTOR_SECRET_EDIT_HINT,
  CONNECTOR_TEST_HINT,
  DATABASE_PROVIDER_OPTIONS,
  DATABRICKS_AUTH_MODE_OPTIONS,
  REDSHIFT_AUTH_MODE_OPTIONS,
  SNOWFLAKE_AUTH_MODE_OPTIONS,
  type ConnectorFormValues,
  type ConnectorView,
} from './connectorsPageUtils';

const { Paragraph, Text } = Typography;

const SECTION_STYLE = {
  border: '1px solid #f0f0f0',
  borderRadius: 6,
  padding: '14px 16px 0',
  marginBottom: 14,
  background: '#fafafa',
} as const;

const SECTION_HEADER_STYLE = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  marginBottom: 10,
} as const;

const FIELD_GRID_STYLE = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  columnGap: 16,
  alignItems: 'start',
} as const;

const FULL_WIDTH_STYLE = { gridColumn: '1 / -1' } as const;
const SECTION_DESCRIPTION_STYLE = { fontSize: 12, lineHeight: 1.45 } as const;
const INLINE_HELP_STYLE = {
  ...FULL_WIDTH_STYLE,
  marginBottom: 12,
  fontSize: 12,
  lineHeight: 1.55,
} as const;

const connectorEditorFormStyles = `
  .connector-editor-form .ant-form-item {
    margin-bottom: 14px;
  }

  .connector-editor-form .ant-form-item-label {
    padding-bottom: 4px;
  }

  .connector-editor-form .ant-form-item-label > label {
    color: #262626;
    font-size: 13px;
  }

  .connector-editor-form .ant-form-item-extra {
    color: #8c8c8c;
    font-size: 12px;
    line-height: 1.45;
    padding-top: 4px;
  }

  .connector-editor-form .ant-input,
  .connector-editor-form .ant-input-password,
  .connector-editor-form .ant-select-selector {
    border-radius: 6px;
  }
`;

function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section style={SECTION_STYLE}>
      <div style={SECTION_HEADER_STYLE}>
        <Text strong>{title}</Text>
        {description ? (
          <Text type="secondary" style={SECTION_DESCRIPTION_STYLE}>
            {description}
          </Text>
        ) : null}
      </div>
      {children}
    </section>
  );
}

type ConnectorEditorFormProps = {
  editingConnector?: ConnectorView | null;
  form: any;
  watchedConnectorType?: string;
  watchedDatabaseProvider?: string;
  watchedSnowflakeAuthMode?: 'password' | 'privateKey';
  watchedRedshiftAuthMode?: 'redshift' | 'redshift_iam';
  watchedAthenaAuthMode?: 'classic' | 'oidc' | 'instance_profile';
  watchedDatabricksAuthMode?: 'token' | 'service_principal';
  clearSecretChecked: boolean;
  databaseProviderExample?: { config: string; secret: string } | null;
  connectorTypeOptions: Array<{ label: string; value: string }>;
  onClearSecretCheckedChange: (checked: boolean) => void;
};

export default function ConnectorEditorForm({
  editingConnector,
  form,
  watchedConnectorType,
  watchedDatabaseProvider,
  watchedSnowflakeAuthMode,
  watchedRedshiftAuthMode,
  watchedAthenaAuthMode,
  watchedDatabricksAuthMode,
  clearSecretChecked,
  databaseProviderExample,
  connectorTypeOptions,
  onClearSecretCheckedChange,
}: ConnectorEditorFormProps) {
  return (
    <Form<ConnectorFormValues>
      layout="vertical"
      form={form}
      className="connector-editor-form"
    >
      <FormSection
        title="基础信息"
        description="先确定连接器类型和展示名称，再填写对应数据库参数。"
      >
        <div style={FIELD_GRID_STYLE}>
          <Form.Item
            name="type"
            label="连接器类型"
            rules={[{ required: true, message: '请选择连接器类型' }]}
          >
            <Select options={connectorTypeOptions} />
          </Form.Item>
          {watchedConnectorType === 'database' ? (
            <Form.Item
              name="databaseProvider"
              label="数据库 Provider"
              rules={[{ required: true, message: '请选择数据库 Provider' }]}
            >
              <Select options={DATABASE_PROVIDER_OPTIONS} />
            </Form.Item>
          ) : null}
          <Form.Item
            name="displayName"
            label="显示名称"
            rules={[{ required: true, message: '请输入连接器显示名称' }]}
            style={FULL_WIDTH_STYLE}
          >
            <Input />
          </Form.Item>
        </div>
        <Paragraph type="secondary" style={INLINE_HELP_STYLE}>
          {CONNECTOR_TEST_HINT}
        </Paragraph>
      </FormSection>
      {watchedConnectorType === 'database' ? (
        <FormSection
          title="连接参数"
          description="常用字段已按两列排列；长文本、密钥与高级配置会自动占满整行。"
        >
          <div style={FIELD_GRID_STYLE}>
            {watchedDatabaseProvider === 'postgres' ? (
              <>
                <Form.Item name="dbHost" label="Host">
                  <Input placeholder="127.0.0.1" />
                </Form.Item>
                <Form.Item name="dbPort" label="Port">
                  <Input placeholder="5432" />
                </Form.Item>
                <Form.Item name="dbDatabase" label="Database">
                  <Input placeholder="analytics" />
                </Form.Item>
                <Form.Item name="dbUser" label="用户名">
                  <Input placeholder="postgres" />
                </Form.Item>
                <Form.Item name="dbSchema" label="Schema">
                  <Input placeholder="public" />
                </Form.Item>
                <Form.Item
                  name="dbSsl"
                  label="启用 SSL"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
                <Form.Item name="dbPassword" label="密码">
                  <Input
                    type="password"
                    placeholder="secret"
                    disabled={clearSecretChecked}
                  />
                </Form.Item>
              </>
            ) : null}

            {watchedDatabaseProvider === 'mysql' ? (
              <>
                <Form.Item name="dbHost" label="Host">
                  <Input placeholder="127.0.0.1" />
                </Form.Item>
                <Form.Item name="dbPort" label="Port">
                  <Input placeholder="3306" />
                </Form.Item>
                <Form.Item name="dbDatabase" label="Database">
                  <Input placeholder="analytics" />
                </Form.Item>
                <Form.Item name="dbUser" label="用户名">
                  <Input placeholder="root" />
                </Form.Item>
                <Form.Item
                  name="dbSsl"
                  label="启用 SSL"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
                <Form.Item name="dbPassword" label="密码（可选）">
                  <Input
                    type="password"
                    placeholder="secret"
                    disabled={clearSecretChecked}
                  />
                </Form.Item>
              </>
            ) : null}

            {watchedDatabaseProvider === 'duckdb' ? (
              <>
                <Form.Item
                  name="dbInitSql"
                  style={FULL_WIDTH_STYLE}
                  label="初始化 SQL 语句"
                  extra="这些 SQL 会用于准备 DuckDB 运行时。"
                >
                  <Input.TextArea
                    rows={5}
                    placeholder="CREATE TABLE orders AS SELECT * FROM read_csv('orders.csv');"
                  />
                </Form.Item>
                <Form.Item
                  name="dbConfigurationsText"
                  style={FULL_WIDTH_STYLE}
                  label="配置项 JSON"
                  extra='DuckDB session 配置，例如 {"memory_limit":"1GB"}。'
                >
                  <Input.TextArea
                    rows={4}
                    placeholder='{"memory_limit":"1GB"}'
                  />
                </Form.Item>
                <Form.Item
                  name="dbExtensionsText"
                  label="扩展"
                  extra="多个扩展用英文逗号分隔。"
                >
                  <Input placeholder="httpfs,postgres" />
                </Form.Item>
              </>
            ) : null}

            {watchedDatabaseProvider === 'oracle' ? (
              <>
                <Form.Item name="dbHost" label="Host">
                  <Input placeholder="10.1.1.1" />
                </Form.Item>
                <Form.Item name="dbPort" label="Port">
                  <Input placeholder="1521" />
                </Form.Item>
                <Form.Item name="dbDatabase" label="Database / Service Name">
                  <Input placeholder="ORCLPDB1" />
                </Form.Item>
                <Form.Item name="dbUser" label="用户名">
                  <Input placeholder="analytics" />
                </Form.Item>
                <Form.Item
                  name="dbDsn"
                  style={FULL_WIDTH_STYLE}
                  label="DSN（可选）"
                  tooltip="Oracle DSN 可替代 Host / Port / Database，并按密钥保存。"
                >
                  <Input
                    placeholder="(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=host)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=service)))"
                    disabled={clearSecretChecked}
                  />
                </Form.Item>
                <Form.Item name="dbPassword" label="密码">
                  <Input
                    type="password"
                    placeholder="secret"
                    disabled={clearSecretChecked}
                  />
                </Form.Item>
              </>
            ) : null}

            {watchedDatabaseProvider === 'mssql' ? (
              <>
                <Form.Item name="dbHost" label="Host">
                  <Input placeholder="10.1.1.1" />
                </Form.Item>
                <Form.Item name="dbPort" label="Port">
                  <Input placeholder="1433" />
                </Form.Item>
                <Form.Item name="dbDatabase" label="Database">
                  <Input placeholder="analytics" />
                </Form.Item>
                <Form.Item name="dbUser" label="用户名">
                  <Input placeholder="sa" />
                </Form.Item>
                <Form.Item
                  name="dbTrustServerCertificate"
                  label="信任服务器证书"
                  valuePropName="checked"
                  extra="用于跳过服务器证书校验。如果使用受信任证书，可以关闭。"
                >
                  <Switch />
                </Form.Item>
                <Form.Item name="dbPassword" label="密码">
                  <Input
                    type="password"
                    placeholder="secret"
                    disabled={clearSecretChecked}
                  />
                </Form.Item>
              </>
            ) : null}

            {watchedDatabaseProvider === 'clickhouse' ? (
              <>
                <Form.Item name="dbHost" label="Host">
                  <Input placeholder="clickhouse.internal" />
                </Form.Item>
                <Form.Item name="dbPort" label="Port">
                  <Input placeholder="8443" />
                </Form.Item>
                <Form.Item name="dbDatabase" label="Database">
                  <Input placeholder="analytics" />
                </Form.Item>
                <Form.Item name="dbUser" label="用户名">
                  <Input placeholder="default" />
                </Form.Item>
                <Form.Item
                  name="dbSsl"
                  label="启用 SSL"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
                <Form.Item name="dbPassword" label="密码">
                  <Input
                    type="password"
                    placeholder="secret"
                    disabled={clearSecretChecked}
                  />
                </Form.Item>
              </>
            ) : null}

            {watchedDatabaseProvider === 'bigquery' ? (
              <>
                <Form.Item name="dbProjectId" label="Project ID">
                  <Input placeholder="my-gcp-project" />
                </Form.Item>
                <Form.Item name="dbDatasetId" label="Dataset ID">
                  <Input placeholder="analytics" />
                </Form.Item>
                <Form.Item
                  name="dbCredentialsText"
                  label="Service Account JSON"
                  style={FULL_WIDTH_STYLE}
                >
                  <Input.TextArea
                    rows={8}
                    placeholder='{"type":"service_account","project_id":"my-gcp-project"}'
                    disabled={clearSecretChecked}
                  />
                </Form.Item>
              </>
            ) : null}

            {watchedDatabaseProvider === 'athena' ? (
              <>
                <Form.Item name="dbSchema" label="数据库（Schema）">
                  <Input placeholder="analytics" />
                </Form.Item>
                <Form.Item name="dbS3StagingDir" label="S3 暂存目录">
                  <Input placeholder="s3://bucket/path" />
                </Form.Item>
                <Form.Item name="dbAwsRegion" label="AWS Region">
                  <Input placeholder="us-east-1" />
                </Form.Item>
                <Form.Item name="dbAthenaAuthMode" label="认证方式">
                  <Select options={ATHENA_AUTH_MODE_OPTIONS} />
                </Form.Item>
                {watchedAthenaAuthMode === 'oidc' ? (
                  <>
                    <Form.Item
                      name="dbWebIdentityToken"
                      style={FULL_WIDTH_STYLE}
                      label="Web Identity Token"
                    >
                      <Input.Password
                        placeholder="OAuth 2.0 Access Token 或 OIDC ID Token"
                        disabled={clearSecretChecked}
                      />
                    </Form.Item>
                    <Form.Item
                      name="dbRoleArn"
                      label="AWS Role ARN"
                      style={FULL_WIDTH_STYLE}
                    >
                      <Input placeholder="arn:aws:iam::<account-id>:role/<role-name>" />
                    </Form.Item>
                    <Form.Item name="dbRoleSessionName" label="角色会话名称">
                      <Input placeholder="session-name" />
                    </Form.Item>
                  </>
                ) : watchedAthenaAuthMode === 'instance_profile' ? (
                  <Paragraph type="secondary" style={INLINE_HELP_STYLE}>
                    将使用服务运行环境绑定的 Instance Profile 凭证。
                  </Paragraph>
                ) : (
                  <>
                    <Form.Item name="dbAwsAccessKey" label="AWS Access Key ID">
                      <Input
                        placeholder="AKIA..."
                        disabled={clearSecretChecked}
                      />
                    </Form.Item>
                    <Form.Item
                      name="dbAwsSecretKey"
                      label="AWS Secret Access Key"
                      style={FULL_WIDTH_STYLE}
                    >
                      <Input.Password
                        placeholder="secret"
                        disabled={clearSecretChecked}
                      />
                    </Form.Item>
                  </>
                )}
              </>
            ) : null}

            {watchedDatabaseProvider === 'snowflake' ? (
              <>
                <Form.Item name="dbSnowflakeAccount" label="Account">
                  <Input placeholder="org-account" />
                </Form.Item>
                <Form.Item name="dbDatabase" label="Database">
                  <Input placeholder="ANALYTICS" />
                </Form.Item>
                <Form.Item name="dbSchema" label="Schema">
                  <Input placeholder="PUBLIC" />
                </Form.Item>
                <Form.Item name="dbSnowflakeWarehouse" label="Warehouse">
                  <Input placeholder="COMPUTE_WH" />
                </Form.Item>
                <Form.Item name="dbUser" label="用户名">
                  <Input placeholder="analyst" />
                </Form.Item>
                <Form.Item name="dbSnowflakeAuthMode" label="认证方式">
                  <Select options={SNOWFLAKE_AUTH_MODE_OPTIONS} />
                </Form.Item>
                {watchedSnowflakeAuthMode === 'privateKey' ? (
                  <Form.Item
                    name="dbPrivateKey"
                    label="Private Key"
                    style={FULL_WIDTH_STYLE}
                  >
                    <Input.TextArea
                      rows={6}
                      placeholder="-----BEGIN PRIVATE KEY-----"
                      disabled={clearSecretChecked}
                    />
                  </Form.Item>
                ) : (
                  <Form.Item name="dbPassword" label="密码">
                    <Input
                      type="password"
                      placeholder="secret"
                      disabled={clearSecretChecked}
                    />
                  </Form.Item>
                )}
              </>
            ) : null}

            {watchedDatabaseProvider === 'redshift' ? (
              <>
                <Form.Item name="dbRedshiftAuthMode" label="认证方式">
                  <Select options={REDSHIFT_AUTH_MODE_OPTIONS} />
                </Form.Item>
                {watchedRedshiftAuthMode === 'redshift_iam' ? (
                  <>
                    <Form.Item
                      name="dbClusterIdentifier"
                      label="Cluster Identifier"
                    >
                      <Input placeholder="my-redshift-cluster" />
                    </Form.Item>
                    <Form.Item name="dbAwsRegion" label="AWS Region">
                      <Input placeholder="us-east-1" />
                    </Form.Item>
                    <Form.Item name="dbDatabase" label="Database">
                      <Input placeholder="analytics" />
                    </Form.Item>
                    <Form.Item name="dbUser" label="用户名">
                      <Input placeholder="analyst" />
                    </Form.Item>
                    <Form.Item name="dbAwsAccessKey" label="AWS Access Key">
                      <Input
                        placeholder="AKIA..."
                        disabled={clearSecretChecked}
                      />
                    </Form.Item>
                    <Form.Item
                      name="dbAwsSecretKey"
                      label="AWS Secret Key"
                      style={FULL_WIDTH_STYLE}
                    >
                      <Input
                        type="password"
                        placeholder="secret"
                        disabled={clearSecretChecked}
                      />
                    </Form.Item>
                  </>
                ) : (
                  <>
                    <Form.Item name="dbHost" label="Host">
                      <Input placeholder="cluster.region.redshift.amazonaws.com" />
                    </Form.Item>
                    <Form.Item name="dbPort" label="Port">
                      <Input placeholder="5439" />
                    </Form.Item>
                    <Form.Item name="dbDatabase" label="Database">
                      <Input placeholder="analytics" />
                    </Form.Item>
                    <Form.Item name="dbUser" label="用户名">
                      <Input placeholder="analyst" />
                    </Form.Item>
                    <Form.Item name="dbSchema" label="Schema">
                      <Input placeholder="public" />
                    </Form.Item>
                    <Form.Item name="dbPassword" label="密码">
                      <Input
                        type="password"
                        placeholder="secret"
                        disabled={clearSecretChecked}
                      />
                    </Form.Item>
                  </>
                )}
              </>
            ) : null}

            {watchedDatabaseProvider === 'trino' ? (
              <>
                <Form.Item name="dbHost" label="Host">
                  <Input placeholder="trino.internal" />
                </Form.Item>
                <Form.Item name="dbPort" label="Port">
                  <Input placeholder="8080" />
                </Form.Item>
                <Form.Item
                  name="dbTrinoSchemas"
                  label="Schemas"
                  style={FULL_WIDTH_STYLE}
                >
                  <Input placeholder="catalog.public,catalog_2.finance" />
                </Form.Item>
                <Form.Item name="dbUser" label="用户名">
                  <Input placeholder="analyst" />
                </Form.Item>
                <Form.Item
                  name="dbSsl"
                  label="启用 SSL"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
                <Form.Item name="dbPassword" label="密码（可选）">
                  <Input
                    type="password"
                    placeholder="secret"
                    disabled={clearSecretChecked}
                  />
                </Form.Item>
              </>
            ) : null}

            {watchedDatabaseProvider === 'databricks' ? (
              <>
                <Form.Item name="dbDatabricksAuthMode" label="认证方式">
                  <Select options={DATABRICKS_AUTH_MODE_OPTIONS} />
                </Form.Item>
                <Form.Item name="dbServerHostname" label="服务器主机名">
                  <Input placeholder="adb-123456789.12.azuredatabricks.net" />
                </Form.Item>
                <Form.Item
                  name="dbHttpPath"
                  label="HTTP 路径"
                  style={FULL_WIDTH_STYLE}
                >
                  <Input placeholder="/sql/1.0/endpoints/abc123" />
                </Form.Item>
                {watchedDatabricksAuthMode === 'service_principal' ? (
                  <>
                    <Form.Item name="dbClientId" label="客户端 ID">
                      <Input placeholder="client-id" />
                    </Form.Item>
                    <Form.Item
                      name="dbClientSecret"
                      label="客户端密钥"
                      style={FULL_WIDTH_STYLE}
                    >
                      <Input.Password
                        placeholder="secret"
                        disabled={clearSecretChecked}
                      />
                    </Form.Item>
                    <Form.Item name="dbAzureTenantId" label="Azure 租户 ID">
                      <Input placeholder="72f988bf-86f1-41af-91ab-2d7cd011db47" />
                    </Form.Item>
                  </>
                ) : (
                  <Form.Item
                    name="dbAccessToken"
                    label="访问令牌"
                    style={FULL_WIDTH_STYLE}
                  >
                    <Input.Password
                      placeholder="dapi..."
                      disabled={clearSecretChecked}
                    />
                  </Form.Item>
                )}
              </>
            ) : null}
          </div>
        </FormSection>
      ) : (
        <FormSection
          title="JSON 配置"
          description="非数据库类型仅在 feature flag 开启后可用，当前保留兼容编辑能力。"
        >
          <Form.Item name="configText" label="配置 JSON">
            <Input.TextArea
              rows={8}
              placeholder={
                databaseProviderExample?.config ||
                '{"baseUrl": "https://api.example.com", "timeoutMs": 3000}'
              }
            />
          </Form.Item>
          <Form.Item name="secretText" label="密钥 JSON">
            <Input.TextArea
              rows={6}
              placeholder={
                databaseProviderExample?.secret || '{"apiKey": "secret-token"}'
              }
              disabled={clearSecretChecked}
            />
          </Form.Item>
        </FormSection>
      )}
      {editingConnector ? (
        <FormSection
          title="密钥处理"
          description="编辑连接器时可继续沿用现有密钥，只有明确清空或重新填写时才会变更。"
        >
          {editingConnector.hasSecret ? (
            <Form.Item
              label={CONNECTOR_CLEAR_SECRET_LABEL}
              style={{ marginBottom: 10 }}
            >
              <Switch
                checked={clearSecretChecked}
                onChange={onClearSecretCheckedChange}
              />
            </Form.Item>
          ) : null}
          <Paragraph type="secondary" style={INLINE_HELP_STYLE}>
            {CONNECTOR_SECRET_EDIT_HINT}
          </Paragraph>
        </FormSection>
      ) : null}
      <style>{connectorEditorFormStyles}</style>
    </Form>
  );
}

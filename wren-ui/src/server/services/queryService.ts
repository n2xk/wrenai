import { DataSourceName } from '@server/types';
import { Manifest } from '@server/mdl/type';
import { IWrenEngineAdaptor } from '../adaptors/wrenEngineAdaptor';
import { DUCKDB_CONNECTION_INFO } from '../repositories';
import {
  SupportedDataSource,
  IIbisAdaptor,
  IbisQueryResponse,
  ValidationRules,
  IbisResponse,
} from '../adaptors/ibisAdaptor';
import { getLogger } from '@server/utils';
import { Project } from '../repositories';
import { PostHogTelemetry, TelemetryEvent } from '../telemetry/telemetry';
import { QueryExecutionContext } from '../utils/runtimeExecutionContext';

const logger = getLogger('QueryService');
logger.level = 'debug';

export const DEFAULT_PREVIEW_LIMIT = 500;

export interface ColumnMetadata {
  name: string;
  type: string;
}

export interface PreviewDataResponse extends IbisResponse {
  columns: ColumnMetadata[];
  data: any[][];
  cacheHit?: boolean;
  cacheCreatedAt?: string;
  cacheOverrodeAt?: string;
  override?: boolean;
}

export interface DescribeStatementResponse {
  columns: ColumnMetadata[];
}

export interface PreviewOptions extends QueryExecutionContext {
  modelingOnly?: boolean;
  limit?: number;
  dryRun?: boolean;
  refresh?: boolean;
  cacheEnabled?: boolean;
  sqlMode?: 'wren' | 'dialect';
}

export interface SqlValidateOptions {
  project: Project;
  mdl: Manifest;
  modelingOnly?: boolean;
}

export interface ValidateResponse {
  valid: boolean;
  message?: string;
}

export interface IQueryService {
  preview(
    sql: string,
    options: PreviewOptions,
  ): Promise<IbisResponse | PreviewDataResponse | boolean>;

  describeStatement(
    sql: string,
    options: PreviewOptions,
  ): Promise<DescribeStatementResponse>;

  validate(
    project: Project,
    rule: ValidationRules,
    manifest: Manifest,
    parameters: Record<string, any>,
  ): Promise<ValidateResponse>;
}

export class QueryService implements IQueryService {
  private readonly ibisAdaptor: IIbisAdaptor;
  private readonly wrenEngineAdaptor: IWrenEngineAdaptor;
  private readonly telemetry: PostHogTelemetry;
  private currentDuckDbRuntimeKey: string | null = null;

  constructor({
    ibisAdaptor,
    wrenEngineAdaptor,
    telemetry,
  }: {
    ibisAdaptor: IIbisAdaptor;
    wrenEngineAdaptor: IWrenEngineAdaptor;
    telemetry: PostHogTelemetry;
  }) {
    this.ibisAdaptor = ibisAdaptor;
    this.wrenEngineAdaptor = wrenEngineAdaptor;
    this.telemetry = telemetry;
  }

  public async preview(
    sql: string,
    options: PreviewOptions,
  ): Promise<IbisResponse | PreviewDataResponse | boolean> {
    const {
      project,
      manifest: mdl,
      limit,
      dryRun,
      refresh,
      cacheEnabled,
    } = options;
    const { type: connectionType, connectionInfo } = project;
    const normalizedSql = this.normalizeDialectSqlForIbis(sql, options);
    const executableSql = await this.resolveExecutableSqlWithFallback(
      normalizedSql,
      options,
    );
    if (this.useEngineForConnection(connectionType)) {
      const duckDbConnectionInfo = (connectionInfo ||
        {}) as DUCKDB_CONNECTION_INFO;
      await this.ensureDuckDbRuntime(duckDbConnectionInfo);
      try {
        if (dryRun) {
          logger.debug('Using wren engine to dry run');
          await this.wrenEngineAdaptor.dryRun(executableSql, {
            manifest: mdl,
            limit,
          });
          return true;
        } else {
          logger.debug('Using wren engine to preview');
          const data = await this.wrenEngineAdaptor.previewData(
            executableSql,
            mdl,
            limit,
          );
          return data as PreviewDataResponse;
        }
      } catch (error) {
        if (!this.shouldRetryDuckDbRuntime(error)) {
          throw error;
        }

        logger.warn(
          `DuckDB runtime appears stale; re-preparing and retrying once: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        await this.ensureDuckDbRuntime(duckDbConnectionInfo, { force: true });

        if (dryRun) {
          await this.wrenEngineAdaptor.dryRun(executableSql, {
            manifest: mdl,
            limit,
          });
          return true;
        }

        const data = await this.wrenEngineAdaptor.previewData(
          executableSql,
          mdl,
          limit,
        );
        return data as PreviewDataResponse;
      }
    } else {
      this.checkConnectionTypeIsSupported(connectionType);
      logger.debug('Use ibis adaptor to preview');
      if (dryRun) {
        return await this.ibisDryRun(
          sql,
          normalizedSql,
          executableSql,
          connectionType,
          connectionInfo,
          mdl,
          options,
        );
      } else {
        return await this.ibisQuery(
          sql,
          normalizedSql,
          executableSql,
          connectionType,
          connectionInfo,
          mdl,
          limit ?? DEFAULT_PREVIEW_LIMIT,
          refresh,
          cacheEnabled,
          options,
        );
      }
    }
  }

  public async describeStatement(
    sql: string,
    options: PreviewOptions,
  ): Promise<DescribeStatementResponse> {
    try {
      // preview data with limit 1 to get column metadata
      options.limit = 1;
      const res = (await this.preview(sql, options)) as PreviewDataResponse;
      return { columns: res.columns };
    } catch (err: any) {
      logger.debug(`Got error when describing statement: ${err.message}`);
      throw err;
    }
  }

  public async validate(
    project: Project,
    rule: ValidationRules,
    manifest: Manifest,
    parameters: Record<string, any>,
  ): Promise<ValidateResponse> {
    const { type: connectionType, connectionInfo } = project;
    const res = await this.ibisAdaptor.validate(
      connectionType,
      rule,
      connectionInfo,
      manifest,
      parameters,
    );
    return {
      valid: res.valid,
      message: res.message ?? undefined,
    };
  }

  private useEngineForConnection(connectionType: DataSourceName): boolean {
    if (connectionType === DataSourceName.DUCKDB) {
      return true;
    } else {
      return false;
    }
  }

  private checkConnectionTypeIsSupported(connectionType: DataSourceName) {
    if (
      !Object.prototype.hasOwnProperty.call(SupportedDataSource, connectionType)
    ) {
      throw new Error(
        `Unsupported connection type for ibis: "${connectionType}"`,
      );
    }
  }

  private getDuckDbInitSql(connectionInfo: DUCKDB_CONNECTION_INFO): string {
    const initSql =
      connectionInfo && typeof connectionInfo.initSql === 'string'
        ? connectionInfo.initSql
        : '';
    const extensions = Array.isArray(connectionInfo?.extensions)
      ? connectionInfo.extensions.filter(
          (ext): ext is string => typeof ext === 'string' && ext.trim() !== '',
        )
      : [];
    const installExtensionsSql = extensions
      .map((ext) => `INSTALL ${ext};`)
      .join('\n');

    return [installExtensionsSql, initSql].filter(Boolean).join('\n');
  }

  private getDuckDbSessionProps(connectionInfo: DUCKDB_CONNECTION_INFO) {
    const rawConfig = connectionInfo?.configurations;
    if (!rawConfig || typeof rawConfig !== 'object') {
      return {};
    }
    return rawConfig as Record<string, any>;
  }

  private buildDuckDbRuntimeKey(
    connectionInfo: DUCKDB_CONNECTION_INFO,
  ): string {
    return JSON.stringify({
      initSql: this.getDuckDbInitSql(connectionInfo),
      sessionProps: this.getDuckDbSessionProps(connectionInfo),
    });
  }

  private async ensureDuckDbRuntime(
    connectionInfo: DUCKDB_CONNECTION_INFO,
    options?: {
      force?: boolean;
    },
  ): Promise<void> {
    const runtimeKey = this.buildDuckDbRuntimeKey(connectionInfo);
    if (!options?.force && this.currentDuckDbRuntimeKey === runtimeKey) {
      return;
    }

    await this.wrenEngineAdaptor.prepareDuckDB({
      initSql: this.getDuckDbInitSql(connectionInfo),
      sessionProps: this.getDuckDbSessionProps(connectionInfo),
    });
    await this.wrenEngineAdaptor.patchConfig({
      'wren.datasource.type': 'duckdb',
    });

    this.currentDuckDbRuntimeKey = runtimeKey;
  }

  private shouldRetryDuckDbRuntime(error: unknown): boolean {
    const message =
      error instanceof Error ? error.message : String(error || '');

    return (
      /HikariDataSource .* has been closed/i.test(message) ||
      (/Table with name .* does not exist/i.test(message) &&
        /Catalog Error/i.test(message)) ||
      /source node name not found/i.test(message) ||
      /(?:read\s+)?ECONNRESET/i.test(message) ||
      /socket hang up/i.test(message) ||
      /Connection reset by peer/i.test(message)
    );
  }

  private shouldRetryTransientIbisRequest(error: unknown): boolean {
    const message =
      error instanceof Error ? error.message : String(error || '');

    return (
      /(?:read\s+)?ECONNRESET/i.test(message) ||
      /socket hang up/i.test(message) ||
      /Connection reset by peer/i.test(message)
    );
  }

  private async ibisDryRun(
    originalSql: string,
    normalizedSql: string,
    executableSql: string,
    dataSource: DataSourceName,
    connectionInfo: any,
    mdl: Manifest,
    previewOptions: PreviewOptions,
  ): Promise<IbisResponse> {
    const event = TelemetryEvent.IBIS_DRY_RUN;
    try {
      let res: IbisResponse;
      try {
        res = await this.executeIbisDryRun(executableSql, {
          dataSource,
          connectionInfo,
          mdl,
        });
      } catch (initialErr) {
        if (!this.shouldRetryTransientIbisRequest(initialErr)) {
          throw initialErr;
        }

        logger.warn(
          `Ibis dry-run hit a transient upstream reset; retrying once: ${
            initialErr instanceof Error
              ? initialErr.message
              : String(initialErr)
          }`,
        );
        res = await this.executeIbisDryRun(executableSql, {
          dataSource,
          connectionInfo,
          mdl,
        });
      }
      this.sendIbisEvent(event, res, { dataSource, sql: originalSql });
      return {
        correlationId: res.correlationId,
      };
    } catch (err: any) {
      if (
        !this.shouldFallbackToRawDialectSql(
          normalizedSql,
          executableSql,
          previewOptions,
          err,
        )
      ) {
        this.sendIbisFailedEvent(event, err, {
          dataSource,
          sql: originalSql,
        });
        throw err;
      }

      logger.warn(
        `Dialect preview dry-run fallback to raw SQL after substitution failure: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );

      try {
        const res = await this.executeIbisDryRun(normalizedSql, {
          dataSource,
          connectionInfo,
          mdl,
        });
        this.sendIbisEvent(event, res, { dataSource, sql: originalSql });
        return {
          correlationId: res.correlationId,
        };
      } catch (fallbackErr: any) {
        if (this.shouldRetryTransientIbisRequest(fallbackErr)) {
          logger.warn(
            `Dialect preview dry-run fallback hit a transient upstream reset; retrying raw SQL once: ${
              fallbackErr instanceof Error
                ? fallbackErr.message
                : String(fallbackErr)
            }`,
          );
          try {
            const retryRes = await this.executeIbisDryRun(normalizedSql, {
              dataSource,
              connectionInfo,
              mdl,
            });
            this.sendIbisEvent(event, retryRes, {
              dataSource,
              sql: originalSql,
            });
            return {
              correlationId: retryRes.correlationId,
            };
          } catch (retryErr: any) {
            this.sendIbisFailedEvent(event, retryErr, {
              dataSource,
              sql: originalSql,
            });
            throw retryErr;
          }
        }

        this.sendIbisFailedEvent(event, fallbackErr, {
          dataSource,
          sql: originalSql,
        });
        throw fallbackErr;
      }
    }
  }

  private async ibisQuery(
    originalSql: string,
    normalizedSql: string,
    executableSql: string,
    dataSource: DataSourceName,
    connectionInfo: any,
    mdl: Manifest,
    limit: number,
    refresh?: boolean,
    cacheEnabled?: boolean,
    previewOptions?: PreviewOptions,
  ): Promise<PreviewDataResponse> {
    const event = TelemetryEvent.IBIS_QUERY;
    try {
      let res: PreviewDataResponse;
      try {
        res = await this.executeIbisQuery(executableSql, {
          dataSource,
          connectionInfo,
          mdl,
          limit,
          refresh,
          cacheEnabled,
        });
      } catch (initialErr) {
        if (!this.shouldRetryTransientIbisRequest(initialErr)) {
          throw initialErr;
        }

        logger.warn(
          `Ibis query hit a transient upstream reset; retrying once: ${
            initialErr instanceof Error
              ? initialErr.message
              : String(initialErr)
          }`,
        );
        res = await this.executeIbisQuery(executableSql, {
          dataSource,
          connectionInfo,
          mdl,
          limit,
          refresh,
          cacheEnabled,
        });
      }
      this.sendIbisEvent(event, res, { dataSource, sql: originalSql });
      return res;
    } catch (err: any) {
      if (
        !this.shouldFallbackToRawDialectSql(
          normalizedSql,
          executableSql,
          previewOptions,
          err,
        )
      ) {
        this.sendIbisFailedEvent(event, err, {
          dataSource,
          sql: originalSql,
        });
        throw err;
      }

      logger.warn(
        `Dialect preview fallback to raw SQL after substitution failure: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );

      try {
        const res = await this.executeIbisQuery(normalizedSql, {
          dataSource,
          connectionInfo,
          mdl,
          limit,
          refresh,
          cacheEnabled,
        });
        this.sendIbisEvent(event, res, { dataSource, sql: originalSql });
        return res;
      } catch (fallbackErr: any) {
        if (this.shouldRetryTransientIbisRequest(fallbackErr)) {
          logger.warn(
            `Dialect preview fallback hit a transient upstream reset; retrying raw SQL once: ${
              fallbackErr instanceof Error
                ? fallbackErr.message
                : String(fallbackErr)
            }`,
          );
          try {
            const retryRes = await this.executeIbisQuery(normalizedSql, {
              dataSource,
              connectionInfo,
              mdl,
              limit,
              refresh,
              cacheEnabled,
            });
            this.sendIbisEvent(event, retryRes, {
              dataSource,
              sql: originalSql,
            });
            return retryRes;
          } catch (retryErr: any) {
            this.sendIbisFailedEvent(event, retryErr, {
              dataSource,
              sql: originalSql,
            });
            throw retryErr;
          }
        }

        this.sendIbisFailedEvent(event, fallbackErr, {
          dataSource,
          sql: originalSql,
        });
        throw fallbackErr;
      }
    }
  }

  private async resolveExecutableSqlWithFallback(
    sql: string,
    options: PreviewOptions,
  ): Promise<string> {
    try {
      return await this.resolveExecutableSql(sql, options);
    } catch (error) {
      if (!this.shouldFallbackToRawDialectSql(sql, null, options, error)) {
        throw error;
      }

      logger.warn(
        `Dialect model substitution failed; retrying raw SQL once: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return sql;
    }
  }

  private async resolveExecutableSql(
    sql: string,
    options: PreviewOptions,
  ): Promise<string> {
    if (options.sqlMode !== 'dialect') {
      return sql;
    }

    const { project, manifest: mdl } = options;
    if (this.useEngineForConnection(project.type)) {
      return sql;
    }

    const { catalog, schema } = this.resolveDialectSourceBinding(project, mdl);

    return this.ibisAdaptor.modelSubstitute(sql as any, {
      dataSource: project.type,
      connectionInfo: project.connectionInfo,
      mdl,
      catalog,
      schema,
    });
  }

  private shouldFallbackToRawDialectSql(
    normalizedSql: string,
    executableSql: string | null,
    options: PreviewOptions | undefined,
    error: unknown,
  ) {
    if (!options || options.sqlMode !== 'dialect') {
      return false;
    }

    if (this.useEngineForConnection(options.project.type)) {
      return false;
    }

    if (executableSql === normalizedSql) {
      return false;
    }

    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'object' && error && 'message' in error
          ? String((error as { message?: unknown }).message ?? '')
          : String(error || '');

    return (
      /dataset not found:/i.test(message) ||
      /model not found/i.test(message) ||
      /source node name not found/i.test(message) ||
      /Column alias count does not match query column count/i.test(message) ||
      /INTERVAL expression expected but got/i.test(message) ||
      /mismatched input .*Expecting: '\)', ',', 'ORDER'/i.test(message)
    );
  }

  private normalizeDialectSqlForIbis(
    sql: string,
    options: PreviewOptions,
  ): string {
    if (options.sqlMode !== 'dialect') {
      return sql;
    }

    if (this.useEngineForConnection(options.project.type)) {
      return sql;
    }

    return this.stripTrailingSemicolon(this.rewriteMysqlDateFunctions(sql));
  }

  private rewriteMysqlDateFunctions(sql: string): string {
    return this.rewriteMysqlDateDiffToDateDiffFunction(
      this.rewriteMysqlDateAddToDateAddFunction(sql),
    );
  }

  private rewriteMysqlDateAddToDateAddFunction(sql: string): string {
    const pattern = /DATE_ADD\s*\(/gi;
    let result = '';
    let cursor = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(sql))) {
      const start = match.index;
      const openParenIndex = start + match[0].length - 1;
      const parsed = this.parseFunctionCallArguments(sql, openParenIndex);

      if (!parsed) {
        continue;
      }

      const rewritten = this.tryRewriteMysqlDateAddCall(parsed.inner);
      if (!rewritten) {
        continue;
      }

      result += sql.slice(cursor, start);
      result += rewritten;
      cursor = parsed.endIndex + 1;
      pattern.lastIndex = cursor;
    }

    if (cursor === 0) {
      return sql;
    }

    return result + sql.slice(cursor);
  }

  private parseFunctionCallArguments(
    sql: string,
    openParenIndex: number,
  ): {
    inner: string;
    endIndex: number;
  } | null {
    let depth = 0;
    let quote: "'" | '"' | null = null;

    for (let index = openParenIndex; index < sql.length; index += 1) {
      const char = sql[index];
      const nextChar = sql[index + 1];

      if (quote) {
        if (char === quote) {
          if (nextChar === quote) {
            index += 1;
            continue;
          }
          quote = null;
        }
        continue;
      }

      if (char === "'" || char === '"') {
        quote = char;
        continue;
      }

      if (char === '(') {
        depth += 1;
        continue;
      }

      if (char === ')') {
        depth -= 1;
        if (depth === 0) {
          return {
            inner: sql.slice(openParenIndex + 1, index),
            endIndex: index,
          };
        }
      }
    }

    return null;
  }

  private tryRewriteMysqlDateAddCall(inner: string): string | null {
    const splitIndex = this.findTopLevelComma(inner);
    if (splitIndex === -1) {
      return null;
    }

    const baseExpression = inner.slice(0, splitIndex).trim();
    const intervalExpression = inner.slice(splitIndex + 1).trim();
    const intervalMatch = intervalExpression.match(
      /^INTERVAL\s+(.+?)\s+(DAY|HOUR|MINUTE|SECOND|MONTH|YEAR)\s*$/i,
    );

    if (!intervalMatch) {
      return null;
    }

    const [, valueExpression, unit] = intervalMatch;
    return `date_add('${unit.toLowerCase()}', ${valueExpression.trim()}, ${this.normalizeSqlDateOperand(baseExpression)})`;
  }

  private rewriteMysqlDateDiffToDateDiffFunction(sql: string): string {
    const pattern = /DATEDIFF\s*\(/gi;
    let result = '';
    let cursor = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(sql))) {
      const start = match.index;
      const openParenIndex = start + match[0].length - 1;
      const parsed = this.parseFunctionCallArguments(sql, openParenIndex);

      if (!parsed) {
        continue;
      }

      const rewritten = this.tryRewriteMysqlDateDiffCall(parsed.inner);
      if (!rewritten) {
        continue;
      }

      result += sql.slice(cursor, start);
      result += rewritten;
      cursor = parsed.endIndex + 1;
      pattern.lastIndex = cursor;
    }

    if (cursor === 0) {
      return sql;
    }

    return result + sql.slice(cursor);
  }

  private tryRewriteMysqlDateDiffCall(inner: string): string | null {
    const splitIndex = this.findTopLevelComma(inner);
    if (splitIndex === -1) {
      return null;
    }

    const leftExpression = inner.slice(0, splitIndex).trim();
    const rightExpression = inner.slice(splitIndex + 1).trim();
    return `date_diff('day', ${this.normalizeSqlDateOperand(rightExpression)}, ${this.normalizeSqlDateOperand(leftExpression)})`;
  }

  private normalizeSqlDateOperand(expression: string): string {
    const trimmed = expression.trim();
    const literalMatch = trimmed.match(/^'(\d{4}-\d{2}-\d{2})'$/);
    if (literalMatch) {
      return `DATE '${literalMatch[1]}'`;
    }
    return trimmed;
  }

  private stripTrailingSemicolon(sql: string): string {
    return sql.replace(/;\s*$/, '');
  }

  private findTopLevelComma(input: string): number {
    let depth = 0;
    let quote: "'" | '"' | null = null;

    for (let index = 0; index < input.length; index += 1) {
      const char = input[index];
      const nextChar = input[index + 1];

      if (quote) {
        if (char === quote) {
          if (nextChar === quote) {
            index += 1;
            continue;
          }
          quote = null;
        }
        continue;
      }

      if (char === "'" || char === '"') {
        quote = char;
        continue;
      }

      if (char === '(') {
        depth += 1;
        continue;
      }

      if (char === ')') {
        depth = Math.max(0, depth - 1);
        continue;
      }

      if (char === ',' && depth === 0) {
        return index;
      }
    }

    return -1;
  }

  private resolveDialectSourceBinding(
    project: Pick<Project, 'catalog' | 'schema'>,
    mdl: Manifest,
  ): {
    catalog?: string;
    schema?: string;
  } {
    const firstModelWithSourceBinding = mdl.models?.find(
      (model) =>
        model?.tableReference?.catalog || model?.tableReference?.schema,
    );

    if (firstModelWithSourceBinding?.tableReference) {
      return {
        catalog:
          firstModelWithSourceBinding.tableReference.catalog || undefined,
        schema: firstModelWithSourceBinding.tableReference.schema || undefined,
      };
    }

    return {
      catalog: project.catalog || undefined,
      schema: project.schema || undefined,
    };
  }

  private transformDataType(data: IbisQueryResponse): PreviewDataResponse {
    const columns = data.columns;
    const dtypes = data.dtypes;
    const transformedColumns = columns.map((column) => {
      let type = 'unknown';
      if (dtypes && dtypes[column]) {
        type = dtypes[column] === 'object' ? 'string' : dtypes[column];
      }
      if (type === 'unknown') {
        logger.debug(`Did not find type mapping for "${column}"`);
        logger.debug(
          `dtypes mapping: ${dtypes ? JSON.stringify(dtypes, null, 2) : 'undefined'} `,
        );
      }
      return {
        name: column,
        type,
      } as ColumnMetadata;
    });
    return {
      columns: transformedColumns,
      data: data.data.map((row) =>
        Array.isArray(row)
          ? row.map((value) => this.normalizePreviewCellValue(value))
          : row,
      ),
    } as PreviewDataResponse;
  }

  private normalizePreviewCellValue(value: unknown): unknown {
    if (typeof value === 'number' && Number.isNaN(value)) {
      return null;
    }

    if (typeof value === 'string' && value.trim().toLowerCase() === 'nan') {
      return null;
    }

    return value;
  }

  private async executeIbisDryRun(
    sql: string,
    options: {
      dataSource: DataSourceName;
      connectionInfo: any;
      mdl: Manifest;
    },
  ): Promise<IbisResponse> {
    const res = await this.ibisAdaptor.dryRun(sql, options);
    return {
      correlationId: res.correlationId,
      processTime: res.processTime,
    };
  }

  private async executeIbisQuery(
    sql: string,
    options: {
      dataSource: DataSourceName;
      connectionInfo: any;
      mdl: Manifest;
      limit: number;
      refresh?: boolean;
      cacheEnabled?: boolean;
    },
  ): Promise<PreviewDataResponse> {
    const res = await this.ibisAdaptor.query(sql, options);
    const data = this.transformDataType(res);
    return {
      correlationId: res.correlationId,
      processTime: res.processTime,
      cacheHit: res.cacheHit,
      cacheCreatedAt: res.cacheCreatedAt,
      cacheOverrodeAt: res.cacheOverrodeAt,
      override: res.override,
      ...data,
    };
  }

  private sendIbisEvent(
    event: TelemetryEvent,
    res: IbisResponse,
    others: Record<string, any>,
  ) {
    this.telemetry.sendEvent(event, {
      correlationId: res.correlationId,
      processTime: res.processTime,
      ...others,
    });
  }

  private sendIbisFailedEvent(
    event: TelemetryEvent,
    err: any,
    others: Record<string, any>,
  ) {
    this.telemetry.sendEvent(
      event,
      {
        correlationId: err.extensions?.other?.correlationId,
        processTime: err.extensions?.other?.processTime,
        error: err.message,
        ...others,
      },
      err.extensions?.service,
      false,
    );
  }
}

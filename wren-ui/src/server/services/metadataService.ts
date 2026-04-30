/**
    This class is responsible for handling the retrieval of metadata from the connection.
    For DuckDB, we control the access logic and directly query the WrenEngine.
    For PostgreSQL and BigQuery, we will use the Ibis server API.
 */

import { IIbisAdaptor } from '../adaptors/ibisAdaptor';
import { IWrenEngineAdaptor } from '../adaptors/wrenEngineAdaptor';
import { DUCKDB_CONNECTION_INFO, Project } from '../repositories';
import { DataSourceName } from '../types';
import { getLogger } from '@server/utils';

const logger = getLogger('MetadataService');
logger.level = 'debug';

export interface CompactColumn {
  name: string;
  type: string;
  notNull: boolean;
  description?: string;
  properties?: Record<string, any>;
  nestedColumns?: CompactColumn[];
}

export enum ConstraintType {
  PRIMARY_KEY = 'PRIMARY KEY',
  FOREIGN_KEY = 'FOREIGN KEY',
  UNIQUE = 'UNIQUE',
}

export interface CompactTable {
  name: string;
  columns: CompactColumn[];
  description?: string;
  properties?: Record<string, any>;
  primaryKey?: string;
}

export interface RecommendConstraint {
  constraintName: string;
  constraintType: ConstraintType;
  constraintTable: string;
  constraintColumn: string;
  constraintedTable: string;
  constraintedColumn: string;
}

export interface IConnectionMetadataService {
  listTables(project: Project): Promise<CompactTable[]>;
  listConstraints(project: Project): Promise<RecommendConstraint[]>;
  getVersion(project: Project): Promise<string>;
}

export class ConnectionMetadataService implements IConnectionMetadataService {
  private readonly ibisAdaptor: IIbisAdaptor;
  private readonly wrenEngineAdaptor: IWrenEngineAdaptor;

  constructor({
    ibisAdaptor,
    wrenEngineAdaptor,
  }: {
    ibisAdaptor: IIbisAdaptor;
    wrenEngineAdaptor: IWrenEngineAdaptor;
  }) {
    this.ibisAdaptor = ibisAdaptor;
    this.wrenEngineAdaptor = wrenEngineAdaptor;
  }

  public async listTables(project: Project): Promise<CompactTable[]> {
    const { type: connectionType, connectionInfo } = project;
    if (connectionType === DataSourceName.DUCKDB) {
      await this.prepareDuckDbRuntime(connectionInfo as DUCKDB_CONNECTION_INFO);
      const tables = await this.wrenEngineAdaptor.listTables();
      return tables;
    }
    return await this.ibisAdaptor.getTables(connectionType, connectionInfo);
  }

  public async listConstraints(
    project: Project,
  ): Promise<RecommendConstraint[]> {
    const { type: connectionType, connectionInfo } = project;
    if (connectionType === DataSourceName.DUCKDB) {
      return [];
    }
    return await this.ibisAdaptor.getConstraints(
      connectionType,
      connectionInfo,
    );
  }

  public async getVersion(project: Project): Promise<string> {
    const { type: connectionType, connectionInfo } = project;
    if (connectionType === DataSourceName.DUCKDB) {
      await this.prepareDuckDbRuntime(connectionInfo as DUCKDB_CONNECTION_INFO);
      return 'DuckDB runtime';
    }
    return await this.ibisAdaptor.getVersion(connectionType, connectionInfo);
  }

  private async prepareDuckDbRuntime(
    connectionInfo: DUCKDB_CONNECTION_INFO,
  ): Promise<void> {
    await this.wrenEngineAdaptor.prepareDuckDB({
      initSql: buildDuckDbInitSql(connectionInfo),
      sessionProps: normalizeDuckDbSessionProps(connectionInfo),
    });
    await this.wrenEngineAdaptor.patchConfig({
      'wren.datasource.type': 'duckdb',
    });
  }
}

const buildDuckDbInitSql = (connectionInfo: DUCKDB_CONNECTION_INFO): string => {
  const initSql =
    typeof connectionInfo?.initSql === 'string' ? connectionInfo.initSql : '';
  const extensions = Array.isArray(connectionInfo?.extensions)
    ? connectionInfo.extensions.filter(
        (extension): extension is string =>
          typeof extension === 'string' && extension.trim().length > 0,
      )
    : [];
  const installExtensionsSql = extensions
    .map((extension) => `INSTALL ${extension};`)
    .join('\n');

  return [installExtensionsSql, initSql].filter(Boolean).join('\n');
};

const normalizeDuckDbSessionProps = (
  connectionInfo: DUCKDB_CONNECTION_INFO,
) => {
  const configurations = connectionInfo?.configurations;
  return configurations && typeof configurations === 'object'
    ? configurations
    : {};
};

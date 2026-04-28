import { Knex } from 'knex';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';
import {
  BaseRepository,
  IBasicRepository,
  IQueryOptions,
} from './baseRepository';
import type { PersistedRuntimeIdentity } from '@server/context/runtimeScope';

export type SpreadsheetSqlMode = 'wren' | 'dialect';

export interface SpreadsheetRuntimeIdentity {
  projectId?: number | null;
  workspaceId?: string | null;
  knowledgeBaseId?: string | null;
  kbSnapshotId?: string | null;
  deployHash?: string | null;
  actorUserId?: string | null;
}

export interface Spreadsheet {
  id: number;
  projectId?: number | null;
  workspaceId?: string | null;
  knowledgeBaseId?: string | null;
  kbSnapshotId?: string | null;
  deployHash?: string | null;
  actorUserId?: string | null;
  name: string;
  sql: string;
  sqlMode?: SpreadsheetSqlMode | null;
  matchedQuestion?: string | null;
  matchedViewId?: number | null;
  sourceThreadId?: number | null;
  sourceResponseId?: number | null;
  currentVersion: number;
  isShared: boolean;
  folderId?: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface SpreadsheetSetting {
  id: number;
  spreadsheetId: number;
  hiddenColumns: string[];
  pinnedColumns: string[];
  unpinnedColumns: string[];
  columnWidths: Record<string, number>;
  createdAt?: string;
  updatedAt?: string;
}

export type SpreadsheetHistoryType =
  | 'INITIALIZE'
  | 'SAVE'
  | 'AI_OPERATION'
  | 'RESTORE';

export interface SpreadsheetHistory {
  id: number;
  spreadsheetId: number;
  version: number;
  type: SpreadsheetHistoryType;
  sql: string;
  payload: Record<string, any>;
  createdBy?: string | null;
  createdAt?: string;
}

export interface SpreadsheetDetail extends Spreadsheet {
  setting: SpreadsheetSetting | null;
  history: SpreadsheetHistory[];
}

export interface ISpreadsheetRepository extends IBasicRepository<Spreadsheet> {
  findAllVisibleByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<Spreadsheet[]>;
  findOneVisibleByRuntimeIdentity(
    id: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<Spreadsheet | null>;
  findBySourceResponseIdVisibleByRuntimeIdentity(
    sourceResponseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<Spreadsheet | null>;
}

export interface ISpreadsheetSettingRepository extends IBasicRepository<SpreadsheetSetting> {
  findOneBySpreadsheetId(
    spreadsheetId: number,
    queryOptions?: IQueryOptions,
  ): Promise<SpreadsheetSetting | null>;
}

export interface ISpreadsheetHistoryRepository extends IBasicRepository<SpreadsheetHistory> {
  findAllBySpreadsheetId(
    spreadsheetId: number,
    queryOptions?: IQueryOptions,
  ): Promise<SpreadsheetHistory[]>;
}

const applyRuntimeVisibility = (
  query: Knex.QueryBuilder,
  runtimeIdentity: PersistedRuntimeIdentity,
) => {
  if (runtimeIdentity.workspaceId) {
    query.where('workspace_id', runtimeIdentity.workspaceId);
  } else if (runtimeIdentity.knowledgeBaseId) {
    query.where('knowledge_base_id', runtimeIdentity.knowledgeBaseId);
  } else if (runtimeIdentity.kbSnapshotId) {
    query.where('kb_snapshot_id', runtimeIdentity.kbSnapshotId);
  } else if (runtimeIdentity.deployHash) {
    query.where('deploy_hash', runtimeIdentity.deployHash);
  } else if (runtimeIdentity.projectId != null) {
    query.where('project_id', runtimeIdentity.projectId);
  } else {
    query.whereNull('project_id').whereNull('workspace_id');
  }

  if (runtimeIdentity.actorUserId) {
    query.andWhere((builder) => {
      builder
        .where('is_shared', true)
        .orWhere('actor_user_id', runtimeIdentity.actorUserId)
        .orWhereNull('actor_user_id');
    });
  }
};

const parseJsonArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }

  if (typeof value === 'string' && value) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : [];
    } catch (_error) {
      return [];
    }
  }

  return [];
};

const parseJsonObject = (value: unknown): Record<string, number> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, number>;
  }

  if (typeof value === 'string' && value) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, number>)
        : {};
    } catch (_error) {
      return {};
    }
  }

  return {};
};

export class SpreadsheetRepository
  extends BaseRepository<Spreadsheet>
  implements ISpreadsheetRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'spreadsheet' });
  }

  public async findAllVisibleByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<Spreadsheet[]> {
    const query = this.knex(this.tableName).orderBy('updated_at', 'desc');
    applyRuntimeVisibility(query, runtimeIdentity);
    const rows = await query;
    return rows.map((row) => this.transformFromDBData(row));
  }

  public async findOneVisibleByRuntimeIdentity(
    id: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<Spreadsheet | null> {
    const query = this.knex(this.tableName).where({ id }).first();
    applyRuntimeVisibility(query, runtimeIdentity);
    const row = await query;
    return row ? this.transformFromDBData(row) : null;
  }

  public async findBySourceResponseIdVisibleByRuntimeIdentity(
    sourceResponseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<Spreadsheet | null> {
    const query = this.knex(this.tableName)
      .where({ source_response_id: sourceResponseId })
      .orderBy('updated_at', 'desc')
      .first();
    applyRuntimeVisibility(query, runtimeIdentity);
    const row = await query;
    return row ? this.transformFromDBData(row) : null;
  }
}

export class SpreadsheetSettingRepository
  extends BaseRepository<SpreadsheetSetting>
  implements ISpreadsheetSettingRepository
{
  private readonly arrayJsonbColumns = [
    'hiddenColumns',
    'pinnedColumns',
    'unpinnedColumns',
  ];
  private readonly objectJsonbColumns = ['columnWidths'];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'spreadsheet_setting' });
  }

  public async findOneBySpreadsheetId(
    spreadsheetId: number,
    queryOptions?: IQueryOptions,
  ): Promise<SpreadsheetSetting | null> {
    return await this.findOneBy({ spreadsheetId }, queryOptions);
  }

  protected override transformFromDBData = (data: any) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const camelCaseData = mapKeys(data, (_value, key) => camelCase(key));
    const transformData = mapValues(camelCaseData, (value, key) => {
      if (this.arrayJsonbColumns.includes(key)) {
        return parseJsonArray(value);
      }
      if (this.objectJsonbColumns.includes(key)) {
        return parseJsonObject(value);
      }
      return value;
    });
    return transformData as SpreadsheetSetting;
  };

  protected override transformToDBData = (data: any) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const transformedData = mapValues(data, (value, key) => {
      if (this.arrayJsonbColumns.includes(key)) {
        return JSON.stringify(parseJsonArray(value));
      }
      if (this.objectJsonbColumns.includes(key)) {
        return JSON.stringify(parseJsonObject(value));
      }
      return value;
    });
    return mapKeys(transformedData, (_value, key) => snakeCase(key));
  };
}

export class SpreadsheetHistoryRepository
  extends BaseRepository<SpreadsheetHistory>
  implements ISpreadsheetHistoryRepository
{
  private readonly jsonbColumns = ['payload'];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'spreadsheet_history' });
  }

  public async findAllBySpreadsheetId(
    spreadsheetId: number,
    queryOptions?: IQueryOptions,
  ): Promise<SpreadsheetHistory[]> {
    return await this.findAllBy(
      { spreadsheetId },
      { ...queryOptions, order: 'version desc' },
    );
  }

  protected override transformFromDBData = (data: any) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const camelCaseData = mapKeys(data, (_value, key) => camelCase(key));
    const transformData = mapValues(camelCaseData, (value, key) => {
      if (this.jsonbColumns.includes(key)) {
        return parseJsonObject(value) as Record<string, any>;
      }
      return value;
    });
    return transformData as SpreadsheetHistory;
  };

  protected override transformToDBData = (data: any) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const transformedData = mapValues(data, (value, key) => {
      if (this.jsonbColumns.includes(key)) {
        return JSON.stringify(
          value && typeof value === 'object' && !Array.isArray(value)
            ? value
            : {},
        );
      }
      return value;
    });
    return mapKeys(transformedData, (_value, key) => snakeCase(key));
  };
}

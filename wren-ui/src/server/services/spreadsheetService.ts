import type { PersistedRuntimeIdentity } from '@server/context/runtimeScope';
import {
  ISpreadsheetHistoryRepository,
  ISpreadsheetRepository,
  ISpreadsheetSettingRepository,
  Spreadsheet,
  SpreadsheetDetail,
  SpreadsheetHistoryType,
  SpreadsheetRuntimeIdentity,
  SpreadsheetSetting,
  SpreadsheetSqlMode,
} from '@server/repositories';
import { normalizeCanonicalPersistedRuntimeIdentity } from '@server/utils/persistedRuntimeIdentity';

export interface SpreadsheetServiceDependencies {
  spreadsheetRepository: ISpreadsheetRepository;
  spreadsheetSettingRepository: ISpreadsheetSettingRepository;
  spreadsheetHistoryRepository: ISpreadsheetHistoryRepository;
}

export interface CreateSpreadsheetInput {
  runtimeIdentity: SpreadsheetRuntimeIdentity;
  name: string;
  sql: string;
  sqlMode?: SpreadsheetSqlMode | null;
  matchedQuestion?: string | null;
  matchedViewId?: number | null;
  sourceThreadId?: number | null;
  sourceResponseId?: number | null;
  createdBy?: string | null;
}

export type CreateSpreadsheetResult = SpreadsheetDetail & {
  alreadyExists?: boolean;
};

export interface UpdateSpreadsheetSettingInput {
  hiddenColumns?: string[];
  pinnedColumns?: string[];
  unpinnedColumns?: string[];
  columnWidths?: Record<string, number>;
}

export interface SaveSpreadsheetVersionInput {
  sql: string;
  sqlMode?: SpreadsheetSqlMode | null;
  type?: SpreadsheetHistoryType;
  payload?: Record<string, any>;
  updatedBy?: string | null;
}

export interface ISpreadsheetService {
  listSpreadsheets(
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<Spreadsheet[]>;
  getSpreadsheetDetail(
    id: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<SpreadsheetDetail | null>;
  createSpreadsheet(
    input: CreateSpreadsheetInput,
  ): Promise<CreateSpreadsheetResult>;
  updateSpreadsheet(
    id: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    input: {
      name?: string;
      isShared?: boolean;
      folderId?: string | null;
      updatedBy?: string | null;
    },
  ): Promise<SpreadsheetDetail>;
  updateSpreadsheetSetting(
    id: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    input: UpdateSpreadsheetSettingInput,
  ): Promise<SpreadsheetDetail>;
  saveSpreadsheetVersion(
    id: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    input: SaveSpreadsheetVersionInput,
  ): Promise<SpreadsheetDetail>;
  deleteSpreadsheet(
    id: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<boolean>;
}

const DEFAULT_SPREADSHEET_NAME = '未命名数据表';
const SPREADSHEET_SOURCE_RESPONSE_ACTOR_UNIQUE_INDEX =
  'spreadsheet_source_response_actor_unique';

const isUniqueConstraintViolation = (error: unknown, constraintName: string) =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === '23505' &&
  (!(error as { constraint?: unknown }).constraint ||
    (error as { constraint?: unknown }).constraint === constraintName);

const markExistingSpreadsheet = (
  spreadsheet: SpreadsheetDetail,
): CreateSpreadsheetResult => ({
  ...spreadsheet,
  alreadyExists: true,
});

const trimText = (value?: string | null) => String(value || '').trim();

const normalizeName = (name?: string | null) => {
  const normalizedName = trimText(name);
  return normalizedName || DEFAULT_SPREADSHEET_NAME;
};

const normalizeSql = (sql?: string | null) => {
  const normalizedSql = trimText(sql);
  if (!normalizedSql) {
    throw new Error('Spreadsheet SQL is required.');
  }
  return normalizedSql;
};

const normalizeRuntimeIdentity = (
  runtimeIdentity: SpreadsheetRuntimeIdentity,
): PersistedRuntimeIdentity =>
  normalizeCanonicalPersistedRuntimeIdentity({
    projectId: runtimeIdentity.projectId ?? null,
    workspaceId: runtimeIdentity.workspaceId ?? null,
    knowledgeBaseId: runtimeIdentity.knowledgeBaseId ?? null,
    kbSnapshotId: runtimeIdentity.kbSnapshotId ?? null,
    deployHash: runtimeIdentity.deployHash ?? null,
    actorUserId: runtimeIdentity.actorUserId ?? null,
  });

const normalizeStringArray = (value?: string[] | null) =>
  Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ),
  );

const normalizeColumnWidths = (value?: Record<string, number> | null) =>
  Object.entries(value || {}).reduce<Record<string, number>>(
    (result, [column, width]) => {
      const normalizedColumn = String(column || '').trim();
      const normalizedWidth = Number(width);
      if (normalizedColumn && Number.isFinite(normalizedWidth)) {
        result[normalizedColumn] = normalizedWidth;
      }
      return result;
    },
    {},
  );

export class SpreadsheetPermissionError extends Error {
  public statusCode = 403;

  constructor(message = 'Spreadsheet write access denied.') {
    super(message);
    this.name = 'SpreadsheetPermissionError';
  }
}

const assertSpreadsheetOwnerWriteAccess = (
  spreadsheet: Spreadsheet,
  runtimeIdentity: PersistedRuntimeIdentity,
) => {
  if (
    runtimeIdentity.actorUserId &&
    spreadsheet.actorUserId &&
    spreadsheet.actorUserId !== runtimeIdentity.actorUserId
  ) {
    throw new SpreadsheetPermissionError();
  }
};

export class SpreadsheetService implements ISpreadsheetService {
  private readonly spreadsheetRepository: ISpreadsheetRepository;
  private readonly spreadsheetSettingRepository: ISpreadsheetSettingRepository;
  private readonly spreadsheetHistoryRepository: ISpreadsheetHistoryRepository;

  constructor({
    spreadsheetRepository,
    spreadsheetSettingRepository,
    spreadsheetHistoryRepository,
  }: SpreadsheetServiceDependencies) {
    this.spreadsheetRepository = spreadsheetRepository;
    this.spreadsheetSettingRepository = spreadsheetSettingRepository;
    this.spreadsheetHistoryRepository = spreadsheetHistoryRepository;
  }

  public async listSpreadsheets(runtimeIdentity: PersistedRuntimeIdentity) {
    return await this.spreadsheetRepository.findAllVisibleByRuntimeIdentity(
      runtimeIdentity,
    );
  }

  public async getSpreadsheetDetail(
    id: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<SpreadsheetDetail | null> {
    const spreadsheet =
      await this.spreadsheetRepository.findOneVisibleByRuntimeIdentity(
        id,
        runtimeIdentity,
      );
    if (!spreadsheet) {
      return null;
    }

    return await this.resolveSpreadsheetDetail(spreadsheet);
  }

  public async createSpreadsheet(
    input: CreateSpreadsheetInput,
  ): Promise<CreateSpreadsheetResult> {
    const runtimeIdentity = normalizeRuntimeIdentity(input.runtimeIdentity);
    const sourceResponseId = input.sourceResponseId ?? null;
    if (sourceResponseId != null) {
      const existing =
        await this.spreadsheetRepository.findBySourceResponseIdVisibleByRuntimeIdentity(
          sourceResponseId,
          runtimeIdentity,
        );
      if (existing) {
        return markExistingSpreadsheet(
          await this.resolveSpreadsheetDetail(existing),
        );
      }
    }

    const tx = await this.spreadsheetRepository.transaction();
    try {
      const spreadsheet = await this.spreadsheetRepository.createOne(
        {
          projectId: runtimeIdentity.projectId ?? null,
          workspaceId: runtimeIdentity.workspaceId ?? null,
          knowledgeBaseId: runtimeIdentity.knowledgeBaseId ?? null,
          kbSnapshotId: runtimeIdentity.kbSnapshotId ?? null,
          deployHash: runtimeIdentity.deployHash ?? null,
          actorUserId: runtimeIdentity.actorUserId ?? null,
          name: normalizeName(input.name),
          sql: normalizeSql(input.sql),
          sqlMode: input.sqlMode ?? null,
          matchedQuestion: trimText(input.matchedQuestion) || null,
          matchedViewId: input.matchedViewId ?? null,
          sourceThreadId: input.sourceThreadId ?? null,
          sourceResponseId,
          currentVersion: 1,
          isShared: false,
          folderId: null,
          createdBy: input.createdBy ?? runtimeIdentity.actorUserId ?? null,
          updatedBy: input.createdBy ?? runtimeIdentity.actorUserId ?? null,
        },
        { tx },
      );
      const setting = await this.spreadsheetSettingRepository.createOne(
        {
          spreadsheetId: spreadsheet.id,
          hiddenColumns: [],
          pinnedColumns: [],
          unpinnedColumns: [],
          columnWidths: {},
        },
        { tx },
      );
      const history = await this.spreadsheetHistoryRepository.createOne(
        {
          spreadsheetId: spreadsheet.id,
          version: 1,
          type: 'INITIALIZE',
          sql: spreadsheet.sql,
          payload: {
            sourceResponseId: spreadsheet.sourceResponseId ?? null,
            sourceThreadId: spreadsheet.sourceThreadId ?? null,
          },
          createdBy: spreadsheet.createdBy ?? null,
        },
        { tx },
      );

      await this.spreadsheetRepository.commit(tx);
      return { ...spreadsheet, setting, history: [history] };
    } catch (error) {
      await this.spreadsheetRepository.rollback(tx);
      if (
        sourceResponseId != null &&
        isUniqueConstraintViolation(
          error,
          SPREADSHEET_SOURCE_RESPONSE_ACTOR_UNIQUE_INDEX,
        )
      ) {
        const existing =
          await this.spreadsheetRepository.findBySourceResponseIdVisibleByRuntimeIdentity(
            sourceResponseId,
            runtimeIdentity,
          );
        if (existing) {
          return markExistingSpreadsheet(
            await this.resolveSpreadsheetDetail(existing),
          );
        }
      }

      throw error;
    }
  }

  public async updateSpreadsheet(
    id: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    input: {
      name?: string;
      isShared?: boolean;
      folderId?: string | null;
      updatedBy?: string | null;
    },
  ): Promise<SpreadsheetDetail> {
    const spreadsheet = await this.requireSpreadsheetWriteAccess(
      id,
      runtimeIdentity,
    );
    const name =
      input.name === undefined ? spreadsheet.name : normalizeName(input.name);
    const folderId =
      input.folderId === undefined
        ? spreadsheet.folderId
        : trimText(input.folderId) || null;
    const updated = await this.spreadsheetRepository.updateOne(id, {
      name,
      ...(input.isShared !== undefined
        ? { isShared: Boolean(input.isShared) }
        : {}),
      folderId,
      updatedBy: input.updatedBy ?? spreadsheet.updatedBy ?? null,
    });
    return await this.resolveSpreadsheetDetail(updated);
  }

  public async updateSpreadsheetSetting(
    id: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    input: UpdateSpreadsheetSettingInput,
  ): Promise<SpreadsheetDetail> {
    const spreadsheet = await this.requireSpreadsheetWriteAccess(
      id,
      runtimeIdentity,
    );
    const existingSetting =
      await this.spreadsheetSettingRepository.findOneBySpreadsheetId(id);
    const patch: Partial<SpreadsheetSetting> = {};

    if (input.hiddenColumns !== undefined) {
      patch.hiddenColumns = normalizeStringArray(input.hiddenColumns);
    }
    if (input.pinnedColumns !== undefined) {
      patch.pinnedColumns = normalizeStringArray(input.pinnedColumns);
    }
    if (input.unpinnedColumns !== undefined) {
      patch.unpinnedColumns = normalizeStringArray(input.unpinnedColumns);
    }
    if (input.columnWidths !== undefined) {
      patch.columnWidths = normalizeColumnWidths(input.columnWidths);
    }

    if (existingSetting) {
      await this.spreadsheetSettingRepository.updateOne(
        existingSetting.id,
        patch,
      );
    } else {
      await this.spreadsheetSettingRepository.createOne({
        spreadsheetId: id,
        hiddenColumns: patch.hiddenColumns || [],
        pinnedColumns: patch.pinnedColumns || [],
        unpinnedColumns: patch.unpinnedColumns || [],
        columnWidths: patch.columnWidths || {},
      });
    }

    return await this.resolveSpreadsheetDetail(spreadsheet);
  }

  public async saveSpreadsheetVersion(
    id: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    input: SaveSpreadsheetVersionInput,
  ): Promise<SpreadsheetDetail> {
    const spreadsheet = await this.requireSpreadsheetWriteAccess(
      id,
      runtimeIdentity,
    );
    const nextVersion = spreadsheet.currentVersion + 1;
    const nextSql = normalizeSql(input.sql);
    const tx = await this.spreadsheetRepository.transaction();

    try {
      const updatedSpreadsheet = await this.spreadsheetRepository.updateOne(
        id,
        {
          sql: nextSql,
          ...(input.sqlMode !== undefined ? { sqlMode: input.sqlMode } : {}),
          currentVersion: nextVersion,
          updatedBy: input.updatedBy ?? spreadsheet.updatedBy ?? null,
        },
        { tx },
      );
      await this.spreadsheetHistoryRepository.createOne(
        {
          spreadsheetId: id,
          version: nextVersion,
          type: input.type || 'SAVE',
          sql: nextSql,
          payload: input.payload || {},
          createdBy: input.updatedBy ?? spreadsheet.updatedBy ?? null,
        },
        { tx },
      );

      await this.spreadsheetRepository.commit(tx);
      return await this.resolveSpreadsheetDetail(updatedSpreadsheet);
    } catch (error) {
      await this.spreadsheetRepository.rollback(tx);
      throw error;
    }
  }

  public async deleteSpreadsheet(
    id: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<boolean> {
    await this.requireSpreadsheetWriteAccess(id, runtimeIdentity);
    await this.spreadsheetRepository.deleteOne(id);
    return true;
  }

  private async requireSpreadsheet(
    id: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<Spreadsheet> {
    const spreadsheet =
      await this.spreadsheetRepository.findOneVisibleByRuntimeIdentity(
        id,
        runtimeIdentity,
      );
    if (!spreadsheet) {
      throw new Error(`Spreadsheet not found. id: ${id}`);
    }
    return spreadsheet;
  }

  private async requireSpreadsheetWriteAccess(
    id: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<Spreadsheet> {
    const spreadsheet = await this.requireSpreadsheet(id, runtimeIdentity);
    assertSpreadsheetOwnerWriteAccess(spreadsheet, runtimeIdentity);
    return spreadsheet;
  }

  private async resolveSpreadsheetDetail(
    spreadsheet: Spreadsheet,
  ): Promise<SpreadsheetDetail> {
    const [setting, history] = await Promise.all([
      this.spreadsheetSettingRepository.findOneBySpreadsheetId(spreadsheet.id),
      this.spreadsheetHistoryRepository.findAllBySpreadsheetId(spreadsheet.id),
    ]);

    return {
      ...spreadsheet,
      setting,
      history,
    };
  }
}

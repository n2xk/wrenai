import {
  buildRuntimeScopeUrl,
  resolveClientRuntimeScopeSelector,
  type ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import { parseRestJsonResponse } from './rest';

export type SpreadsheetSqlMode = 'wren' | 'dialect';

export type SpreadsheetSettingData = {
  id: number;
  spreadsheetId: number;
  hiddenColumns: string[];
  pinnedColumns: string[];
  unpinnedColumns: string[];
  columnWidths: Record<string, number>;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type SpreadsheetHistoryData = {
  id: number;
  spreadsheetId: number;
  version: number;
  type: 'INITIALIZE' | 'SAVE' | 'AI_OPERATION' | 'RESTORE';
  sql: string;
  payload?: Record<string, any> | null;
  createdBy?: string | null;
  createdAt?: string | null;
};

export type SpreadsheetListItem = {
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
  isShared?: boolean | null;
  folderId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type SpreadsheetDetailData = SpreadsheetListItem & {
  setting: SpreadsheetSettingData | null;
  history: SpreadsheetHistoryData[];
};

export type SpreadsheetPreviewData = {
  columns: Array<{ name: string; type: string }>;
  data: Array<Array<any>>;
  page: number;
  pageSize: number;
  rowCount: number;
  totalPages: number;
  cacheHit?: boolean;
  cacheCreatedAt?: string | null;
  cacheOverrodeAt?: string | null;
  override?: boolean;
};

export type CreateSpreadsheetInput = {
  responseId?: number;
  sql?: string;
  name?: string;
  matchedQuestion?: string;
};

export type UpdateSpreadsheetSettingInput = Partial<
  Pick<
    SpreadsheetSettingData,
    'hiddenColumns' | 'pinnedColumns' | 'unpinnedColumns' | 'columnWidths'
  >
>;

export const buildSpreadsheetListUrl = (
  selector = resolveClientRuntimeScopeSelector(),
) => buildRuntimeScopeUrl('/api/v1/spreadsheets', {}, selector);

export const buildSpreadsheetDetailUrl = (
  spreadsheetId: number,
  selector = resolveClientRuntimeScopeSelector(),
) =>
  buildRuntimeScopeUrl(`/api/v1/spreadsheets/${spreadsheetId}`, {}, selector);

export const buildSpreadsheetPreviewUrl = (
  spreadsheetId: number,
  selector = resolveClientRuntimeScopeSelector(),
) =>
  buildRuntimeScopeUrl(
    `/api/v1/spreadsheets/${spreadsheetId}/preview`,
    {},
    selector,
  );

export const buildSpreadsheetSettingUrl = (
  spreadsheetId: number,
  selector = resolveClientRuntimeScopeSelector(),
) =>
  buildRuntimeScopeUrl(
    `/api/v1/spreadsheets/${spreadsheetId}/setting`,
    {},
    selector,
  );

export const buildSpreadsheetSaveUrl = (
  spreadsheetId: number,
  selector = resolveClientRuntimeScopeSelector(),
) =>
  buildRuntimeScopeUrl(
    `/api/v1/spreadsheets/${spreadsheetId}/save`,
    {},
    selector,
  );

export const buildSpreadsheetOperationUrl = (
  spreadsheetId: number,
  selector = resolveClientRuntimeScopeSelector(),
) =>
  buildRuntimeScopeUrl(
    `/api/v1/spreadsheets/${spreadsheetId}/operations`,
    {},
    selector,
  );

export const resolveSpreadsheetRuntimeSelector = (
  spreadsheet?: Partial<SpreadsheetListItem> | null,
): ClientRuntimeScopeSelector => ({
  ...(spreadsheet?.workspaceId ? { workspaceId: spreadsheet.workspaceId } : {}),
  ...(spreadsheet?.knowledgeBaseId
    ? { knowledgeBaseId: spreadsheet.knowledgeBaseId }
    : {}),
  ...(spreadsheet?.kbSnapshotId
    ? { kbSnapshotId: spreadsheet.kbSnapshotId }
    : {}),
  ...(spreadsheet?.deployHash ? { deployHash: spreadsheet.deployHash } : {}),
});

export const loadSpreadsheetListPayload = async ({
  selector,
  fetcher = fetch,
}: {
  selector?: ClientRuntimeScopeSelector;
  fetcher?: typeof fetch;
}) => {
  const response = await fetcher(buildSpreadsheetListUrl(selector), {
    cache: 'no-store',
  });
  return parseRestJsonResponse<SpreadsheetListItem[]>(
    response,
    '加载数据表列表失败，请稍后重试。',
  );
};

export const loadSpreadsheetDetailPayload = async ({
  spreadsheetId,
  selector,
  fetcher = fetch,
}: {
  spreadsheetId: number;
  selector?: ClientRuntimeScopeSelector;
  fetcher?: typeof fetch;
}) => {
  const response = await fetcher(
    buildSpreadsheetDetailUrl(spreadsheetId, selector),
    {
      cache: 'no-store',
    },
  );
  return parseRestJsonResponse<SpreadsheetDetailData>(
    response,
    '加载数据表失败，请稍后重试。',
  );
};

export const createSpreadsheet = async (
  selector: ClientRuntimeScopeSelector,
  data: CreateSpreadsheetInput,
) => {
  const response = await fetch(buildSpreadsheetListUrl(selector), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return parseRestJsonResponse<SpreadsheetDetailData>(
    response,
    '保存为数据表失败，请稍后重试。',
  );
};

export const updateSpreadsheet = async (
  selector: ClientRuntimeScopeSelector,
  spreadsheetId: number,
  data: { name?: string; isShared?: boolean; folderId?: string | null },
) => {
  const response = await fetch(
    buildSpreadsheetDetailUrl(spreadsheetId, selector),
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
  );
  return parseRestJsonResponse<SpreadsheetDetailData>(
    response,
    '更新数据表失败，请稍后重试。',
  );
};

export const deleteSpreadsheet = async (
  selector: ClientRuntimeScopeSelector,
  spreadsheetId: number,
) => {
  const response = await fetch(
    buildSpreadsheetDetailUrl(spreadsheetId, selector),
    {
      method: 'DELETE',
    },
  );
  return parseRestJsonResponse<{ success: boolean }>(
    response,
    '删除数据表失败，请稍后重试。',
  );
};

export const previewSpreadsheet = async (
  selector: ClientRuntimeScopeSelector,
  spreadsheetId: number,
  data: { page?: number; pageSize?: number; refresh?: boolean },
) => {
  const response = await fetch(
    buildSpreadsheetPreviewUrl(spreadsheetId, selector),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
  );
  return parseRestJsonResponse<SpreadsheetPreviewData>(
    response,
    '加载数据表预览失败，请稍后重试。',
  );
};

export const updateSpreadsheetSetting = async (
  selector: ClientRuntimeScopeSelector,
  spreadsheetId: number,
  data: UpdateSpreadsheetSettingInput,
) => {
  const response = await fetch(
    buildSpreadsheetSettingUrl(spreadsheetId, selector),
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
  );
  return parseRestJsonResponse<SpreadsheetDetailData>(
    response,
    '更新数据表列设置失败，请稍后重试。',
  );
};

export const saveSpreadsheetVersion = async (
  selector: ClientRuntimeScopeSelector,
  spreadsheetId: number,
  data: { sql: string; type?: string; payload?: Record<string, any> },
) => {
  const response = await fetch(
    buildSpreadsheetSaveUrl(spreadsheetId, selector),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
  );
  return parseRestJsonResponse<SpreadsheetDetailData>(
    response,
    '保存数据表失败，请稍后重试。',
  );
};

export type SpreadsheetAiOperationType =
  | 'FILTER'
  | 'CLEANING'
  | 'GROUPING'
  | 'ENRICHMENT';

export type RunSpreadsheetAiOperationInput = {
  operationType: SpreadsheetAiOperationType;
  instruction: string;
};

export type RunSpreadsheetAiOperationResponse = {
  spreadsheet: SpreadsheetDetailData;
  preview: SpreadsheetPreviewData;
  operation: {
    type: SpreadsheetAiOperationType;
    instruction: string;
    queryId: string | null;
    generationMode?: 'structured' | 'ai';
    generatedSql: string;
  };
};

export const runSpreadsheetAiOperation = async (
  selector: ClientRuntimeScopeSelector,
  spreadsheetId: number,
  data: RunSpreadsheetAiOperationInput,
) => {
  const response = await fetch(
    buildSpreadsheetOperationUrl(spreadsheetId, selector),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
  );
  return parseRestJsonResponse<RunSpreadsheetAiOperationResponse>(
    response,
    '执行数据表 AI 操作失败，请稍后重试。',
  );
};

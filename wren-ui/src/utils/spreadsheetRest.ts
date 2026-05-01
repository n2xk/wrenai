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
  alreadyExists?: boolean;
  setting: SpreadsheetSettingData | null;
  history: SpreadsheetHistoryData[];
};

export type SpreadsheetPreviewData = {
  columns: Array<{ name: string; type: string }>;
  data: Array<Array<any>>;
  page: number;
  pageSize: number;
  rowCount?: number | null;
  totalPages?: number | null;
  hasMore?: boolean;
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

type TimedCacheEntry<TPayload> = {
  value: TPayload;
  updatedAt: number;
};

const SPREADSHEET_CACHE_TTL_MS = 30_000;
const spreadsheetListCache = new Map<
  string,
  TimedCacheEntry<SpreadsheetListItem[]>
>();
const spreadsheetListRequests = new Map<
  string,
  Promise<SpreadsheetListItem[]>
>();
const spreadsheetDetailCache = new Map<
  string,
  TimedCacheEntry<SpreadsheetDetailData>
>();
const spreadsheetDetailRequests = new Map<
  string,
  Promise<SpreadsheetDetailData>
>();

const getFreshCachedValue = <TPayload>(
  cache: Map<string, TimedCacheEntry<TPayload>>,
  requestUrl: string,
) => {
  const cached = cache.get(requestUrl);
  if (!cached) {
    return null;
  }

  if (Date.now() - cached.updatedAt > SPREADSHEET_CACHE_TTL_MS) {
    cache.delete(requestUrl);
    return null;
  }

  return cached.value;
};

export const clearSpreadsheetRestCache = () => {
  spreadsheetListCache.clear();
  spreadsheetListRequests.clear();
  spreadsheetDetailCache.clear();
  spreadsheetDetailRequests.clear();
};

export const peekSpreadsheetListPayload = ({
  selector,
  requestUrl,
}: {
  selector?: ClientRuntimeScopeSelector;
  requestUrl?: string;
}) => {
  const resolvedRequestUrl = requestUrl || buildSpreadsheetListUrl(selector);
  return getFreshCachedValue(spreadsheetListCache, resolvedRequestUrl);
};

export const primeSpreadsheetListPayload = ({
  selector,
  requestUrl,
  payload,
}: {
  selector?: ClientRuntimeScopeSelector;
  requestUrl?: string;
  payload: SpreadsheetListItem[];
}) => {
  const resolvedRequestUrl = requestUrl || buildSpreadsheetListUrl(selector);
  spreadsheetListCache.set(resolvedRequestUrl, {
    value: payload,
    updatedAt: Date.now(),
  });
};

export const peekSpreadsheetDetailPayload = ({
  selector,
  requestUrl,
  spreadsheetId,
}: {
  selector?: ClientRuntimeScopeSelector;
  requestUrl?: string;
  spreadsheetId?: number;
}) => {
  const resolvedRequestUrl =
    requestUrl ||
    (spreadsheetId != null
      ? buildSpreadsheetDetailUrl(spreadsheetId, selector)
      : null);
  if (!resolvedRequestUrl) {
    return null;
  }

  return getFreshCachedValue(spreadsheetDetailCache, resolvedRequestUrl);
};

export const primeSpreadsheetDetailPayload = ({
  selector,
  requestUrl,
  spreadsheetId,
  payload,
}: {
  selector?: ClientRuntimeScopeSelector;
  requestUrl?: string;
  spreadsheetId?: number;
  payload: SpreadsheetDetailData;
}) => {
  const resolvedRequestUrl =
    requestUrl ||
    (spreadsheetId != null
      ? buildSpreadsheetDetailUrl(spreadsheetId, selector)
      : null);
  if (!resolvedRequestUrl) {
    return;
  }

  spreadsheetDetailCache.set(resolvedRequestUrl, {
    value: payload,
    updatedAt: Date.now(),
  });
};

const upsertSpreadsheetListItem = (
  selector: ClientRuntimeScopeSelector,
  spreadsheet: SpreadsheetListItem,
) => {
  buildSpreadsheetListCacheUrls(selector, spreadsheet).forEach((requestUrl) => {
    const cached = getFreshCachedValue(spreadsheetListCache, requestUrl);
    if (!cached) {
      return;
    }

    const exists = cached.some((item) => item.id === spreadsheet.id);
    const nextPayload = exists
      ? cached.map((item) => (item.id === spreadsheet.id ? spreadsheet : item))
      : [spreadsheet, ...cached];
    primeSpreadsheetListPayload({ requestUrl, payload: nextPayload });
  });
};

const removeSpreadsheetListItem = (
  selector: ClientRuntimeScopeSelector,
  spreadsheetId: number,
) => {
  buildSpreadsheetListCacheUrls(selector).forEach((requestUrl) => {
    const cached = getFreshCachedValue(spreadsheetListCache, requestUrl);
    if (!cached) {
      return;
    }

    primeSpreadsheetListPayload({
      requestUrl,
      payload: cached.filter((item) => item.id !== spreadsheetId),
    });
  });
};

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

const resolveSpreadsheetWorkspaceListSelector = (
  selector: ClientRuntimeScopeSelector,
  spreadsheet?: Partial<SpreadsheetListItem> | null,
): ClientRuntimeScopeSelector => {
  if (selector.runtimeScopeId) {
    return { runtimeScopeId: selector.runtimeScopeId };
  }

  const workspaceId = selector.workspaceId || spreadsheet?.workspaceId || '';
  if (workspaceId) {
    return { workspaceId };
  }

  return {};
};

const buildSpreadsheetListCacheUrls = (
  selector: ClientRuntimeScopeSelector,
  spreadsheet?: Partial<SpreadsheetListItem> | null,
) => {
  const hasSelectorValue = (candidate: ClientRuntimeScopeSelector) =>
    Object.values(candidate).some(Boolean);
  const spreadsheetSelector = resolveSpreadsheetRuntimeSelector(spreadsheet);
  const workspaceSelector = resolveSpreadsheetWorkspaceListSelector(
    selector,
    spreadsheet,
  );
  const selectors = [
    selector,
    ...(hasSelectorValue(spreadsheetSelector) ? [spreadsheetSelector] : []),
    ...(hasSelectorValue(workspaceSelector) ? [workspaceSelector] : []),
  ];
  const urls = selectors.map((candidate) => buildSpreadsheetListUrl(candidate));

  return Array.from(new Set(urls));
};

export const loadSpreadsheetListPayload = async ({
  selector,
  requestUrl,
  fetcher = fetch,
  useCache = true,
}: {
  selector?: ClientRuntimeScopeSelector;
  requestUrl?: string;
  fetcher?: typeof fetch;
  useCache?: boolean;
}) => {
  const resolvedRequestUrl = requestUrl || buildSpreadsheetListUrl(selector);

  if (useCache) {
    const cached = getFreshCachedValue(
      spreadsheetListCache,
      resolvedRequestUrl,
    );
    if (cached) {
      return cached;
    }
  }

  const pendingRequest = spreadsheetListRequests.get(resolvedRequestUrl);
  if (pendingRequest) {
    return pendingRequest;
  }

  const request = fetcher(resolvedRequestUrl, {
    cache: 'no-store',
  })
    .then((response) =>
      parseRestJsonResponse<SpreadsheetListItem[]>(
        response,
        '加载数据表列表失败，请稍后重试。',
      ),
    )
    .then((payload) => {
      primeSpreadsheetListPayload({ requestUrl: resolvedRequestUrl, payload });
      return payload;
    })
    .finally(() => {
      spreadsheetListRequests.delete(resolvedRequestUrl);
    });

  spreadsheetListRequests.set(resolvedRequestUrl, request);
  return request;
};

export const loadSpreadsheetDetailPayload = async ({
  spreadsheetId,
  selector,
  requestUrl,
  fetcher = fetch,
  useCache = true,
}: {
  spreadsheetId: number;
  selector?: ClientRuntimeScopeSelector;
  requestUrl?: string;
  fetcher?: typeof fetch;
  useCache?: boolean;
}) => {
  const resolvedRequestUrl =
    requestUrl || buildSpreadsheetDetailUrl(spreadsheetId, selector);

  if (useCache) {
    const cached = getFreshCachedValue(
      spreadsheetDetailCache,
      resolvedRequestUrl,
    );
    if (cached) {
      return cached;
    }
  }

  const pendingRequest = spreadsheetDetailRequests.get(resolvedRequestUrl);
  if (pendingRequest) {
    return pendingRequest;
  }

  const request = fetcher(resolvedRequestUrl, {
    cache: 'no-store',
  })
    .then((response) =>
      parseRestJsonResponse<SpreadsheetDetailData>(
        response,
        '加载数据表失败，请稍后重试。',
      ),
    )
    .then((payload) => {
      primeSpreadsheetDetailPayload({
        requestUrl: resolvedRequestUrl,
        payload,
      });
      return payload;
    })
    .finally(() => {
      spreadsheetDetailRequests.delete(resolvedRequestUrl);
    });

  spreadsheetDetailRequests.set(resolvedRequestUrl, request);
  return request;
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
  const payload = await parseRestJsonResponse<SpreadsheetDetailData>(
    response,
    '保存为数据表失败，请稍后重试。',
  );
  primeSpreadsheetDetailPayload({
    selector,
    spreadsheetId: payload.id,
    payload,
  });
  upsertSpreadsheetListItem(selector, payload);
  return payload;
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
  const payload = await parseRestJsonResponse<SpreadsheetDetailData>(
    response,
    '更新数据表失败，请稍后重试。',
  );
  primeSpreadsheetDetailPayload({ selector, spreadsheetId, payload });
  upsertSpreadsheetListItem(selector, payload);
  return payload;
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
  const payload = await parseRestJsonResponse<{ success: boolean }>(
    response,
    '删除数据表失败，请稍后重试。',
  );
  spreadsheetDetailCache.delete(
    buildSpreadsheetDetailUrl(spreadsheetId, selector),
  );
  removeSpreadsheetListItem(selector, spreadsheetId);
  return payload;
};

export const previewSpreadsheet = async (
  selector: ClientRuntimeScopeSelector,
  spreadsheetId: number,
  data: {
    page?: number;
    pageSize?: number;
    refresh?: boolean;
    includeCount?: boolean;
    countOnly?: boolean;
  },
  options?: { signal?: AbortSignal },
) => {
  const response = await fetch(
    buildSpreadsheetPreviewUrl(spreadsheetId, selector),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: options?.signal,
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
  const payload = await parseRestJsonResponse<SpreadsheetDetailData>(
    response,
    '更新数据表列设置失败，请稍后重试。',
  );
  primeSpreadsheetDetailPayload({ selector, spreadsheetId, payload });
  upsertSpreadsheetListItem(selector, payload);
  return payload;
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
  const payload = await parseRestJsonResponse<SpreadsheetDetailData>(
    response,
    '保存数据表失败，请稍后重试。',
  );
  primeSpreadsheetDetailPayload({ selector, spreadsheetId, payload });
  upsertSpreadsheetListItem(selector, payload);
  return payload;
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
  const payload =
    await parseRestJsonResponse<RunSpreadsheetAiOperationResponse>(
      response,
      '执行数据表 AI 操作失败，请稍后重试。',
    );
  primeSpreadsheetDetailPayload({
    selector,
    spreadsheetId,
    payload: payload.spreadsheet,
  });
  upsertSpreadsheetListItem(selector, payload.spreadsheet);
  return payload;
};

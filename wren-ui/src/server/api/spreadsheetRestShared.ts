import { ApiError } from '@/server/utils/apiUtils';
import type { IContext } from '@server/types';
import type { PreviewDataResponse } from '@server/services';
import type {
  Spreadsheet,
  SpreadsheetDetail,
  SpreadsheetRuntimeIdentity,
} from '@server/repositories';
import {
  assertDashboardExecutableRuntimeScope,
  assertDashboardKnowledgeBaseReadAccess,
  recordDashboardKnowledgeBaseReadAudit,
} from './dashboardRestShared';
import { toPersistedRuntimeIdentity } from '@server/context/runtimeScope';
import { normalizeCanonicalPersistedRuntimeIdentity } from '@server/utils/persistedRuntimeIdentity';

export const SPREADSHEET_DEFAULT_PAGE_SIZE = 100;
const SPREADSHEET_MAX_PAGE_SIZE = 500;

export const parseSpreadsheetId = (value: string | string[] | undefined) => {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(id) || id <= 0) {
    throw new ApiError('Spreadsheet id is required', 400);
  }
  return id;
};

export const getCurrentSpreadsheetRuntimeIdentity = (ctx: IContext) =>
  normalizeCanonicalPersistedRuntimeIdentity(
    toPersistedRuntimeIdentity(ctx.runtimeScope!),
  );

export const assertSpreadsheetReadAccess = async (ctx: IContext) => {
  await assertDashboardKnowledgeBaseReadAccess(ctx);
};

export const recordSpreadsheetReadAudit = async (
  ctx: IContext,
  payloadJson: Record<string, any>,
  spreadsheetId?: number | null,
) => {
  await recordDashboardKnowledgeBaseReadAudit(ctx, {
    resourceType: 'spreadsheet',
    resourceId: spreadsheetId ?? null,
    payloadJson,
  });
};

export const ensureSpreadsheetForScope = async (
  ctx: IContext,
  spreadsheetId: number,
): Promise<SpreadsheetDetail> => {
  const spreadsheet = await ctx.spreadsheetService.getSpreadsheetDetail(
    spreadsheetId,
    getCurrentSpreadsheetRuntimeIdentity(ctx),
  );
  if (!spreadsheet) {
    throw new ApiError('Spreadsheet not found.', 404);
  }
  return spreadsheet;
};

export const resolveSpreadsheetStoredRuntimeIdentity = (
  spreadsheet: Spreadsheet,
  fallbackRuntimeIdentity: SpreadsheetRuntimeIdentity,
) =>
  normalizeCanonicalPersistedRuntimeIdentity({
    projectId:
      spreadsheet.projectId ?? fallbackRuntimeIdentity.projectId ?? null,
    workspaceId:
      spreadsheet.workspaceId ?? fallbackRuntimeIdentity.workspaceId ?? null,
    knowledgeBaseId:
      spreadsheet.knowledgeBaseId ??
      fallbackRuntimeIdentity.knowledgeBaseId ??
      null,
    kbSnapshotId:
      spreadsheet.kbSnapshotId ?? fallbackRuntimeIdentity.kbSnapshotId ?? null,
    deployHash:
      spreadsheet.deployHash ?? fallbackRuntimeIdentity.deployHash ?? null,
    actorUserId:
      spreadsheet.actorUserId ?? fallbackRuntimeIdentity.actorUserId ?? null,
  });

const stripTrailingSemicolon = (sql: string) => sql.trim().replace(/;\s*$/, '');

const buildPagedSql = ({
  sql,
  page,
  pageSize,
}: {
  sql: string;
  page: number;
  pageSize: number;
}) => {
  const sourceSql = stripTrailingSemicolon(sql);
  const offset = Math.max(0, page) * pageSize;

  return `SELECT * FROM (${sourceSql}) AS spreadsheet_source LIMIT ${pageSize} OFFSET ${offset}`;
};

const buildCountSql = (sql: string) =>
  `SELECT COUNT(*) AS row_count FROM (${stripTrailingSemicolon(sql)}) AS spreadsheet_source`;

const readRowCount = (previewData: PreviewDataResponse) => {
  const firstRow = previewData.data?.[0];
  const value = Array.isArray(firstRow) ? firstRow[0] : null;
  const rowCount = Number(value);
  return Number.isFinite(rowCount) && rowCount >= 0 ? rowCount : 0;
};

export const normalizeSpreadsheetPageInput = ({
  page,
  pageSize,
}: {
  page?: unknown;
  pageSize?: unknown;
}) => {
  const normalizedPage = Number(page);
  const normalizedPageSize = Number(pageSize);
  const safePage =
    Number.isFinite(normalizedPage) && normalizedPage >= 0
      ? Math.floor(normalizedPage)
      : 0;
  const safePageSize =
    Number.isFinite(normalizedPageSize) && normalizedPageSize > 0
      ? Math.min(Math.floor(normalizedPageSize), SPREADSHEET_MAX_PAGE_SIZE)
      : SPREADSHEET_DEFAULT_PAGE_SIZE;

  return {
    page: safePage,
    pageSize: safePageSize,
  };
};

export const previewSpreadsheetPage = async ({
  ctx,
  spreadsheet,
  page,
  pageSize,
  refresh,
}: {
  ctx: IContext;
  spreadsheet: Spreadsheet;
  page: number;
  pageSize: number;
  refresh?: boolean | null;
}) => {
  await assertDashboardExecutableRuntimeScope(ctx);
  const requestRuntimeIdentity = getCurrentSpreadsheetRuntimeIdentity(ctx);
  const spreadsheetRuntimeIdentity = resolveSpreadsheetStoredRuntimeIdentity(
    spreadsheet,
    requestRuntimeIdentity,
  );
  const deployment = await ctx.deployService.getDeploymentByRuntimeIdentity({
    projectId: spreadsheetRuntimeIdentity.projectId,
    workspaceId: spreadsheetRuntimeIdentity.workspaceId,
    knowledgeBaseId: spreadsheetRuntimeIdentity.knowledgeBaseId,
    kbSnapshotId: spreadsheetRuntimeIdentity.kbSnapshotId,
    deployHash: spreadsheetRuntimeIdentity.deployHash,
  });
  if (!deployment) {
    throw new ApiError(
      'No deployment found, please deploy your project first',
      409,
    );
  }
  const project = await ctx.projectService.getProjectById(deployment.projectId);
  const previewOptions = {
    project,
    manifest: deployment.manifest,
    refresh: Boolean(refresh),
    cacheEnabled: true,
    ...(spreadsheet.sqlMode ? { sqlMode: spreadsheet.sqlMode } : {}),
  };

  const [pageData, countData] = await Promise.all([
    ctx.queryService.preview(
      buildPagedSql({ sql: spreadsheet.sql, page, pageSize }),
      {
        ...previewOptions,
        limit: pageSize,
      },
    ) as Promise<PreviewDataResponse>,
    ctx.queryService.preview(buildCountSql(spreadsheet.sql), {
      ...previewOptions,
      limit: 1,
    }) as Promise<PreviewDataResponse>,
  ]);
  const rowCount = readRowCount(countData);

  return {
    columns: pageData.columns,
    data: pageData.data,
    page,
    pageSize,
    rowCount,
    totalPages: Math.max(1, Math.ceil(rowCount / pageSize)),
    cacheHit: pageData.cacheHit || false,
    cacheCreatedAt: pageData.cacheCreatedAt || null,
    cacheOverrodeAt: pageData.cacheOverrodeAt || null,
    override: pageData.override || false,
  };
};

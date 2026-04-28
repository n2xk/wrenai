import type { NextApiRequest, NextApiResponse } from 'next';
import { ApiError } from '@/server/utils/apiUtils';
import { buildApiContextFromRequest } from '@/server/api/apiContext';
import { sendRestApiError } from '@/server/api/restApi';
import {
  assertSpreadsheetReadAccess,
  ensureSpreadsheetForScope,
  getCurrentSpreadsheetRuntimeIdentity,
  parseSpreadsheetId,
  previewSpreadsheetPage,
  recordSpreadsheetReadAudit,
  resolveSpreadsheetStoredRuntimeIdentity,
} from '@/server/api/spreadsheetRestShared';
import { pollUntil } from '@/server/utils/apiUtils';
import { buildStructuredSpreadsheetOperationSql } from '@/server/utils/spreadsheetAiOperations';
import { toAskRuntimeIdentity } from '@server/utils/askContext';
import * as Errors from '@server/utils/error';
import { AskFeedbackStatus } from '@server/models/adaptor';

const VALID_OPERATION_TYPES = new Set([
  'FILTER',
  'CLEANING',
  'GROUPING',
  'ENRICHMENT',
]);

const OPERATION_LABELS: Record<string, string> = {
  FILTER: '筛选 Filter',
  CLEANING: '清洗 Cleaning',
  GROUPING: '分组 Grouping',
  ENRICHMENT: '补充字段 Enrichment',
};

const OPERATION_GUIDANCE: Record<string, string> = {
  FILTER:
    'Add or refine WHERE/HAVING conditions. Preserve selected columns and aggregation unless the user explicitly asks to change them.',
  CLEANING:
    'Normalize dirty values, nulls, casts, trimming, date parsing, or defensive CASE expressions. Do not remove important business filters.',
  GROUPING:
    'Change the query grain using GROUP BY or aggregation. Preserve metric semantics and add clear aliases.',
  ENRICHMENT:
    'Add derived columns, labels, buckets, ratios, or joined semantic fields when they are available in the model context.',
};

const normalizeText = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

const extractOperationType = (value: unknown) => {
  const operationType = normalizeText(value).toUpperCase();
  if (!VALID_OPERATION_TYPES.has(operationType)) {
    throw new ApiError('Spreadsheet operation type is invalid', 400);
  }
  return operationType;
};

const buildSpreadsheetFeedbackReasoning = ({
  operationType,
  instruction,
  sqlMode,
  matchedQuestion,
}: {
  operationType: string;
  instruction: string;
  sqlMode?: string | null;
  matchedQuestion?: string | null;
}) => `Update this saved Spreadsheet SQL.

Operation: ${OPERATION_LABELS[operationType] || operationType}
Operation guidance: ${OPERATION_GUIDANCE[operationType] || ''}
User instruction: ${instruction}
Original question: ${matchedQuestion || 'N/A'}
SQL mode to preserve: ${
  sqlMode === 'dialect'
    ? 'native database dialect SQL'
    : 'Wren/Nova SQL over the semantic model'
}

Return one executable SQL query only. Preserve existing business filters unless the user explicitly asks otherwise.`;

const extractSqlTableNames = (sql: string) => {
  const tables = new Set<string>();
  const tablePattern =
    /\b(?:from|join)\s+["`]?([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)["`]?/gi;
  let match: RegExpExecArray | null;

  while ((match = tablePattern.exec(sql))) {
    const tableName = match[1]?.split('.').pop();
    if (tableName && tableName.toLowerCase() !== 'select') {
      tables.add(tableName);
    }
  }

  return Array.from(tables);
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      throw new Error('Method not allowed');
    }

    const spreadsheetId = parseSpreadsheetId(req.query.id);
    const operationType = extractOperationType(req.body?.operationType);
    const instruction = normalizeText(req.body?.instruction);
    if (!instruction) {
      throw new ApiError('Spreadsheet operation instruction is required', 400);
    }

    const ctx = await buildApiContextFromRequest({ req });
    await assertSpreadsheetReadAccess(ctx);
    const requestRuntimeIdentity = getCurrentSpreadsheetRuntimeIdentity(ctx);
    const spreadsheet = await ensureSpreadsheetForScope(ctx, spreadsheetId);
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

    const project = await ctx.projectService.getProjectById(
      deployment.projectId,
    );
    let queryId: string | null = null;
    let generationMode: 'structured' | 'ai' = 'structured';
    let generatedSql = normalizeText(
      buildStructuredSpreadsheetOperationSql({
        operationType,
        instruction,
        sql: spreadsheet.sql,
        sqlMode: spreadsheet.sqlMode,
      }),
    );

    if (!generatedSql) {
      generationMode = 'ai';
      const task = await ctx.wrenAIAdaptor.createAskFeedback({
        question:
          spreadsheet.matchedQuestion ||
          `Spreadsheet ${OPERATION_LABELS[operationType] || operationType}`,
        tables: extractSqlTableNames(spreadsheet.sql),
        sqlGenerationReasoning: buildSpreadsheetFeedbackReasoning({
          operationType,
          instruction,
          sqlMode: spreadsheet.sqlMode,
          matchedQuestion: spreadsheet.matchedQuestion,
        }),
        sql: spreadsheet.sql,
        configurations: {},
        runtimeIdentity: toAskRuntimeIdentity({
          ...spreadsheetRuntimeIdentity,
          deployHash: spreadsheetRuntimeIdentity.deployHash || deployment.hash,
        }),
      });
      queryId = task.queryId;

      const result = await pollUntil({
        fetcher: () => ctx.wrenAIAdaptor.getAskFeedbackResult(task.queryId),
        isFinished: (feedbackResult) =>
          feedbackResult.status === AskFeedbackStatus.FINISHED ||
          feedbackResult.status === AskFeedbackStatus.FAILED ||
          feedbackResult.status === AskFeedbackStatus.STOPPED ||
          Boolean(feedbackResult.error),
        timeoutError: new ApiError(
          'Timeout waiting for Spreadsheet AI operation',
          500,
          Errors.GeneralErrorCodes.POLLING_TIMEOUT,
        ),
      });
      if (
        result.status !== AskFeedbackStatus.FINISHED ||
        result.error ||
        !result.response?.length
      ) {
        throw new ApiError(
          result.error?.message || 'Spreadsheet AI operation failed',
          500,
        );
      }
      generatedSql = normalizeText(result.response?.[0]?.sql);
    }

    if (!generatedSql) {
      throw new ApiError('Spreadsheet operation did not return SQL', 500);
    }

    await ctx.queryService.preview(generatedSql, {
      project,
      manifest: deployment.manifest,
      limit: 1,
      dryRun: true,
      ...(spreadsheet.sqlMode ? { sqlMode: spreadsheet.sqlMode } : {}),
    });

    const updated = await ctx.spreadsheetService.saveSpreadsheetVersion(
      spreadsheetId,
      requestRuntimeIdentity,
      {
        sql: generatedSql,
        sqlMode: spreadsheet.sqlMode ?? null,
        type: 'AI_OPERATION',
        payload: {
          operationType,
          instruction,
          generationMode,
          queryId,
          previousVersion: spreadsheet.currentVersion,
          previousSql: spreadsheet.sql,
        },
        updatedBy:
          requestRuntimeIdentity.actorUserId ?? ctx.runtimeScope?.userId,
      },
    );
    const preview = await previewSpreadsheetPage({
      ctx,
      spreadsheet: updated,
      page: 0,
      pageSize: 100,
      refresh: true,
    });

    await recordSpreadsheetReadAudit(
      ctx,
      {
        operation: 'spreadsheet_ai_operation',
        operationType,
      },
      spreadsheetId,
    );

    return res.status(200).json({
      spreadsheet: updated,
      preview,
      operation: {
        type: operationType,
        instruction,
        queryId,
        generationMode,
        generatedSql,
      },
    });
  } catch (error) {
    return sendRestApiError(res, error, '执行数据表 AI 操作失败，请稍后重试。');
  }
}

import type { NextApiRequest, NextApiResponse } from 'next';
import { ApiError } from '@/server/utils/apiUtils';
import { buildApiContextFromRequest } from '@/server/api/apiContext';
import { sendRestApiError } from '@/server/api/restApi';
import {
  assertSpreadsheetReadAccess,
  getCurrentSpreadsheetRuntimeIdentity,
  recordSpreadsheetReadAudit,
} from '@/server/api/spreadsheetRestShared';
import { resolveThreadResponseSqlMode } from '@server/utils/dashboardItemSqlMode';

const normalizeOptionalNumber = (value: unknown) => {
  if (value == null || value === '') {
    return null;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
};

const normalizeText = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    const ctx = await buildApiContextFromRequest({ req });
    await assertSpreadsheetReadAccess(ctx);
    const runtimeIdentity = getCurrentSpreadsheetRuntimeIdentity(ctx);

    if (req.method === 'GET') {
      const spreadsheets =
        await ctx.spreadsheetService.listSpreadsheets(runtimeIdentity);
      await recordSpreadsheetReadAudit(ctx, {
        operation: 'list_spreadsheets',
      });
      return res.status(200).json(spreadsheets);
    }

    if (req.method === 'POST') {
      const responseId = normalizeOptionalNumber(req.body?.responseId);
      const bodySql = normalizeText(req.body?.sql);
      const bodyName = normalizeText(req.body?.name);

      if (responseId == null && !bodySql) {
        throw new ApiError('Response id or SQL is required', 400);
      }

      if (responseId != null) {
        await ctx.askingService.assertResponseScope(
          responseId,
          runtimeIdentity,
        );
        const response = await ctx.askingService.getResponseScoped(
          responseId,
          runtimeIdentity,
        );
        if (!response?.sql) {
          throw new ApiError('SQL not found in thread response', 400);
        }

        const sqlMode = await resolveThreadResponseSqlMode({
          askingService: ctx.askingService,
          response,
          runtimeIdentity,
        });
        const responseRuntimeIdentity = {
          projectId: response.projectId ?? runtimeIdentity.projectId ?? null,
          workspaceId:
            response.workspaceId ?? runtimeIdentity.workspaceId ?? null,
          knowledgeBaseId:
            response.knowledgeBaseId ?? runtimeIdentity.knowledgeBaseId ?? null,
          kbSnapshotId:
            response.kbSnapshotId ?? runtimeIdentity.kbSnapshotId ?? null,
          deployHash: response.deployHash ?? runtimeIdentity.deployHash ?? null,
          actorUserId:
            response.actorUserId ?? runtimeIdentity.actorUserId ?? null,
        };
        const spreadsheet = await ctx.spreadsheetService.createSpreadsheet({
          runtimeIdentity: responseRuntimeIdentity,
          name: bodyName || response.question || '未命名数据表',
          sql: response.sql,
          sqlMode,
          matchedQuestion: response.question,
          matchedViewId: response.viewId ?? null,
          sourceThreadId: response.threadId,
          sourceResponseId: response.id,
          createdBy: runtimeIdentity.actorUserId ?? ctx.runtimeScope?.userId,
        });
        await recordSpreadsheetReadAudit(
          ctx,
          {
            operation: 'create_spreadsheet_from_response',
            responseId,
          },
          spreadsheet.id,
        );
        return res.status(201).json(spreadsheet);
      }

      const spreadsheet = await ctx.spreadsheetService.createSpreadsheet({
        runtimeIdentity,
        name: bodyName || '未命名数据表',
        sql: bodySql,
        matchedQuestion: normalizeText(req.body?.matchedQuestion) || null,
        createdBy: runtimeIdentity.actorUserId ?? ctx.runtimeScope?.userId,
      });
      await recordSpreadsheetReadAudit(
        ctx,
        {
          operation: 'create_spreadsheet_from_sql',
        },
        spreadsheet.id,
      );
      return res.status(201).json(spreadsheet);
    }

    res.setHeader('Allow', 'GET, POST');
    throw new Error('Method not allowed');
  } catch (error) {
    return sendRestApiError(res, error, '处理数据表失败，请稍后重试。');
  }
}

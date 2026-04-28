import type { NextApiRequest, NextApiResponse } from 'next';
import { ApiError } from '@/server/utils/apiUtils';
import { buildApiContextFromRequest } from '@/server/api/apiContext';
import { sendRestApiError } from '@/server/api/restApi';
import {
  assertSpreadsheetReadAccess,
  ensureSpreadsheetForScope,
  getCurrentSpreadsheetRuntimeIdentity,
  parseSpreadsheetId,
  recordSpreadsheetReadAudit,
} from '@/server/api/spreadsheetRestShared';

const normalizeNamePatch = (value: unknown) => {
  if (value === undefined) {
    return undefined;
  }
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) {
    throw new ApiError('Spreadsheet name is required', 400);
  }
  return name;
};

const normalizeOptionalStringPatch = (value: unknown) => {
  if (value === undefined) {
    return undefined;
  }
  if (value == null) {
    return null;
  }
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
};

const normalizeBooleanPatch = (value: unknown) => {
  if (value === undefined) {
    return undefined;
  }
  return value === true || value === 'true' || value === 1 || value === '1';
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    const spreadsheetId = parseSpreadsheetId(req.query.id);
    const ctx = await buildApiContextFromRequest({ req });
    await assertSpreadsheetReadAccess(ctx);
    const runtimeIdentity = getCurrentSpreadsheetRuntimeIdentity(ctx);

    if (req.method === 'GET') {
      const spreadsheet = await ensureSpreadsheetForScope(ctx, spreadsheetId);
      await recordSpreadsheetReadAudit(
        ctx,
        {
          operation: 'get_spreadsheet',
        },
        spreadsheetId,
      );
      return res.status(200).json(spreadsheet);
    }

    if (req.method === 'PATCH') {
      const name = normalizeNamePatch(req.body?.name);
      const isShared = normalizeBooleanPatch(req.body?.isShared);
      const folderId = normalizeOptionalStringPatch(req.body?.folderId);
      const spreadsheet = await ctx.spreadsheetService.updateSpreadsheet(
        spreadsheetId,
        runtimeIdentity,
        {
          ...(name !== undefined ? { name } : {}),
          ...(isShared !== undefined ? { isShared } : {}),
          ...(folderId !== undefined ? { folderId } : {}),
          updatedBy: runtimeIdentity.actorUserId ?? ctx.runtimeScope?.userId,
        },
      );
      return res.status(200).json(spreadsheet);
    }

    if (req.method === 'DELETE') {
      const success = await ctx.spreadsheetService.deleteSpreadsheet(
        spreadsheetId,
        runtimeIdentity,
      );
      return res.status(200).json({ success });
    }

    res.setHeader('Allow', 'GET, PATCH, DELETE');
    throw new Error('Method not allowed');
  } catch (error) {
    return sendRestApiError(res, error, '处理数据表失败，请稍后重试。');
  }
}

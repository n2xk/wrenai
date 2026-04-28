import type { NextApiRequest, NextApiResponse } from 'next';
import { ApiError } from '@/server/utils/apiUtils';
import { buildApiContextFromRequest } from '@/server/api/apiContext';
import { sendRestApiError } from '@/server/api/restApi';
import {
  assertSpreadsheetReadAccess,
  getCurrentSpreadsheetRuntimeIdentity,
  parseSpreadsheetId,
} from '@/server/api/spreadsheetRestShared';

const VALID_SAVE_TYPES = new Set(['SAVE', 'AI_OPERATION', 'RESTORE']);

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
    const sql = typeof req.body?.sql === 'string' ? req.body.sql.trim() : '';
    if (!sql) {
      throw new ApiError('Spreadsheet SQL is required', 400);
    }

    const type =
      typeof req.body?.type === 'string' && VALID_SAVE_TYPES.has(req.body.type)
        ? req.body.type
        : 'SAVE';
    const payload =
      req.body?.payload &&
      typeof req.body.payload === 'object' &&
      !Array.isArray(req.body.payload)
        ? req.body.payload
        : {};

    const ctx = await buildApiContextFromRequest({ req });
    await assertSpreadsheetReadAccess(ctx);
    const runtimeIdentity = getCurrentSpreadsheetRuntimeIdentity(ctx);
    const spreadsheet = await ctx.spreadsheetService.saveSpreadsheetVersion(
      spreadsheetId,
      runtimeIdentity,
      {
        sql,
        type,
        payload,
        updatedBy: runtimeIdentity.actorUserId ?? ctx.runtimeScope?.userId,
      },
    );

    return res.status(200).json(spreadsheet);
  } catch (error) {
    return sendRestApiError(res, error, '保存数据表失败，请稍后重试。');
  }
}

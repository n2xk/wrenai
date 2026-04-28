import type { NextApiRequest, NextApiResponse } from 'next';
import { buildApiContextFromRequest } from '@/server/api/apiContext';
import { sendRestApiError } from '@/server/api/restApi';
import {
  assertSpreadsheetReadAccess,
  getCurrentSpreadsheetRuntimeIdentity,
  parseSpreadsheetId,
} from '@/server/api/spreadsheetRestShared';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method !== 'PATCH') {
      res.setHeader('Allow', 'PATCH');
      throw new Error('Method not allowed');
    }

    const spreadsheetId = parseSpreadsheetId(req.query.id);
    const ctx = await buildApiContextFromRequest({ req });
    await assertSpreadsheetReadAccess(ctx);
    const spreadsheet = await ctx.spreadsheetService.updateSpreadsheetSetting(
      spreadsheetId,
      getCurrentSpreadsheetRuntimeIdentity(ctx),
      {
        hiddenColumns: req.body?.hiddenColumns,
        pinnedColumns: req.body?.pinnedColumns,
        unpinnedColumns: req.body?.unpinnedColumns,
        columnWidths: req.body?.columnWidths,
      },
    );

    return res.status(200).json(spreadsheet);
  } catch (error) {
    return sendRestApiError(res, error, '更新数据表列设置失败，请稍后重试。');
  }
}

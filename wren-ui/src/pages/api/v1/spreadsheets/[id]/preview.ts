import type { NextApiRequest, NextApiResponse } from 'next';
import { buildApiContextFromRequest } from '@/server/api/apiContext';
import { sendRestApiError } from '@/server/api/restApi';
import {
  assertSpreadsheetReadAccess,
  ensureSpreadsheetForScope,
  normalizeSpreadsheetPageInput,
  parseSpreadsheetId,
  previewSpreadsheetPage,
  recordSpreadsheetReadAudit,
} from '@/server/api/spreadsheetRestShared';

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
    const ctx = await buildApiContextFromRequest({ req });
    await assertSpreadsheetReadAccess(ctx);
    const spreadsheet = await ensureSpreadsheetForScope(ctx, spreadsheetId);
    const { page, pageSize } = normalizeSpreadsheetPageInput({
      page: req.body?.page,
      pageSize: req.body?.pageSize,
    });
    const preview = await previewSpreadsheetPage({
      ctx,
      spreadsheet,
      page,
      pageSize,
      refresh: req.body?.refresh === true,
    });

    await recordSpreadsheetReadAudit(
      ctx,
      {
        operation: 'preview_spreadsheet',
        page,
        pageSize,
      },
      spreadsheetId,
    );
    return res.status(200).json(preview);
  } catch (error) {
    return sendRestApiError(res, error, '加载数据表预览失败，请稍后重试。');
  }
}

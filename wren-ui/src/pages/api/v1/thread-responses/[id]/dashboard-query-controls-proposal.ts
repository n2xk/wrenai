import type { NextApiRequest, NextApiResponse } from 'next';
import { buildApiContextFromRequest } from '@/server/api/apiContext';
import { assertDashboardKnowledgeBaseReadAccess } from '@/server/api/dashboardRestShared';
import { sendRestApiError } from '@/server/api/restApi';
import { ApiError } from '@/server/utils/apiUtils';
import { proposeDashboardQueryControlsForResponse } from '@/server/services/dashboardQueryControlsProposalService';

const parseResponseId = (value: string | string[] | undefined) => {
  const raw = Array.isArray(value) ? value[0] : value;
  const responseId = Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(responseId) || responseId <= 0) {
    throw new ApiError('Response ID is invalid', 400);
  }
  return responseId;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      throw new ApiError('Method not allowed', 405);
    }

    const ctx = await buildApiContextFromRequest({ req });
    await assertDashboardKnowledgeBaseReadAccess(ctx);

    const result = await proposeDashboardQueryControlsForResponse({
      ctx,
      responseId: parseResponseId(req.query.id),
      timezone:
        typeof req.body?.timezone === 'string' ? req.body.timezone : undefined,
    });

    return res.status(200).json(result);
  } catch (error) {
    return sendRestApiError(
      res,
      error,
      '识别看板日期范围失败，将按当前 SQL 固定刷新。',
    );
  }
}

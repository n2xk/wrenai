import type { NextApiRequest, NextApiResponse } from 'next';
import { buildApiContextFromRequest } from '@/server/api/apiContext';
import { assertDashboardKnowledgeBaseReadAccess } from '@/server/api/dashboardRestShared';
import { sendRestApiError } from '@/server/api/restApi';
import { ApiError } from '@/server/utils/apiUtils';
import { toPersistedRuntimeIdentity } from '@server/context/runtimeScope';
import { normalizeCanonicalPersistedRuntimeIdentity } from '@server/utils/persistedRuntimeIdentity';
import type {
  ThreadResponseFeedbackRating,
  ThreadResponseFeedbackSource,
} from '@server/repositories';

const parseResponseId = (value: string | string[] | undefined) => {
  const raw = Array.isArray(value) ? value[0] : value;
  const responseId = Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(responseId) || responseId <= 0) {
    throw new ApiError('Response ID is invalid', 400);
  }
  return responseId;
};

const getCurrentRuntimeIdentity = (
  ctx: Awaited<ReturnType<typeof buildApiContextFromRequest>>,
) =>
  normalizeCanonicalPersistedRuntimeIdentity(
    toPersistedRuntimeIdentity(ctx.runtimeScope!),
  );

const parseRating = (value: unknown): ThreadResponseFeedbackRating => {
  if (value === 'positive' || value === 'negative') {
    return value;
  }

  throw new ApiError('Feedback rating is invalid.', 400);
};

const parseReasonCodes = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];

const parseOptionalComment = (value: unknown) =>
  typeof value === 'string' ? value : null;

const parseSource = (value: unknown): ThreadResponseFeedbackSource => {
  if (
    value === 'result_footer' ||
    value === 'regression_test' ||
    value === 'api'
  ) {
    return value;
  }

  return 'result_footer';
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    const responseId = parseResponseId(req.query.id);
    const ctx = await buildApiContextFromRequest({ req });
    await assertDashboardKnowledgeBaseReadAccess(ctx);
    const runtimeIdentity = getCurrentRuntimeIdentity(ctx);

    if (req.method === 'GET') {
      const feedback =
        await ctx.threadResponseFeedbackService.getFeedbackForResponse({
          runtimeIdentity,
          responseId,
        });
      return res.status(200).json({ feedback });
    }

    if (req.method === 'PUT') {
      const feedback =
        await ctx.threadResponseFeedbackService.upsertFeedbackForResponse({
          runtimeIdentity,
          responseId,
          rating: parseRating(req.body?.rating),
          reasonCodes: parseReasonCodes(req.body?.reasonCodes),
          comment: parseOptionalComment(req.body?.comment),
          source: parseSource(req.body?.source),
        });
      return res.status(200).json({ feedback });
    }

    if (req.method === 'DELETE') {
      const success =
        await ctx.threadResponseFeedbackService.deleteFeedbackForResponse({
          runtimeIdentity,
          responseId,
        });
      return res.status(200).json({ success });
    }

    res.setHeader('Allow', 'GET, PUT, DELETE');
    throw new ApiError('Method not allowed', 405);
  } catch (error) {
    return sendRestApiError(res, error, '保存问数结果反馈失败，请稍后重试。');
  }
}

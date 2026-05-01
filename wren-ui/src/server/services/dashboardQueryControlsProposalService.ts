import type { IContext } from '@server/types';
import { toCanonicalPersistedRuntimeIdentityFromScope } from '@server/utils/persistedRuntimeIdentity';
import {
  detectDashboardTimeFilterCandidate,
  hasDashboardSqlDateLiteral,
  normalizeDashboardTimeFilterAiProposal,
  resolveDashboardQueryControlTimezone,
} from '@/utils/dashboardQueryControls';
import type {
  DashboardQueryControlsProposalResponse,
  DashboardTimeFilterAiProposal,
} from '@/types/home';

const ACCEPTED_AI_CONFIDENCE = new Set(['high', 'medium']);

const toAiProposal = (
  value: Awaited<
    ReturnType<IContext['wrenAIAdaptor']['proposeDashboardQueryControls']>
  >['response'],
): DashboardTimeFilterAiProposal | null => {
  const timeFilter = value?.timeFilter;
  if (!timeFilter) {
    return null;
  }

  return {
    field: String(timeFilter.field || ''),
    sqlBinding: {
      kind: timeFilter.kind as DashboardTimeFilterAiProposal['sqlBinding']['kind'],
      startLiteral: String(timeFilter.startLiteral || ''),
      endLiteral: String(timeFilter.endLiteral || ''),
      ...(typeof timeFilter.endLiteralOffsetDays === 'number'
        ? { endLiteralOffsetDays: timeFilter.endLiteralOffsetDays }
        : {}),
    },
  };
};

export const proposeDashboardQueryControlsForResponse = async ({
  ctx,
  responseId,
  timezone = resolveDashboardQueryControlTimezone(),
}: {
  ctx: IContext;
  responseId: number;
  timezone?: string | null;
}): Promise<DashboardQueryControlsProposalResponse> => {
  const normalizedTimezone = timezone || resolveDashboardQueryControlTimezone();
  const runtimeIdentity = toCanonicalPersistedRuntimeIdentityFromScope(
    ctx.runtimeScope,
  );

  await ctx.askingService.assertResponseScope(responseId, runtimeIdentity);
  const response = await ctx.askingService.getResponseScoped(
    responseId,
    runtimeIdentity,
  );
  const sql = response?.sql;
  if (!response || !sql) {
    return {
      candidate: null,
      source: null,
      confidence: null,
      warnings: ['response_sql_missing'],
    };
  }

  const deterministicCandidate = detectDashboardTimeFilterCandidate(
    sql,
    normalizedTimezone,
  );
  if (deterministicCandidate) {
    return {
      candidate: deterministicCandidate,
      source: 'rule',
      confidence: 'high',
      reason: 'deterministic_date_filter_detected',
      warnings: [],
    };
  }
  if (!hasDashboardSqlDateLiteral(sql)) {
    return {
      candidate: null,
      source: null,
      confidence: null,
      warnings: ['sql_date_literal_missing'],
    };
  }

  try {
    const aiResult = await ctx.wrenAIAdaptor.proposeDashboardQueryControls({
      query: response.question,
      sql,
      timezone: normalizedTimezone,
      runtimeIdentity: {
        ...runtimeIdentity,
        ...(runtimeIdentity.projectId == null
          ? { projectId: undefined }
          : { projectId: runtimeIdentity.projectId }),
      },
      configurations: {
        timezone: { name: normalizedTimezone },
      },
    });
    const aiResponse = aiResult.response || null;
    const confidence = aiResponse?.confidence || null;
    if (!confidence || !ACCEPTED_AI_CONFIDENCE.has(confidence)) {
      return {
        candidate: null,
        source: 'ai',
        confidence,
        reason: aiResponse?.reason || null,
        warnings: ['ai_proposal_low_confidence'],
      };
    }

    const candidate = normalizeDashboardTimeFilterAiProposal({
      sql,
      timezone: normalizedTimezone,
      proposal: toAiProposal(aiResponse),
    });
    if (!candidate) {
      return {
        candidate: null,
        source: 'ai',
        confidence,
        reason: aiResponse?.reason || null,
        warnings: ['ai_proposal_invalid_or_unsafe'],
      };
    }

    return {
      candidate,
      source: 'ai',
      confidence,
      reason: aiResponse?.reason || null,
      warnings: [],
    };
  } catch (_error) {
    return {
      candidate: null,
      source: 'ai',
      confidence: null,
      warnings: ['ai_proposal_unavailable'],
    };
  }
};

import { isEmpty } from 'lodash';

import type { ThreadResponse } from '@/types/home';
import {
  AskingTaskStatus,
  ChartTaskStatus,
  ThreadResponseAnswerStatus,
  ThreadResponseKind,
} from '@/types/home';

const hasConversationAidCandidates = (response?: ThreadResponse | null) =>
  Boolean(response?.resolvedIntent?.conversationAidPlan?.responseAids?.length);

const isEligibleConversationAidOwner = (response?: ThreadResponse | null) =>
  Boolean(
    response &&
    hasConversationAidCandidates(response) &&
    hasSettledConversationAids(response),
  );

export const hasSettledConversationAids = (
  response?: ThreadResponse | null,
) => {
  if (
    !response ||
    response.responseKind === ThreadResponseKind.RECOMMENDATION_FOLLOWUP
  ) {
    return false;
  }

  if (response.responseKind === ThreadResponseKind.CHART_FOLLOWUP) {
    return (
      response.chartDetail?.status === ChartTaskStatus.FINISHED ||
      response.chartDetail?.status === ChartTaskStatus.FAILED
    );
  }

  const answerStatus = response.answerDetail?.status;
  const isAnswerPrepared = Boolean(
    answerStatus &&
    ![
      ThreadResponseAnswerStatus.NOT_STARTED,
      ThreadResponseAnswerStatus.PREPROCESSING,
      ThreadResponseAnswerStatus.FETCHING_DATA,
      ThreadResponseAnswerStatus.STREAMING,
    ].includes(answerStatus),
  );
  const isBreakdownOnly =
    response.answerDetail === null && !isEmpty(response.breakdownDetail);
  const sqlText = typeof response.sql === 'string' ? response.sql.trim() : '';

  return Boolean(
    response.askingTask?.status === AskingTaskStatus.FINISHED ||
    isAnswerPrepared ||
    isBreakdownOnly ||
    sqlText,
  );
};

export const resolveConversationAidOwnerResponseId = ({
  responses,
  selectedResponseId,
}: {
  responses: ThreadResponse[];
  selectedResponseId?: number | null;
}) => {
  const latestEligibleResponse =
    [...(responses || [])].reverse().find((response) => {
      return isEligibleConversationAidOwner(response);
    }) || null;
  const selectedResponse =
    typeof selectedResponseId === 'number'
      ? responses.find((response) => response.id === selectedResponseId) || null
      : null;

  if (
    selectedResponse?.responseKind ===
    ThreadResponseKind.RECOMMENDATION_FOLLOWUP
  ) {
    const selectedSourceResponseId =
      selectedResponse.recommendationDetail?.sourceResponseId ??
      selectedResponse.sourceResponseId ??
      null;
    if (typeof selectedSourceResponseId === 'number') {
      const selectedSourceResponse =
        responses.find(
          (response) => response.id === selectedSourceResponseId,
        ) || null;
      if (
        selectedSourceResponse &&
        selectedSourceResponse.id === latestEligibleResponse?.id
      ) {
        return selectedSourceResponse.id;
      }
    }
  }

  return latestEligibleResponse?.id ?? null;
};

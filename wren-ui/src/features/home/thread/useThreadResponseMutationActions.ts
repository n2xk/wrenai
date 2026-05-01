import { useCallback, useState } from 'react';

import { appMessage as message } from '@/utils/antdAppBridge';
import type {
  AdjustThreadResponseChartInput,
  ThreadResponse,
} from '@/types/home';
import {
  ChartTaskStatus,
  ThreadResponseAnswerStatus,
  ThreadResponseKind,
} from '@/types/home';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import {
  createThreadResponse as createThreadResponseRequest,
  adjustThreadResponseChart as adjustThreadResponseChartRequest,
  triggerThreadResponseAnswer as triggerThreadResponseAnswerRequest,
  triggerThreadResponseChart as triggerThreadResponseChartRequest,
  updateThreadResponseSql as updateThreadResponseSqlRequest,
} from '@/utils/threadRest';
import { findExistingChartFollowUpResponse } from './threadWorkbenchState';
import { resolveThreadResponseRuntimeSelector } from './threadResponseRuntime';

const reportThreadError = (_error: unknown, fallbackMessage: string) => {
  message.error(fallbackMessage);
};

type GenerateChartOptions = {
  question?: string;
  sourceResponseId?: number;
};

const CHART_BLOCKING_REASON_CODES = new Set([
  'EMPTY_RESULT_SET',
  'INSUFFICIENT_NUMERIC_FIELDS',
  'INSUFFICIENT_DATA_VARIATION',
  'UNSUPPORTED_RESULT_SHAPE',
]);

const EMPTY_RESULT_CHART_MESSAGE = '当前查询结果为空，暂时无法生成图表。';
const DEFAULT_NON_CHARTABLE_MESSAGE = '当前结果暂时无法生成图表。';

const isKnownEmptyAnswerResult = (response?: ThreadResponse | null) =>
  Boolean(
    response?.answerDetail?.error?.code === 'EMPTY_RESULT_SET' ||
    (response?.answerDetail?.status === ThreadResponseAnswerStatus.FINISHED &&
      response.answerDetail.numRowsUsedInLLM === 0),
  );

const readChartBlockingMessage = (response?: ThreadResponse | null) => {
  const chartability = response?.chartDetail?.chartability;
  const reasonCode = chartability?.reasonCode;

  if (
    chartability?.chartable === false ||
    (typeof reasonCode === 'string' &&
      CHART_BLOCKING_REASON_CODES.has(reasonCode))
  ) {
    return chartability?.message || DEFAULT_NON_CHARTABLE_MESSAGE;
  }

  return null;
};

const buildOptimisticChartGeneratingResponse = (
  response: ThreadResponse,
): ThreadResponse => ({
  ...response,
  chartDetail: {
    ...(response.chartDetail || {}),
    diagnostics: {
      ...(response.chartDetail?.diagnostics || {}),
      submittedAt: new Date().toISOString(),
      finalizedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    },
    error: null,
    fallbackReason: null,
    fallbackUsed: false,
    queryId: null,
    status: ChartTaskStatus.GENERATING,
    thinking: null,
    validationErrors: [],
  },
});

const buildOptimisticChartFailedResponse = (
  response: ThreadResponse,
): ThreadResponse => ({
  ...response,
  chartDetail: {
    ...(response.chartDetail || {}),
    diagnostics: {
      ...(response.chartDetail?.diagnostics || {}),
      finalizedAt: new Date().toISOString(),
      lastErrorMessage: '生成图表失败，请稍后重试',
    },
    error: { message: '生成图表失败，请稍后重试' } as any,
    status: ChartTaskStatus.FAILED,
    thinking: null,
  },
});

export function useThreadResponseMutationActions({
  currentResponses,
  currentThreadId,
  onSelectResponse,
  runtimeScopeSelector,
  startThreadResponsePolling,
  upsertThreadResponse,
}: {
  currentResponses: ThreadResponse[];
  currentThreadId?: number | null;
  onSelectResponse?: (
    responseId: number,
    options?: {
      artifact?: 'preview' | 'sql' | 'chart' | null;
      openWorkbench?: boolean;
      userInitiated?: boolean;
    },
  ) => void;
  runtimeScopeSelector: ClientRuntimeScopeSelector;
  startThreadResponsePolling: (responseId: number) => void;
  upsertThreadResponse: (nextResponse: ThreadResponse) => void;
}) {
  const [threadResponseUpdating, setThreadResponseUpdating] = useState(false);
  const resolveResponseRuntimeScopeSelector = useCallback(
    (response?: ThreadResponse | null) =>
      resolveThreadResponseRuntimeSelector({
        response,
        fallbackSelector: runtimeScopeSelector,
      }),
    [runtimeScopeSelector],
  );

  const onGenerateThreadResponseAnswer = useCallback(
    async (responseId: number) => {
      try {
        const currentResponse =
          currentResponses.find((response) => response.id === responseId) ||
          null;
        const nextResponse = await triggerThreadResponseAnswerRequest(
          resolveResponseRuntimeScopeSelector(currentResponse),
          responseId,
        );
        upsertThreadResponse(nextResponse);
        startThreadResponsePolling(responseId);
      } catch (error) {
        reportThreadError(error, '生成回答失败，请稍后重试');
      }
    },
    [
      currentResponses,
      resolveResponseRuntimeScopeSelector,
      startThreadResponsePolling,
      upsertThreadResponse,
    ],
  );

  const onGenerateThreadResponseChart = useCallback(
    async (responseId: number, options?: GenerateChartOptions) => {
      let optimisticTargetResponse: ThreadResponse | null = null;
      try {
        const currentResponse = currentResponses.find(
          (response) => response.id === responseId,
        );
        if (!currentResponse) {
          message.error('当前回答不存在，请刷新后重试');
          return;
        }

        const blockingMessage =
          readChartBlockingMessage(currentResponse) ||
          (isKnownEmptyAnswerResult(currentResponse)
            ? EMPTY_RESULT_CHART_MESSAGE
            : null);
        if (blockingMessage) {
          message.error(blockingMessage);
          return;
        }

        const shouldReuseCurrentResponse =
          currentResponse.responseKind === ThreadResponseKind.CHART_FOLLOWUP;

        let targetResponse = currentResponse;
        if (!shouldReuseCurrentResponse) {
          if (!currentThreadId) {
            message.error('当前对话尚未就绪，请稍后再试');
            return;
          }

          const sourceResponseId = options?.sourceResponseId ?? responseId;
          const existingChartResponse = findExistingChartFollowUpResponse({
            responses: currentResponses,
            sourceResponseId,
          });
          if (existingChartResponse) {
            targetResponse = existingChartResponse;
          } else {
            targetResponse = await createThreadResponseRequest(
              resolveResponseRuntimeScopeSelector(currentResponse),
              currentThreadId,
              {
                question: options?.question || '生成图表',
                responseKind: ThreadResponseKind.CHART_FOLLOWUP,
                sourceResponseId,
              },
            );
            upsertThreadResponse(targetResponse);
          }
        }

        optimisticTargetResponse =
          buildOptimisticChartGeneratingResponse(targetResponse);
        upsertThreadResponse(optimisticTargetResponse);

        onSelectResponse?.(targetResponse.id, {
          artifact: 'chart',
          openWorkbench: false,
        });

        const nextResponse = await triggerThreadResponseChartRequest(
          resolveResponseRuntimeScopeSelector(targetResponse),
          targetResponse.id,
        );
        upsertThreadResponse(nextResponse);
        startThreadResponsePolling(nextResponse.id);
      } catch (error) {
        if (optimisticTargetResponse) {
          upsertThreadResponse(
            buildOptimisticChartFailedResponse(optimisticTargetResponse),
          );
        }
        reportThreadError(error, '生成图表失败，请稍后重试');
      }
    },
    [
      currentResponses,
      currentThreadId,
      onSelectResponse,
      resolveResponseRuntimeScopeSelector,
      startThreadResponsePolling,
      upsertThreadResponse,
    ],
  );

  const onAdjustThreadResponseChart = useCallback(
    async (responseId: number, data: AdjustThreadResponseChartInput) => {
      try {
        const currentResponse =
          currentResponses.find((response) => response.id === responseId) ||
          null;
        const nextResponse = await adjustThreadResponseChartRequest(
          resolveResponseRuntimeScopeSelector(currentResponse),
          responseId,
          data,
        );
        upsertThreadResponse(nextResponse);
      } catch (error) {
        reportThreadError(error, '调整图表失败，请稍后重试');
      }
    },
    [
      currentResponses,
      resolveResponseRuntimeScopeSelector,
      upsertThreadResponse,
    ],
  );

  const onFixSQLStatement = useCallback(
    async (responseId: number, sql: string) => {
      setThreadResponseUpdating(true);
      try {
        const currentResponse =
          currentResponses.find((response) => response.id === responseId) ||
          null;
        const nextResponse = await updateThreadResponseSqlRequest(
          resolveResponseRuntimeScopeSelector(currentResponse),
          responseId,
          { sql },
        );
        upsertThreadResponse(nextResponse);
        message.success('SQL 语句已更新。');
        await onGenerateThreadResponseAnswer(nextResponse.id);
      } catch (error) {
        reportThreadError(error, '更新 SQL 失败，请稍后重试');
      } finally {
        setThreadResponseUpdating(false);
      }
    },
    [
      currentResponses,
      onGenerateThreadResponseAnswer,
      resolveResponseRuntimeScopeSelector,
      upsertThreadResponse,
    ],
  );

  return {
    onAdjustThreadResponseChart,
    onFixSQLStatement,
    onGenerateThreadResponseAnswer,
    onGenerateThreadResponseChart,
    threadResponseUpdating,
  };
}

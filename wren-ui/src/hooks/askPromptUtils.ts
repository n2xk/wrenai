import { cloneDeep, uniq } from 'lodash';
import {
  resolveClientRuntimeScopeSelector,
  type ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import {
  AdjustmentTask,
  AskingTask,
  AskingTaskStatus,
  AskingTaskType,
  RecommendedQuestionsTask,
  RecommendedQuestionsTaskStatus,
  ThreadResponseAnswerDetail,
  ThreadResponseAnswerStatus,
} from '@/types/home';
import type { UpdateThreadDetailState } from './useThreadDetail';

export interface AskPromptData {
  originalQuestion: string;
  askingTask?: AskingTask | null;
  askingStreamTask?: string;
  recommendedQuestions?: RecommendedQuestionsTask | null;
}

export interface AskPromptSubmitDefaults {
  clarificationSessionId?: string | null;
  clarificationState?: Record<string, unknown> | null;
  displayQuestion?: string | null;
  knowledgeBaseIds?: string[];
  selectedSkillIds?: string[];
  slotValues?: Record<string, unknown> | null;
}

export type NullableAskingTask = AskingTask | null | undefined;

export const ASKING_TASK_POLL_INTERVAL_MS = 1500;
export const ASKING_TASK_POLL_TIMEOUT_MS = 5 * 60_000;
export const INSTANT_RECOMMEND_POLL_INTERVAL_MS = 1500;
export const INSTANT_RECOMMEND_POLL_TIMEOUT_MS = 20_000;
const TEXT_TO_SQL_SQL_MISSING_ERROR_CODE = 'TEXT_TO_SQL_SQL_MISSING';
const TEXT_TO_SQL_SQL_MISSING_USER_MESSAGE =
  'SQL 生成失败，未能生成可执行查询。请尝试重新生成，或调整问题描述。';

export const getIsFinished = (status?: AskingTaskStatus | null) =>
  status != null &&
  [
    AskingTaskStatus.FINISHED,
    AskingTaskStatus.FAILED,
    AskingTaskStatus.STOPPED,
  ].includes(status);

export const canGenerateAnswer = (
  askingTask: NullableAskingTask,
  adjustmentTask?: AdjustmentTask | null,
) =>
  (askingTask === null && adjustmentTask === null) ||
  (askingTask?.status === AskingTaskStatus.FINISHED &&
    askingTask?.type === AskingTaskType.TEXT_TO_SQL) ||
  adjustmentTask?.status === AskingTaskStatus.FINISHED;

export const canFetchThreadResponse = (askingTask: NullableAskingTask) =>
  askingTask !== null &&
  askingTask?.status !== AskingTaskStatus.FAILED &&
  askingTask?.status !== AskingTaskStatus.STOPPED;

export const isReadyToThreadResponse = (askingTask: NullableAskingTask) =>
  askingTask?.status === AskingTaskStatus.SEARCHING &&
  askingTask?.type === AskingTaskType.TEXT_TO_SQL;

export const isRecommendedFinished = (
  status?: RecommendedQuestionsTaskStatus | null,
) =>
  status != null &&
  [
    RecommendedQuestionsTaskStatus.FINISHED,
    RecommendedQuestionsTaskStatus.FAILED,
    RecommendedQuestionsTaskStatus.NOT_STARTED,
  ].includes(status);

export const isNeedRecommendedQuestions = (askingTask: NullableAskingTask) => {
  const isGeneralOrMisleadingQuery =
    askingTask?.type === AskingTaskType.GENERAL ||
    askingTask?.type === AskingTaskType.MISLEADING_QUERY;
  const isFailed =
    askingTask?.type !== AskingTaskType.TEXT_TO_SQL &&
    askingTask?.status === AskingTaskStatus.FAILED;
  return isGeneralOrMisleadingQuery || isFailed;
};

export const isNeedPreparing = (askingTask: NullableAskingTask) =>
  askingTask?.type === AskingTaskType.TEXT_TO_SQL;

export const resolvePendingClarificationSubmitDefaults = (
  responses?: Array<{ askingTask?: AskingTask | null }> | null,
): Pick<
  AskPromptSubmitDefaults,
  'clarificationSessionId' | 'clarificationState'
> => {
  const latestPendingClarification =
    resolveLatestPendingClarificationState(responses);

  return latestPendingClarification?.clarificationSessionId
    ? {
        clarificationSessionId:
          latestPendingClarification.clarificationSessionId,
        clarificationState: latestPendingClarification as Record<
          string,
          unknown
        >,
      }
    : {};
};

export const resolveLatestPendingClarificationState = (
  responses?: Array<{ askingTask?: AskingTask | null }> | null,
) => {
  const latestAskingResponse = (responses || [])
    .slice()
    .reverse()
    .find((response) => Boolean(response.askingTask));
  const latestPendingClarification =
    latestAskingResponse?.askingTask?.diagnostics?.clarificationState;

  return latestPendingClarification?.status === 'needs_clarification' &&
    latestPendingClarification?.clarificationSessionId &&
    (latestPendingClarification.pendingSlots || []).length > 0
    ? latestPendingClarification
    : null;
};

const resolveTextAnswerStatusFromAskingTask = (
  askingTask: NullableAskingTask,
): ThreadResponseAnswerStatus | null => {
  switch (askingTask?.status) {
    case AskingTaskStatus.FINISHED:
      return ThreadResponseAnswerStatus.FINISHED;
    case AskingTaskStatus.FAILED:
      return ThreadResponseAnswerStatus.FAILED;
    case AskingTaskStatus.STOPPED:
      return ThreadResponseAnswerStatus.INTERRUPTED;
    default:
      return null;
  }
};

const buildTextAnswerFallbackFromAskingTask = ({
  askingTask,
  existingAnswerDetail,
}: {
  askingTask: NullableAskingTask;
  existingAnswerDetail?: ThreadResponseAnswerDetail | null;
}) => {
  if (
    askingTask?.type !== AskingTaskType.GENERAL &&
    askingTask?.type !== AskingTaskType.MISLEADING_QUERY
  ) {
    return existingAnswerDetail;
  }

  const nextStatus =
    existingAnswerDetail?.status ||
    resolveTextAnswerStatusFromAskingTask(askingTask);
  const existingContent = existingAnswerDetail?.content?.trim() || null;
  const nextContent =
    existingContent ||
    askingTask?.intentReasoning?.trim() ||
    askingTask?.error?.message?.trim() ||
    null;

  if (!nextStatus && !nextContent) {
    return existingAnswerDetail;
  }

  return {
    ...existingAnswerDetail,
    status: nextStatus,
    content: nextContent,
  };
};

const buildAnswerDetailFromAskingTask = ({
  askingTask,
  existingAnswerDetail,
}: {
  askingTask: NullableAskingTask;
  existingAnswerDetail?: ThreadResponseAnswerDetail | null;
}): ThreadResponseAnswerDetail | null | undefined => {
  if (askingTask?.type !== AskingTaskType.TEXT_TO_SQL) {
    return buildTextAnswerFallbackFromAskingTask({
      askingTask,
      existingAnswerDetail,
    });
  }

  const generatedSql = resolveGeneratedSqlFromAskingTask(askingTask);
  if (!getIsFinished(askingTask.status)) {
    return null;
  }

  if (askingTask.status === AskingTaskStatus.FAILED && !generatedSql) {
    return {
      status: ThreadResponseAnswerStatus.FAILED,
      error: {
        code: TEXT_TO_SQL_SQL_MISSING_ERROR_CODE,
        message: TEXT_TO_SQL_SQL_MISSING_USER_MESSAGE,
      },
    };
  }

  return existingAnswerDetail ?? null;
};

const resolveGeneratedSqlFromAskingTask = (askingTask: NullableAskingTask) => {
  if (
    askingTask?.status !== AskingTaskStatus.FINISHED ||
    askingTask?.type !== AskingTaskType.TEXT_TO_SQL
  ) {
    return null;
  }

  const candidate = askingTask.candidates?.find(
    (item) => item?.sql?.trim() || item?.view?.statement?.trim(),
  );
  const sql = candidate?.sql?.trim() || candidate?.view?.statement?.trim();
  return sql
    ? {
        sql,
        view: candidate?.view || null,
      }
    : null;
};

export const buildRecommendedQuestionHistory = (
  threadQuestions: string[],
  originalQuestion: string,
) =>
  Array.from(
    new Set(
      [...uniq(threadQuestions).slice(-5), originalQuestion].filter(Boolean),
    ),
  );

export const handleUpdateThreadCache = (
  askingTask: NullableAskingTask,
  updateThreadQuery?: UpdateThreadDetailState,
) => {
  if (!askingTask || !updateThreadQuery) {
    return;
  }

  updateThreadQuery((existingData) => {
    if (!existingData?.thread) {
      return existingData;
    }

    return {
      thread: {
        ...existingData.thread,
        responses: existingData.thread.responses.map((response) => {
          if (response.askingTask?.queryId === askingTask.queryId) {
            const answerDetail = buildAnswerDetailFromAskingTask({
              askingTask,
              existingAnswerDetail: response.answerDetail,
            });
            const generatedSql = resolveGeneratedSqlFromAskingTask(askingTask);
            return {
              ...response,
              askingTask: cloneDeep(askingTask),
              sql: response.sql || generatedSql?.sql || response.sql,
              view: response.view || generatedSql?.view || response.view,
              answerDetail,
            };
          }
          return response;
        }),
      },
    };
  });
};

export const handleUpdateRerunAskingTaskCache = ({
  threadResponseId,
  askingTask,
  updateThreadQuery,
}: {
  threadResponseId: number;
  askingTask: NullableAskingTask;
  updateThreadQuery?: UpdateThreadDetailState;
}) => {
  if (!askingTask || !updateThreadQuery) {
    return;
  }

  const task = cloneDeep(askingTask);
  if (task.status === AskingTaskStatus.UNDERSTANDING) {
    task.status = AskingTaskStatus.SEARCHING;
    task.type = AskingTaskType.TEXT_TO_SQL;
  }

  updateThreadQuery((existingData) => {
    if (!existingData?.thread) {
      return existingData;
    }

    return {
      thread: {
        ...existingData.thread,
        responses: existingData.thread.responses.map((response) => {
          if (response.id === threadResponseId) {
            return {
              ...response,
              askingTask: task,
              answerDetail: buildAnswerDetailFromAskingTask({
                askingTask: task,
                existingAnswerDetail: response.answerDetail,
              }),
            };
          }
          return response;
        }),
      },
    };
  });
};

export const resolveRuntimeScopeSelector = (
  selector?: ClientRuntimeScopeSelector,
) => selector || resolveClientRuntimeScopeSelector();

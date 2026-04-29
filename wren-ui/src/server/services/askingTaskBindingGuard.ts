import type { TrackedAskingResult } from './askingTaskTrackerTypes';

type BindableAskingTask = Pick<
  TrackedAskingResult,
  'queryId' | 'threadId' | 'threadResponseId'
>;

const toPositiveNumber = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
};

export const buildAskingTaskAlreadyBoundError = ({
  queryId,
  threadId,
  threadResponseId,
}: {
  queryId?: string | null;
  threadId?: number | null;
  threadResponseId?: number | null;
}) => {
  const binding = [
    threadId ? `thread ${threadId}` : null,
    threadResponseId ? `response ${threadResponseId}` : null,
  ]
    .filter(Boolean)
    .join(' / ');
  const error = new Error(
    `Asking task ${queryId || 'unknown'} is already bound${
      binding ? ` to ${binding}` : ''
    }.`,
  ) as Error & { code?: string; statusCode?: number };
  error.code = 'ASKING_TASK_ALREADY_BOUND';
  error.statusCode = 409;
  return error;
};

export const resolveAskingTaskBinding = (
  askingTask?: Partial<BindableAskingTask> | null,
) => ({
  threadId: toPositiveNumber(askingTask?.threadId),
  threadResponseId: toPositiveNumber(askingTask?.threadResponseId),
});

export const assertAskingTaskIsUnbound = (
  askingTask?: Partial<BindableAskingTask> | null,
) => {
  const { threadId, threadResponseId } = resolveAskingTaskBinding(askingTask);
  if (!threadId && !threadResponseId) {
    return;
  }

  throw buildAskingTaskAlreadyBoundError({
    queryId: askingTask?.queryId,
    threadId,
    threadResponseId,
  });
};

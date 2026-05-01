import { isEmpty } from 'lodash';
import { PersistedRuntimeIdentity } from '@server/context/runtimeScope';
import {
  IThreadResponseRepository,
  ThreadResponse,
} from '../repositories/threadResponseRepository';
import { Thread, ThreadListOptions } from '../repositories/threadRepository';
import {
  isPersistedRuntimeIdentityCompatible,
  toPersistedRuntimeIdentityFromSource,
} from '@server/utils/persistedRuntimeIdentity';
import {
  AskingDetailTaskInput,
  AskingDetailTaskUpdateInput,
} from './askingServiceShared';
import { normalizeRuntimeScope } from './askingServiceRuntimeSupport';
import { buildThreadResponseIntentState } from './threadResponseIntentState';
import { assertAskingTaskIsUnbound } from './askingTaskBindingGuard';

interface AskingServiceThreadLike {
  threadRepository: Pick<
    any,
    | 'createOne'
    | 'listAllTimeDescOrderByScope'
    | 'findOneByIdWithRuntimeScope'
    | 'findOneBy'
    | 'updateOne'
    | 'deleteOne'
    | 'deleteAllBy'
  >;
  threadResponseRepository: Pick<
    IThreadResponseRepository,
    | 'createOne'
    | 'findOneBy'
    | 'updateOne'
    | 'getResponsesWithThread'
    | 'getResponsesWithThreadByScope'
    | 'findOneByIdWithRuntimeScope'
  >;
  askingTaskTracker: Pick<any, 'bindThreadResponse'>;
  buildPersistedRuntimeIdentityPatch(
    runtimeIdentity: PersistedRuntimeIdentity,
  ): PersistedRuntimeIdentity;
  getResponse(responseId: number): Promise<ThreadResponse | null>;
}

const toNormalizedPersistedRuntimeIdentity = (
  source: Parameters<typeof toPersistedRuntimeIdentityFromSource>[0],
  fallback?: PersistedRuntimeIdentity | null,
) => {
  const runtimeIdentity = toPersistedRuntimeIdentityFromSource(source, fallback);
  return normalizeRuntimeScope(runtimeIdentity) ?? runtimeIdentity;
};

const isResponseRuntimeCompatible = (
  response: ThreadResponse,
  runtimeIdentity: PersistedRuntimeIdentity,
) => {
  try {
    return isPersistedRuntimeIdentityCompatible(
      runtimeIdentity,
      toNormalizedPersistedRuntimeIdentity(response),
    );
  } catch (_error) {
    return false;
  }
};

const collectMissingSourceResponseIds = (
  responses: ThreadResponse[],
  knownResponseIds: Set<number>,
) => {
  const missingSourceResponseIds = new Set<number>();

  responses.forEach((response) => {
    if (
      typeof response.sourceResponseId === 'number' &&
      !knownResponseIds.has(response.sourceResponseId)
    ) {
      missingSourceResponseIds.add(response.sourceResponseId);
    }
  });

  return missingSourceResponseIds;
};

const sortResponsesChronologically = (responses: ThreadResponse[]) =>
  [...responses].sort(
    (left, right) =>
      (left.id ?? Number.MIN_SAFE_INTEGER) -
      (right.id ?? Number.MIN_SAFE_INTEGER),
  );

const resolveFollowUpRuntimeIdentity = ({
  runtimeIdentity,
  sourceResponse,
  thread,
}: {
  runtimeIdentity: PersistedRuntimeIdentity;
  sourceResponse?: ThreadResponse | null;
  thread: Thread;
}) => {
  const threadRuntimeIdentity = toNormalizedPersistedRuntimeIdentity(
    thread,
    runtimeIdentity,
  );

  if (!sourceResponse) {
    return threadRuntimeIdentity;
  }

  try {
    const sourceRuntimeIdentity =
      toNormalizedPersistedRuntimeIdentity(sourceResponse);
    return {
      ...sourceRuntimeIdentity,
      actorUserId:
        sourceRuntimeIdentity.actorUserId ?? threadRuntimeIdentity.actorUserId,
    };
  } catch (_error) {
    return threadRuntimeIdentity;
  }
};

export const createThreadAction = async (
  service: AskingServiceThreadLike,
  input: AskingDetailTaskInput,
  runtimeIdentity: PersistedRuntimeIdentity,
): Promise<Thread> => {
  assertAskingTaskIsUnbound(input.trackedAskingResult);

  const persistedRuntimeIdentity =
    service.buildPersistedRuntimeIdentityPatch(runtimeIdentity);
  const normalizedKnowledgeBaseIds = Array.from(
    new Set(
      [
        ...(input.knowledgeBaseIds || []),
        persistedRuntimeIdentity.knowledgeBaseId || null,
      ].filter(Boolean),
    ),
  ) as string[];
  const hasSelectedSkillIds = Array.isArray(input.selectedSkillIds);
  const normalizedSelectedSkillIds = Array.from(
    new Set((input.selectedSkillIds || []).filter(Boolean)),
  );

  const thread = await service.threadRepository.createOne({
    ...persistedRuntimeIdentity,
    knowledgeBaseIds:
      normalizedKnowledgeBaseIds.length > 0 ? normalizedKnowledgeBaseIds : null,
    selectedSkillIds: hasSelectedSkillIds ? normalizedSelectedSkillIds : null,
    summary: input.question,
  });

  const threadResponseIntentState = buildThreadResponseIntentState({
    askingTaskType: input.trackedAskingResult?.type || null,
    responseKind: input.responseKind || 'ANSWER',
    sourceResponseId: input.sourceResponseId ?? null,
    sql: input.sql,
    threadId: thread.id,
  });

  const threadResponse = await service.threadResponseRepository.createOne({
    ...toPersistedRuntimeIdentityFromSource(thread, persistedRuntimeIdentity),
    threadId: thread.id,
    question: input.question,
    responseKind: input.responseKind || 'ANSWER',
    recommendationDetail: input.recommendationDetail,
    sql: input.sql,
    sourceResponseId: input.sourceResponseId ?? null,
    resolvedIntent: threadResponseIntentState.resolvedIntent,
    artifactLineage: threadResponseIntentState.artifactLineage,
    askingTaskId: input.trackedAskingResult?.taskId,
  });

  if (input.trackedAskingResult?.taskId) {
    await service.askingTaskTracker.bindThreadResponse(
      input.trackedAskingResult.taskId,
      input.trackedAskingResult.queryId,
      thread.id,
      threadResponse.id,
      {
        question: input.trackedAskingResult.question ?? input.question,
        result: input.trackedAskingResult,
        runtimeIdentity: persistedRuntimeIdentity,
      },
    );
  }

  return thread;
};

export const listThreadsAction = async (
  service: AskingServiceThreadLike,
  runtimeIdentity: PersistedRuntimeIdentity,
  options?: ThreadListOptions,
): Promise<Thread[]> => {
  const scopedRuntimeIdentity =
    service.buildPersistedRuntimeIdentityPatch(runtimeIdentity);
  const scope = {
    projectId: scopedRuntimeIdentity.projectId ?? null,
    workspaceId: scopedRuntimeIdentity.workspaceId,
    knowledgeBaseId: scopedRuntimeIdentity.knowledgeBaseId,
    kbSnapshotId: scopedRuntimeIdentity.kbSnapshotId,
    deployHash: scopedRuntimeIdentity.deployHash,
  };

  if (options) {
    return service.threadRepository.listAllTimeDescOrderByScope(scope, options);
  }

  return service.threadRepository.listAllTimeDescOrderByScope(scope);
};

export const assertThreadScopeAction = async (
  service: AskingServiceThreadLike,
  threadId: number,
  runtimeIdentity: PersistedRuntimeIdentity,
): Promise<Thread> => {
  const scopedRuntimeIdentity =
    normalizeRuntimeScope(runtimeIdentity) ?? runtimeIdentity;
  const thread = await service.threadRepository.findOneByIdWithRuntimeScope(
    threadId,
    scopedRuntimeIdentity,
  );
  if (!thread) {
    const persistedThread = await service.threadRepository.findOneBy({
      id: threadId,
    });
    if (!persistedThread) {
      throw new Error(`Thread ${threadId} not found`);
    }
    const persistedThreadRuntimeIdentity =
      normalizeRuntimeScope(
        toPersistedRuntimeIdentityFromSource(persistedThread),
      ) ?? toPersistedRuntimeIdentityFromSource(persistedThread);
    if (
      isPersistedRuntimeIdentityCompatible(
        scopedRuntimeIdentity,
        persistedThreadRuntimeIdentity,
      )
    ) {
      return persistedThread;
    }
    throw new Error(
      `Thread ${threadId} does not belong to the current runtime scope`,
    );
  }
  return thread;
};

export const assertAskingTaskScopeAction = async (
  service: any,
  queryId: string,
  runtimeIdentity: PersistedRuntimeIdentity,
): Promise<PersistedRuntimeIdentity> => {
  const scopedRuntimeIdentity =
    normalizeRuntimeScope(runtimeIdentity) ?? runtimeIdentity;
  const task = await service.askingTaskRepository.findByQueryIdWithRuntimeScope(
    queryId,
    scopedRuntimeIdentity,
  );
  if (!task) {
    const trackedRuntimeIdentity =
      await service.askingTaskTracker?.getTrackedRuntimeIdentity?.(queryId);
    if (
      trackedRuntimeIdentity &&
      isPersistedRuntimeIdentityCompatible(
        scopedRuntimeIdentity,
        normalizeRuntimeScope(trackedRuntimeIdentity) ?? trackedRuntimeIdentity,
      )
    ) {
      return (
        normalizeRuntimeScope(trackedRuntimeIdentity) ?? trackedRuntimeIdentity
      );
    }

    const persistedTask =
      await service.askingTaskRepository.findByQueryId(queryId);
    if (!persistedTask) {
      throw new Error(`Asking task ${queryId} not found`);
    }

    const persistedTaskRuntimeIdentity =
      normalizeRuntimeScope(
        toPersistedRuntimeIdentityFromSource(persistedTask),
      ) ?? toPersistedRuntimeIdentityFromSource(persistedTask);
    if (
      isPersistedRuntimeIdentityCompatible(
        scopedRuntimeIdentity,
        persistedTaskRuntimeIdentity,
      )
    ) {
      return persistedTaskRuntimeIdentity;
    }

    throw new Error(
      `Asking task ${queryId} does not belong to the current runtime scope`,
    );
  }

  return (
    normalizeRuntimeScope(toPersistedRuntimeIdentityFromSource(task)) ??
    toPersistedRuntimeIdentityFromSource(task)
  );
};

export const assertAskingTaskScopeByIdAction = async (
  service: any,
  taskId: number,
  runtimeIdentity: PersistedRuntimeIdentity,
): Promise<PersistedRuntimeIdentity> => {
  const scopedRuntimeIdentity =
    normalizeRuntimeScope(runtimeIdentity) ?? runtimeIdentity;
  const task = await service.askingTaskRepository.findOneByIdWithRuntimeScope(
    taskId,
    scopedRuntimeIdentity,
  );
  if (!task) {
    const persistedTask = await service.askingTaskRepository.findOneBy({
      id: taskId,
    });
    if (!persistedTask) {
      throw new Error(`Asking task ${taskId} not found`);
    }

    const persistedTaskRuntimeIdentity =
      normalizeRuntimeScope(
        toPersistedRuntimeIdentityFromSource(persistedTask),
      ) ?? toPersistedRuntimeIdentityFromSource(persistedTask);
    if (
      isPersistedRuntimeIdentityCompatible(
        scopedRuntimeIdentity,
        persistedTaskRuntimeIdentity,
      )
    ) {
      return persistedTaskRuntimeIdentity;
    }

    throw new Error(
      `Asking task ${taskId} does not belong to the current runtime scope`,
    );
  }

  return (
    normalizeRuntimeScope(toPersistedRuntimeIdentityFromSource(task)) ??
    toPersistedRuntimeIdentityFromSource(task)
  );
};

export const assertResponseScopeAction = async (
  service: AskingServiceThreadLike,
  responseId: number,
  runtimeIdentity: PersistedRuntimeIdentity,
): Promise<ThreadResponse> => {
  const scopedRuntimeIdentity =
    normalizeRuntimeScope(runtimeIdentity) ?? runtimeIdentity;
  const response =
    await service.threadResponseRepository.findOneByIdWithRuntimeScope(
      responseId,
      scopedRuntimeIdentity,
    );
  if (!response) {
    const persistedResponse = await service.getResponse(responseId);
    if (!persistedResponse) {
      throw new Error(`Thread response ${responseId} not found`);
    }
    const persistedResponseRuntimeIdentity =
      normalizeRuntimeScope(
        toPersistedRuntimeIdentityFromSource(persistedResponse),
      ) ?? toPersistedRuntimeIdentityFromSource(persistedResponse);
    if (
      isPersistedRuntimeIdentityCompatible(
        scopedRuntimeIdentity,
        persistedResponseRuntimeIdentity,
      )
    ) {
      return persistedResponse;
    }
    throw new Error(
      `Thread response ${responseId} does not belong to the current runtime scope`,
    );
  }
  return response;
};

export const updateThreadAction = async (
  service: AskingServiceThreadLike,
  threadId: number,
  input: Partial<AskingDetailTaskUpdateInput>,
): Promise<Thread> => {
  if (isEmpty(input)) {
    throw new Error('Update thread input is empty');
  }
  return service.threadRepository.updateOne(threadId, {
    summary: input.summary,
  });
};

export const deleteThreadAction = async (
  service: AskingServiceThreadLike,
  threadId: number,
): Promise<void> => {
  await service.threadRepository.deleteOne(threadId);
};

export const createThreadResponseAction = async (
  service: AskingServiceThreadLike,
  input: AskingDetailTaskInput,
  threadId: number,
  runtimeIdentity: PersistedRuntimeIdentity,
): Promise<ThreadResponse> => {
  assertAskingTaskIsUnbound(input.trackedAskingResult);

  const thread = await service.threadRepository.findOneBy({ id: threadId });
  if (!thread) {
    throw new Error(`Thread ${threadId} not found`);
  }

  let sourceResponse: ThreadResponse | null = null;
  if (input.sourceResponseId) {
    sourceResponse = await service.getResponse(input.sourceResponseId);
    if (!sourceResponse) {
      throw new Error(
        `Source thread response ${input.sourceResponseId} not found`,
      );
    }
  }

  let sql = input.sql;
  if (!sql && sourceResponse && input.responseKind !== 'RECOMMENDATION_FOLLOWUP') {
    sql = sourceResponse.sql;
  }

  const threadResponseIntentState = buildThreadResponseIntentState({
    askingTaskType: input.trackedAskingResult?.type || null,
    responseKind: input.responseKind || 'ANSWER',
    sourceResponseId: input.sourceResponseId ?? null,
    sql,
    threadId: thread.id,
  });

  const threadResponse = await service.threadResponseRepository.createOne({
    ...resolveFollowUpRuntimeIdentity({
      runtimeIdentity,
      sourceResponse,
      thread,
    }),
    threadId: thread.id,
    question: input.question,
    responseKind: input.responseKind || 'ANSWER',
    recommendationDetail: input.recommendationDetail,
    sql,
    sourceResponseId: input.sourceResponseId ?? null,
    resolvedIntent: threadResponseIntentState.resolvedIntent,
    artifactLineage: threadResponseIntentState.artifactLineage,
    askingTaskId: input.trackedAskingResult?.taskId,
  });

  if (input.trackedAskingResult?.taskId) {
    await service.askingTaskTracker.bindThreadResponse(
      input.trackedAskingResult.taskId,
      input.trackedAskingResult.queryId,
      thread.id,
      threadResponse.id,
      {
        question: input.trackedAskingResult.question ?? input.question,
        result: input.trackedAskingResult,
        runtimeIdentity,
      },
    );
  }

  return (
    (await service.threadResponseRepository.findOneBy({
      id: threadResponse.id,
    })) || threadResponse
  );
};

export const updateThreadResponseAction = async (
  service: AskingServiceThreadLike,
  responseId: number,
  data: { sql: string },
): Promise<ThreadResponse> => {
  const threadResponse = await service.threadResponseRepository.findOneBy({
    id: responseId,
  });
  if (!threadResponse) {
    throw new Error(`Thread response ${responseId} not found`);
  }
  return service.threadResponseRepository.updateOne(responseId, {
    sql: data.sql,
  });
};

export const getResponsesWithThreadAction = (
  service: AskingServiceThreadLike,
  threadId: number,
  runtimeIdentity?: PersistedRuntimeIdentity,
) => {
  if (!runtimeIdentity) {
    return service.threadResponseRepository.getResponsesWithThread(threadId);
  }
  const scopedRuntimeIdentity =
    normalizeRuntimeScope(runtimeIdentity) ?? runtimeIdentity;
  return service.threadResponseRepository
    .getResponsesWithThreadByScope(threadId, scopedRuntimeIdentity)
    .then(async (responses) => {
      const knownResponseIds = new Set(
        responses
          .map((response) => response.id)
          .filter((id): id is number => typeof id === 'number'),
      );
      const missingSourceResponseIds = collectMissingSourceResponseIds(
        responses,
        knownResponseIds,
      );

      if (responses.length > 0 && missingSourceResponseIds.size === 0) {
        return responses;
      }

      const persistedResponses =
        await service.threadResponseRepository.getResponsesWithThread(threadId);
      const compatibleResponses = persistedResponses.filter((response) =>
        isResponseRuntimeCompatible(response, scopedRuntimeIdentity),
      );

      if (responses.length === 0) {
        return compatibleResponses;
      }

      const compatibleResponsesById = new Map(
        compatibleResponses
          .filter((response) => typeof response.id === 'number')
          .map((response) => [response.id as number, response]),
      );
      const responsesById = new Map(
        responses
          .filter((response) => typeof response.id === 'number')
          .map((response) => [response.id as number, response]),
      );

      let nextMissingSourceResponseIds = missingSourceResponseIds;
      while (nextMissingSourceResponseIds.size > 0) {
        let addedResponse = false;
        nextMissingSourceResponseIds.forEach((sourceResponseId) => {
          const sourceResponse = compatibleResponsesById.get(sourceResponseId);
          if (!sourceResponse || responsesById.has(sourceResponseId)) {
            return;
          }

          responsesById.set(sourceResponseId, sourceResponse);
          addedResponse = true;
        });

        if (!addedResponse) {
          break;
        }

        nextMissingSourceResponseIds = collectMissingSourceResponseIds(
          Array.from(responsesById.values()),
          new Set(responsesById.keys()),
        );
      }

      return sortResponsesChronologically(Array.from(responsesById.values()));
    });
};

export const getResponseAction = (
  service: AskingServiceThreadLike,
  responseId: number,
) => service.threadResponseRepository.findOneBy({ id: responseId });

export const changeThreadResponseAnswerDetailStatusAction = async (
  service: AskingServiceThreadLike,
  responseId: number,
  status: any,
  content?: string,
): Promise<ThreadResponse> => {
  const response = await service.threadResponseRepository.findOneBy({
    id: responseId,
  });
  if (!response) {
    throw new Error(`Thread response ${responseId} not found`);
  }
  if (response.answerDetail?.status === status) {
    return response;
  }
  return service.threadResponseRepository.updateOne(responseId, {
    answerDetail: {
      ...response.answerDetail,
      status,
      content,
    },
  });
};

export const deleteAllThreadsByProjectIdAction = async (
  service: AskingServiceThreadLike,
  projectId: number,
): Promise<void> => {
  await service.threadRepository.deleteAllBy({ projectId });
};

import { IWrenAIAdaptor } from '../adaptors';
import {
  AskRuntimeIdentity,
  TextBasedAnswerResult,
  TextBasedAnswerStatus,
} from '../models/adaptor';
import {
  IAskingTaskRepository,
  IKnowledgeBaseRepository,
  IThreadRepository,
  ThreadResponse,
  IThreadResponseRepository,
} from '../repositories';
import {
  IProjectService,
  IDeployService,
  IQueryService,
  ThreadResponseAnswerStatus,
  PreviewDataResponse,
} from '../services';
import { getLogger } from '@server/utils';
import { PersistedRuntimeIdentity } from '@server/context/runtimeScope';
import {
  normalizeCanonicalPersistedRuntimeIdentity,
  resolveRuntimeScopeIdFromPersistedIdentityWithProjectBridgeFallback,
  toPersistedRuntimeIdentityFromSource,
} from '@server/utils/persistedRuntimeIdentity';
import { resolveProjectLanguage } from '@server/utils/runtimeExecutionContext';
import { registerShutdownCallback } from '@server/utils/shutdown';
import { getPreviewSqlModeForTemplateCarrier } from '@server/utils/templateSqlExecution';

const logger = getLogger('TextBasedAnswerBackgroundTracker');
logger.level = 'debug';

const toAskRuntimeIdentity = (
  runtimeIdentity: PersistedRuntimeIdentity,
): AskRuntimeIdentity => {
  const normalizedRuntimeIdentity =
    normalizeCanonicalPersistedRuntimeIdentity(runtimeIdentity);

  return {
    projectId:
      typeof normalizedRuntimeIdentity.projectId === 'number'
        ? normalizedRuntimeIdentity.projectId
        : undefined,
    workspaceId: normalizedRuntimeIdentity.workspaceId ?? null,
    knowledgeBaseId: normalizedRuntimeIdentity.knowledgeBaseId ?? null,
    kbSnapshotId: normalizedRuntimeIdentity.kbSnapshotId ?? null,
    deployHash: normalizedRuntimeIdentity.deployHash ?? null,
    actorUserId: normalizedRuntimeIdentity.actorUserId ?? null,
  };
};

const resolveErrorPayload = (error: unknown): Record<string, unknown> => {
  if (error instanceof Error) {
    return {
      message: error.message,
    };
  }
  if (error && typeof error === 'object') {
    const extensions = (error as { extensions?: unknown }).extensions;
    if (extensions && typeof extensions === 'object') {
      return extensions as Record<string, unknown>;
    }
    return error as Record<string, unknown>;
  }
  return {
    message: String(error),
  };
};

const buildMissingSqlError = (threadResponseId: number) =>
  new Error(`SQL is missing for response ${threadResponseId}`);

const ANSWER_RESULT_RETRYABLE_ERROR_PATTERNS = [
  /(?:read\s+)?ECONNRESET/i,
  /socket hang up/i,
  /Connection reset by peer/i,
];

const TRANSIENT_ANSWER_RESULT_MAX_RETRIES = 3;
const TRANSIENT_ANSWER_RESULT_RETRY_DELAY_MS = 300;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableAnswerResultError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || '');

  return ANSWER_RESULT_RETRYABLE_ERROR_PATTERNS.some((pattern) =>
    pattern.test(message),
  );
};

export class TextBasedAnswerBackgroundTracker {
  // tasks is a kv pair of task id and thread response
  private tasks: Record<number, ThreadResponse> = {};
  private intervalTime: number;
  private wrenAIAdaptor: IWrenAIAdaptor;
  private threadResponseRepository: IThreadResponseRepository;
  private threadRepository: IThreadRepository;
  private projectService: IProjectService;
  private deployService: IDeployService;
  private queryService: IQueryService;
  private knowledgeBaseRepository?: Pick<IKnowledgeBaseRepository, 'findOneBy'>;
  private askingTaskRepository?: Pick<IAskingTaskRepository, 'findOneBy'>;
  private runningJobs = new Set<number>();
  private pollingIntervalId: ReturnType<typeof setInterval> | null = null;
  private unregisterShutdown?: () => void;

  constructor({
    wrenAIAdaptor,
    threadResponseRepository,
    threadRepository,
    projectService,
    deployService,
    queryService,
    knowledgeBaseRepository,
    askingTaskRepository,
  }: {
    wrenAIAdaptor: IWrenAIAdaptor;
    threadResponseRepository: IThreadResponseRepository;
    threadRepository: IThreadRepository;
    projectService: IProjectService;
    deployService: IDeployService;
    queryService: IQueryService;
    knowledgeBaseRepository?: Pick<IKnowledgeBaseRepository, 'findOneBy'>;
    askingTaskRepository?: Pick<IAskingTaskRepository, 'findOneBy'>;
  }) {
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.threadResponseRepository = threadResponseRepository;
    this.threadRepository = threadRepository;
    this.projectService = projectService;
    this.deployService = deployService;
    this.queryService = queryService;
    this.knowledgeBaseRepository = knowledgeBaseRepository;
    this.askingTaskRepository = askingTaskRepository;
    this.intervalTime = 1000;
    this.start();
  }

  private start() {
    if (this.pollingIntervalId) {
      return;
    }
    this.pollingIntervalId = setInterval(async () => {
      const jobs = Object.values(this.tasks).map(
        (threadResponse) => async () => {
          if (
            this.runningJobs.has(threadResponse.id) ||
            !threadResponse.answerDetail
          ) {
            return;
          }
          this.runningJobs.add(threadResponse.id);
          try {
            if (
              threadResponse.answerDetail?.status ===
                ThreadResponseAnswerStatus.PREPROCESSING &&
              threadResponse.answerDetail.queryId
            ) {
              const responseRuntimeIdentity =
                await this.getResponseRuntimeIdentity(threadResponse);
              await this.continueAnswerFromQuery({
                threadResponse,
                runtimeIdentity: responseRuntimeIdentity,
                queryId: threadResponse.answerDetail.queryId,
                instructionCount: threadResponse.answerDetail.instructionCount,
              });
              delete this.tasks[threadResponse.id];
              return;
            }

            if (
              threadResponse.answerDetail?.status ===
                ThreadResponseAnswerStatus.STREAMING &&
              threadResponse.answerDetail.queryId
            ) {
              const responseRuntimeIdentity =
                await this.getResponseRuntimeIdentity(threadResponse);
              await this.persistStreamingAnswer({
                threadResponse,
                runtimeIdentity: responseRuntimeIdentity,
                queryId: threadResponse.answerDetail.queryId,
              });
              delete this.tasks[threadResponse.id];
              return;
            }

            // update the status to fetching data
            threadResponse = await this.persistAnswerDetail(threadResponse, {
              ...threadResponse.answerDetail,
              status: ThreadResponseAnswerStatus.FETCHING_DATA,
            });

            // get sql data
            const responseRuntimeIdentity =
              await this.getResponseRuntimeIdentity(threadResponse);
            const runtimeDeployment =
              await this.deployService.getDeploymentByRuntimeIdentity(
                responseRuntimeIdentity,
              );
            if (!runtimeDeployment) {
              throw new Error(
                'No deployment found, please deploy your project first',
              );
            }
            const project = await this.projectService.getProjectById(
              runtimeDeployment.projectId,
            );
            const mdl = runtimeDeployment.manifest;
            const responseSql = threadResponse.sql;
            if (!responseSql) {
              await this.failTask(
                threadResponse,
                buildMissingSqlError(threadResponse.id),
              );
              return;
            }
            let data: PreviewDataResponse;
            try {
              const askingTask =
                threadResponse.askingTaskId && this.askingTaskRepository
                  ? await this.askingTaskRepository.findOneBy({
                      id: threadResponse.askingTaskId,
                    })
                  : null;
              const previewSqlMode =
                getPreviewSqlModeForTemplateCarrier(askingTask);
              data = (await this.queryService.preview(responseSql, {
                project,
                manifest: mdl,
                modelingOnly: false,
                limit: 500,
                ...(previewSqlMode ? { sqlMode: previewSqlMode } : {}),
              })) as PreviewDataResponse;
            } catch (error) {
              logger.error(`Error when query sql data: ${error}`);
              await this.failTask(threadResponse, error);
              return;
            }

            // request AI service
            const response = await this.wrenAIAdaptor.createTextBasedAnswer({
              query: threadResponse.question,
              sql: responseSql,
              sqlData: data,
              threadId: threadResponse.threadId.toString(),
              runtimeScopeId:
                resolveRuntimeScopeIdFromPersistedIdentityWithProjectBridgeFallback(
                  responseRuntimeIdentity,
                ) || undefined,
              runtimeIdentity: toAskRuntimeIdentity(responseRuntimeIdentity),
              configurations: {
                language: await this.resolveRuntimeLanguage(
                  responseRuntimeIdentity,
                  project,
                ),
              },
            });
            const responseQueryId = response.queryId;
            if (!responseQueryId) {
              throw new Error('Text-based answer query id is missing');
            }
            const instructionCount = response.instructionCount ?? 0;

            threadResponse = await this.persistAnswerDetail(threadResponse, {
              ...threadResponse.answerDetail,
              queryId: responseQueryId,
              instructionCount,
              status: ThreadResponseAnswerStatus.PREPROCESSING,
            });

            await this.continueAnswerFromQuery({
              threadResponse,
              runtimeIdentity: responseRuntimeIdentity,
              queryId: responseQueryId,
              instructionCount,
            });

            delete this.tasks[threadResponse.id];
          } finally {
            this.runningJobs.delete(threadResponse.id);
          }
        },
      );

      // Run the jobs
      Promise.allSettled(jobs.map((job) => job())).then((results) => {
        // Show reason of rejection
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            logger.error(`Job ${index} failed: ${result.reason}`);
          }
        });
      });
    }, this.intervalTime);
    this.unregisterShutdown = registerShutdownCallback(() => this.stop());
  }

  public stop() {
    if (this.pollingIntervalId) {
      clearInterval(this.pollingIntervalId);
      this.pollingIntervalId = null;
    }
    this.unregisterShutdown?.();
    this.unregisterShutdown = undefined;
  }

  public addTask(threadResponse: ThreadResponse) {
    this.tasks[threadResponse.id] = threadResponse;
  }

  public getTasks() {
    return this.tasks;
  }

  private getTrackedThreadResponse(threadResponse: ThreadResponse) {
    return this.tasks[threadResponse.id] || threadResponse;
  }

  private async persistAnswerDetail(
    threadResponse: ThreadResponse,
    answerDetail: NonNullable<ThreadResponse['answerDetail']>,
  ) {
    await this.threadResponseRepository.updateOne(threadResponse.id, {
      answerDetail,
    });
    const updatedThreadResponse = {
      ...threadResponse,
      answerDetail,
    };
    this.tasks[threadResponse.id] = updatedThreadResponse;
    return updatedThreadResponse;
  }

  private async failTask(
    threadResponse: ThreadResponse,
    error: unknown,
    options: { queryId?: string } = {},
  ) {
    const trackedThreadResponse = this.getTrackedThreadResponse(threadResponse);
    await this.threadResponseRepository.updateOne(threadResponse.id, {
      answerDetail: {
        ...trackedThreadResponse.answerDetail,
        ...(options.queryId ? { queryId: options.queryId } : {}),
        status: ThreadResponseAnswerStatus.FAILED,
        error: resolveErrorPayload(error),
      },
    });
    delete this.tasks[threadResponse.id];
  }

  private async persistStreamingAnswer({
    threadResponse,
    runtimeIdentity: _runtimeIdentity,
    queryId,
  }: {
    threadResponse: ThreadResponse;
    runtimeIdentity: PersistedRuntimeIdentity;
    queryId: string;
  }) {
    try {
      const content = await this.waitForFinalAnswerContent(queryId);
      await this.persistAnswerDetail(threadResponse, {
        ...this.getTrackedThreadResponse(threadResponse).answerDetail,
        queryId,
        status: ThreadResponseAnswerStatus.FINISHED,
        content,
      });
    } catch (error) {
      logger.error(
        `Failed to finalize text answer stream for response ${threadResponse.id}: ${error}`,
      );
      await this.failTask(threadResponse, error, { queryId });
    }
  }

  private async getTextBasedAnswerResultWithRetry(queryId: string) {
    let lastError: unknown;
    for (
      let attempt = 0;
      attempt <= TRANSIENT_ANSWER_RESULT_MAX_RETRIES;
      attempt += 1
    ) {
      try {
        return await this.wrenAIAdaptor.getTextBasedAnswerResult(queryId);
      } catch (error) {
        lastError = error;
        if (
          !isRetryableAnswerResultError(error) ||
          attempt === TRANSIENT_ANSWER_RESULT_MAX_RETRIES
        ) {
          throw error;
        }

        logger.warn(
          `Text answer result ${queryId} hit a transient upstream reset; retrying (${attempt + 1}/${TRANSIENT_ANSWER_RESULT_MAX_RETRIES}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        await sleep(TRANSIENT_ANSWER_RESULT_RETRY_DELAY_MS * (attempt + 1));
      }
    }

    throw lastError;
  }

  private async waitForAnswerResult(queryId: string) {
    let result: TextBasedAnswerResult;
    do {
      result = await this.getTextBasedAnswerResultWithRetry(queryId);
      if (result.status === TextBasedAnswerStatus.PREPROCESSING) {
        await sleep(500);
      }
    } while (result.status === TextBasedAnswerStatus.PREPROCESSING);

    return result;
  }

  private async continueAnswerFromQuery({
    threadResponse,
    runtimeIdentity,
    queryId,
    instructionCount,
  }: {
    threadResponse: ThreadResponse;
    runtimeIdentity: PersistedRuntimeIdentity;
    queryId: string;
    instructionCount?: number;
  }) {
    const result = await this.waitForAnswerResult(queryId);
    const updatedAnswerDetail = {
      queryId,
      instructionCount: result.instructionCount ?? instructionCount ?? 0,
      status:
        result.status === TextBasedAnswerStatus.SUCCEEDED
          ? ThreadResponseAnswerStatus.STREAMING
          : ThreadResponseAnswerStatus.FAILED,
      numRowsUsedInLLM: result.numRowsUsedInLLM,
      error: result.error,
    };
    const updatedThreadResponse = await this.persistAnswerDetail(
      threadResponse,
      updatedAnswerDetail,
    );

    if (result.status === TextBasedAnswerStatus.SUCCEEDED) {
      await this.persistStreamingAnswer({
        threadResponse: updatedThreadResponse,
        runtimeIdentity,
        queryId,
      });
    } else {
      delete this.tasks[threadResponse.id];
    }
  }

  private async waitForFinalAnswerContent(queryId: string) {
    for (let attempt = 0; attempt < 240; attempt += 1) {
      const result = await this.getTextBasedAnswerResultWithRetry(queryId);

      if (result.status === TextBasedAnswerStatus.FAILED) {
        throw new Error(
          result.error?.message || 'Text answer generation failed',
        );
      }

      if (typeof result.content === 'string') {
        return result.content;
      }

      await sleep(500);
    }

    throw new Error(
      `Timed out waiting for finalized text answer content: ${queryId}`,
    );
  }

  private async getResponseRuntimeIdentity(
    threadResponse: ThreadResponse,
  ): Promise<PersistedRuntimeIdentity> {
    const hasResponseScope = Boolean(
      threadResponse.projectId != null ||
      threadResponse.workspaceId ||
      threadResponse.knowledgeBaseId ||
      threadResponse.kbSnapshotId ||
      threadResponse.deployHash,
    );

    if (hasResponseScope) {
      return normalizeCanonicalPersistedRuntimeIdentity(
        toPersistedRuntimeIdentityFromSource(threadResponse),
      );
    }

    const thread = await this.threadRepository.findOneBy({
      id: threadResponse.threadId,
    });
    if (!thread) {
      throw new Error(
        `Thread ${threadResponse.threadId} not found for response ${threadResponse.id}`,
      );
    }

    return normalizeCanonicalPersistedRuntimeIdentity(
      toPersistedRuntimeIdentityFromSource(
        threadResponse,
        toPersistedRuntimeIdentityFromSource(thread),
      ),
    );
  }

  private async resolveRuntimeLanguage(
    runtimeIdentity: PersistedRuntimeIdentity,
    project?: { language?: string | null } | null,
  ) {
    if (runtimeIdentity.knowledgeBaseId && this.knowledgeBaseRepository) {
      const knowledgeBase = await this.knowledgeBaseRepository.findOneBy({
        id: runtimeIdentity.knowledgeBaseId,
      });
      return resolveProjectLanguage(project as any, knowledgeBase as any);
    }

    return resolveProjectLanguage(project as any);
  }
}

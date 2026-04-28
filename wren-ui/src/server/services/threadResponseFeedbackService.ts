import type { PersistedRuntimeIdentity } from '@server/context/runtimeScope';
import type {
  ThreadResponse,
  ThreadResponseFeedback,
  ThreadResponseFeedbackReason,
  ThreadResponseFeedbackRating,
  ThreadResponseFeedbackSource,
  ThreadResponseFeedbackListResult,
  IThreadResponseFeedbackRepository,
} from '@server/repositories';
import {
  THREAD_RESPONSE_FEEDBACK_REASON_VALUES,
  ThreadResponseFeedbackReason as FeedbackReason,
} from '@server/repositories';
import type { IAskingService } from './askingServiceShared';
import { normalizeCanonicalPersistedRuntimeIdentity } from '@server/utils/persistedRuntimeIdentity';

type FeedbackAskingService = Pick<
  IAskingService,
  'getResponseScoped' | 'getAskingTaskById'
>;

export interface ThreadResponseFeedbackServiceDependencies {
  threadResponseFeedbackRepository: IThreadResponseFeedbackRepository;
  askingService: FeedbackAskingService;
}

export interface ThreadResponseFeedbackInput {
  runtimeIdentity: PersistedRuntimeIdentity;
  responseId: number;
  rating: ThreadResponseFeedbackRating;
  reasonCodes?: string[] | null;
  comment?: string | null;
  source?: ThreadResponseFeedbackSource;
}

export interface ThreadResponseFeedbackListInput {
  runtimeIdentity: PersistedRuntimeIdentity;
  workspaceIds?: string[] | null;
  rating?: ThreadResponseFeedbackRating | null;
  reasonCode?: string | null;
  source?: ThreadResponseFeedbackSource | null;
  knowledgeBaseId?: string | null;
  keyword?: string | null;
  offset?: number;
  limit?: number;
}

export interface IThreadResponseFeedbackService {
  listFeedback(
    input: ThreadResponseFeedbackListInput,
  ): Promise<ThreadResponseFeedbackListResult>;
  getFeedbackForResponse(input: {
    runtimeIdentity: PersistedRuntimeIdentity;
    responseId: number;
  }): Promise<ThreadResponseFeedback | null>;
  upsertFeedbackForResponse(
    input: ThreadResponseFeedbackInput,
  ): Promise<ThreadResponseFeedback>;
  deleteFeedbackForResponse(input: {
    runtimeIdentity: PersistedRuntimeIdentity;
    responseId: number;
  }): Promise<boolean>;
}

export class ThreadResponseFeedbackValidationError extends Error {
  public statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'ThreadResponseFeedbackValidationError';
  }
}

const normalizeRuntimeIdentity = (
  runtimeIdentity: PersistedRuntimeIdentity,
): PersistedRuntimeIdentity =>
  normalizeCanonicalPersistedRuntimeIdentity({
    projectId: runtimeIdentity.projectId ?? null,
    workspaceId: runtimeIdentity.workspaceId ?? null,
    knowledgeBaseId: runtimeIdentity.knowledgeBaseId ?? null,
    kbSnapshotId: runtimeIdentity.kbSnapshotId ?? null,
    deployHash: runtimeIdentity.deployHash ?? null,
    actorUserId: runtimeIdentity.actorUserId ?? null,
  });

const normalizeRating = (
  rating: ThreadResponseFeedbackRating,
): ThreadResponseFeedbackRating => {
  if (rating !== 'positive' && rating !== 'negative') {
    throw new ThreadResponseFeedbackValidationError(
      'Feedback rating is invalid.',
    );
  }
  return rating;
};

const normalizeReasonCodes = (
  reasonCodes?: string[] | null,
): ThreadResponseFeedbackReason[] =>
  Array.from(
    new Set(
      (Array.isArray(reasonCodes) ? reasonCodes : []).map((reason) => {
        if (
          !THREAD_RESPONSE_FEEDBACK_REASON_VALUES.includes(
            reason as FeedbackReason,
          )
        ) {
          throw new ThreadResponseFeedbackValidationError(
            `Feedback reason is invalid: ${reason}`,
          );
        }

        return reason as ThreadResponseFeedbackReason;
      }),
    ),
  );

const normalizeOptionalReasonCode = (
  reasonCode?: string | null,
): ThreadResponseFeedbackReason | null => {
  if (!reasonCode) {
    return null;
  }

  const [normalizedReasonCode] = normalizeReasonCodes([reasonCode]);
  return normalizedReasonCode || null;
};

const normalizeComment = (comment?: string | null) => {
  const normalizedComment = String(comment || '').trim();
  return normalizedComment || null;
};

const resolveResponseRuntimeIdentity = (
  response: ThreadResponse,
  fallback: PersistedRuntimeIdentity,
): PersistedRuntimeIdentity =>
  normalizeCanonicalPersistedRuntimeIdentity({
    projectId: response.projectId ?? fallback.projectId ?? null,
    workspaceId: response.workspaceId ?? fallback.workspaceId ?? null,
    knowledgeBaseId:
      response.knowledgeBaseId ?? fallback.knowledgeBaseId ?? null,
    kbSnapshotId: response.kbSnapshotId ?? fallback.kbSnapshotId ?? null,
    deployHash: response.deployHash ?? fallback.deployHash ?? null,
    actorUserId: fallback.actorUserId ?? null,
  });

const buildFeedbackMetadata = ({
  response,
  askingTask,
}: {
  response: ThreadResponse;
  askingTask?: Awaited<ReturnType<FeedbackAskingService['getAskingTaskById']>>;
}) => {
  const templateDecision = askingTask?.templateDecision || null;

  return {
    question: response.question || askingTask?.question || null,
    sql: response.sql || null,
    responseKind: response.responseKind || null,
    answerStatus: response.answerDetail?.status || null,
    chartStatus: response.chartDetail?.status || null,
    askTaskType: askingTask?.type || null,
    templateDecision: templateDecision
      ? {
          mode: templateDecision.mode ?? null,
          templateId: templateDecision.templateId ?? null,
          templateTitle: templateDecision.templateTitle ?? null,
          templateLevel:
            templateDecision.templateLevel ??
            templateDecision.sourceType ??
            null,
          templateMode: templateDecision.templateMode ?? null,
          sqlSource: templateDecision.sqlSource ?? null,
          fallbackReason: templateDecision.fallbackReason ?? null,
          score: templateDecision.score ?? null,
        }
      : null,
    traceId: askingTask?.traceId || null,
    sourceResponseId: response.sourceResponseId ?? null,
    hasChart: Boolean(
      response.chartDetail?.chartSchema || response.chartDetail?.chartType,
    ),
    hasPreview: Boolean(
      response.sql ||
      response.breakdownDetail?.steps?.length ||
      response.viewId != null,
    ),
  };
};

export class ThreadResponseFeedbackService implements IThreadResponseFeedbackService {
  private readonly threadResponseFeedbackRepository: IThreadResponseFeedbackRepository;
  private readonly askingService: FeedbackAskingService;

  constructor({
    threadResponseFeedbackRepository,
    askingService,
  }: ThreadResponseFeedbackServiceDependencies) {
    this.threadResponseFeedbackRepository = threadResponseFeedbackRepository;
    this.askingService = askingService;
  }

  public async listFeedback({
    runtimeIdentity,
    workspaceIds,
    rating,
    reasonCode,
    source,
    knowledgeBaseId,
    keyword,
    offset = 0,
    limit = 50,
  }: ThreadResponseFeedbackListInput): Promise<ThreadResponseFeedbackListResult> {
    const normalizedRuntimeIdentity = normalizeRuntimeIdentity(runtimeIdentity);
    const normalizedWorkspaceIds = Array.isArray(workspaceIds)
      ? Array.from(
          new Set(
            workspaceIds
              .map((workspaceId) => String(workspaceId || '').trim())
              .filter(Boolean),
          ),
        )
      : null;
    const normalizedRating = rating ? normalizeRating(rating) : null;
    const normalizedLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const normalizedOffset = Math.max(Number(offset) || 0, 0);

    if (Array.isArray(workspaceIds) && normalizedWorkspaceIds?.length === 0) {
      return {
        items: [],
        total: 0,
      };
    }

    if (
      !normalizedWorkspaceIds &&
      !normalizedRuntimeIdentity.workspaceId &&
      !normalizedRuntimeIdentity.projectId
    ) {
      throw new ThreadResponseFeedbackValidationError(
        'Workspace scope is required to list response feedback.',
      );
    }

    return await this.threadResponseFeedbackRepository.findAllForManagement(
      {
        projectId: normalizedWorkspaceIds
          ? null
          : (normalizedRuntimeIdentity.projectId ?? null),
        workspaceId: normalizedWorkspaceIds
          ? null
          : (normalizedRuntimeIdentity.workspaceId ?? null),
        workspaceIds: normalizedWorkspaceIds,
        knowledgeBaseId:
          knowledgeBaseId ??
          (normalizedWorkspaceIds
            ? null
            : normalizedRuntimeIdentity.knowledgeBaseId) ??
          null,
        rating: normalizedRating,
        reasonCode: normalizeOptionalReasonCode(reasonCode),
        source: source || null,
        keyword: keyword || null,
      },
      {
        offset: normalizedOffset,
        limit: normalizedLimit,
      },
    );
  }

  public async getFeedbackForResponse({
    runtimeIdentity,
    responseId,
  }: {
    runtimeIdentity: PersistedRuntimeIdentity;
    responseId: number;
  }): Promise<ThreadResponseFeedback | null> {
    const normalizedRuntimeIdentity = normalizeRuntimeIdentity(runtimeIdentity);
    const response = await this.askingService.getResponseScoped(
      responseId,
      normalizedRuntimeIdentity,
    );

    return await this.threadResponseFeedbackRepository.findOneByResponseAndActor(
      response.id,
      normalizedRuntimeIdentity.actorUserId,
    );
  }

  public async upsertFeedbackForResponse({
    runtimeIdentity,
    responseId,
    rating,
    reasonCodes,
    comment,
    source = 'result_footer',
  }: ThreadResponseFeedbackInput): Promise<ThreadResponseFeedback> {
    const normalizedRuntimeIdentity = normalizeRuntimeIdentity(runtimeIdentity);
    const normalizedRating = normalizeRating(rating);
    const response = await this.askingService.getResponseScoped(
      responseId,
      normalizedRuntimeIdentity,
    );
    const responseRuntimeIdentity = resolveResponseRuntimeIdentity(
      response,
      normalizedRuntimeIdentity,
    );
    const normalizedReasonCodes =
      normalizedRating === 'negative' ? normalizeReasonCodes(reasonCodes) : [];
    const normalizedComment =
      normalizedRating === 'negative' ? normalizeComment(comment) : null;
    const askingTask = response.askingTaskId
      ? await this.askingService.getAskingTaskById(response.askingTaskId)
      : null;

    return await this.threadResponseFeedbackRepository.upsertForResponseActor({
      threadResponseId: response.id,
      threadId: response.threadId,
      projectId: responseRuntimeIdentity.projectId ?? null,
      workspaceId: responseRuntimeIdentity.workspaceId ?? null,
      knowledgeBaseId: responseRuntimeIdentity.knowledgeBaseId ?? null,
      kbSnapshotId: responseRuntimeIdentity.kbSnapshotId ?? null,
      deployHash: responseRuntimeIdentity.deployHash ?? null,
      actorUserId: normalizedRuntimeIdentity.actorUserId ?? null,
      rating: normalizedRating,
      reasonCodes: normalizedReasonCodes,
      comment: normalizedComment,
      source,
      metadata: buildFeedbackMetadata({ response, askingTask }),
    });
  }

  public async deleteFeedbackForResponse({
    runtimeIdentity,
    responseId,
  }: {
    runtimeIdentity: PersistedRuntimeIdentity;
    responseId: number;
  }): Promise<boolean> {
    const normalizedRuntimeIdentity = normalizeRuntimeIdentity(runtimeIdentity);
    const response = await this.askingService.getResponseScoped(
      responseId,
      normalizedRuntimeIdentity,
    );
    const deleted =
      await this.threadResponseFeedbackRepository.deleteByResponseAndActor(
        response.id,
        normalizedRuntimeIdentity.actorUserId,
      );

    return deleted > 0;
  }
}

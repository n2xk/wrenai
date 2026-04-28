import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { AskingController } from '@server/controllers/askingController';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  ApiError,
  handleApiError,
  respondWithSimple,
} from '@/server/utils/apiUtils';
import { getLogger } from '@server/utils';
import { toCanonicalPersistedRuntimeIdentityFromScope } from '@server/utils/persistedRuntimeIdentity';
import { buildApiContextFromRequest } from '@/server/api/apiContext';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  buildAuthorizationContextFromRequest,
  recordAuditEvent,
} from '@server/authz';

const logger = getLogger('API_THREADS');
logger.level = 'debug';
const askingController = new AskingController();

const { runtimeScopeResolver, askingService, auditEventRepository } =
  components;

const DEFAULT_THREAD_PAGE_SIZE = 50;
const MAX_THREAD_PAGE_SIZE = 100;
const THREAD_SEARCH_MAX_LENGTH = 200;

type ThreadCursor = {
  createdAt: string;
  id: number;
};

const getSingleQueryValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const parseThreadListLimit = (value: string | string[] | undefined) => {
  const parsed = Number(getSingleQueryValue(value));
  if (!Number.isFinite(parsed)) {
    return DEFAULT_THREAD_PAGE_SIZE;
  }

  return Math.min(MAX_THREAD_PAGE_SIZE, Math.max(1, Math.floor(parsed)));
};

const parseThreadSearchKeyword = (value: string | string[] | undefined) => {
  const raw = getSingleQueryValue(value)?.trim();
  if (!raw) {
    return undefined;
  }

  return raw.slice(0, THREAD_SEARCH_MAX_LENGTH);
};

const decodeThreadCursor = (
  value: string | string[] | undefined,
): ThreadCursor | null => {
  const raw = getSingleQueryValue(value);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    const id = Number(parsed?.id);
    const createdAt = parsed?.createdAt;

    if (
      !Number.isFinite(id) ||
      typeof createdAt !== 'string' ||
      Number.isNaN(Date.parse(createdAt))
    ) {
      return null;
    }

    return {
      createdAt,
      id,
    };
  } catch (_error) {
    return null;
  }
};

const encodeThreadCursor = (
  thread: Awaited<ReturnType<typeof askingService.listThreads>>[number],
) => {
  const createdAt = thread.createdAt
    ? new Date(thread.createdAt).toISOString()
    : null;
  const id = Number(thread.id);

  if (!createdAt || !Number.isFinite(id)) {
    return null;
  }

  return Buffer.from(JSON.stringify({ createdAt, id })).toString('base64');
};

const shouldUsePagedThreadListResponse = (req: NextApiRequest) =>
  Boolean(req.query.limit || req.query.cursor || req.query.keyword);

const getKnowledgeBaseReadAuthorizationTarget = (runtimeScope: any) => ({
  actor: buildAuthorizationActorFromRuntimeScope(runtimeScope),
  resource: {
    resourceType: runtimeScope?.knowledgeBase ? 'knowledge_base' : 'workspace',
    resourceId: runtimeScope?.knowledgeBase?.id || runtimeScope?.workspace?.id,
    workspaceId: runtimeScope?.workspace?.id || null,
    attributes: {
      workspaceKind: runtimeScope?.workspace?.kind || null,
      knowledgeBaseKind: runtimeScope?.knowledgeBase?.kind || null,
    },
  },
});

const assertKnowledgeBaseReadAccess = async ({
  req,
  runtimeScope,
}: {
  req: NextApiRequest;
  runtimeScope: any;
}) => {
  const { actor, resource } =
    getKnowledgeBaseReadAuthorizationTarget(runtimeScope);

  await assertAuthorizedWithAudit({
    auditEventRepository,
    actor,
    action: 'knowledge_base.read',
    resource,
    context: buildAuthorizationContextFromRequest({
      req,
      sessionId: actor?.sessionId,
      runtimeScope,
    }),
  });

  return { actor, resource };
};

const recordKnowledgeBaseReadAudit = async ({
  actor,
  resource,
}: {
  actor: ReturnType<typeof buildAuthorizationActorFromRuntimeScope>;
  resource: ReturnType<
    typeof getKnowledgeBaseReadAuthorizationTarget
  >['resource'];
}) => {
  await recordAuditEvent({
    auditEventRepository,
    actor,
    action: 'knowledge_base.read',
    resource,
    result: 'allowed',
    payloadJson: {
      operation: 'list_threads',
    },
  });
};

const toThreadSummaryResponse = (
  threads: Awaited<ReturnType<typeof askingService.listThreads>>,
) =>
  threads.map((thread) => ({
    id: thread.id,
    summary: thread.summary,
    workspaceId: thread.workspaceId ?? null,
    knowledgeBaseId: thread.knowledgeBaseId ?? null,
    kbSnapshotId: thread.kbSnapshotId ?? null,
    deployHash: thread.deployHash ?? null,
  }));

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const startTime = Date.now();
  let runtimeScope;

  try {
    if (req.method !== 'GET' && req.method !== 'POST') {
      throw new ApiError('Method not allowed', 405);
    }

    runtimeScope = await runtimeScopeResolver.resolveRequestScope(req);

    if (req.method === 'POST') {
      const ctx = await buildApiContextFromRequest({ req, runtimeScope });
      const thread = await askingController.createThread(
        null,
        {
          data: {
            question:
              typeof req.body?.question === 'string'
                ? req.body.question
                : undefined,
            taskId:
              typeof req.body?.taskId === 'string'
                ? req.body.taskId
                : undefined,
            sql: typeof req.body?.sql === 'string' ? req.body.sql : undefined,
            knowledgeBaseIds: Array.isArray(req.body?.knowledgeBaseIds)
              ? req.body.knowledgeBaseIds
              : undefined,
            selectedSkillIds: Array.isArray(req.body?.selectedSkillIds)
              ? req.body.selectedSkillIds
              : undefined,
          },
        },
        ctx,
      );

      await respondWithSimple({
        res,
        statusCode: 201,
        responsePayload: thread,
        runtimeScope,
        apiType: ApiType.ASK,
        threadId: thread?.id != null ? String(thread.id) : undefined,
        requestPayload:
          req.body && typeof req.body === 'object' ? req.body : {},
        headers: req.headers as Record<string, string>,
        startTime,
      });
      return;
    }

    const { actor, resource } = await assertKnowledgeBaseReadAccess({
      req,
      runtimeScope,
    });
    const runtimeIdentity =
      toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope);
    const shouldPageThreads = shouldUsePagedThreadListResponse(req);
    const pageSize = parseThreadListLimit(req.query.limit);
    const threads = shouldPageThreads
      ? await askingService.listThreads(runtimeIdentity, {
          limit: pageSize + 1,
          cursor: decodeThreadCursor(req.query.cursor),
          keyword: parseThreadSearchKeyword(req.query.keyword),
        })
      : await askingService.listThreads(runtimeIdentity);
    const pageThreads = shouldPageThreads
      ? threads.slice(0, pageSize)
      : threads;
    const hasMore = shouldPageThreads && threads.length > pageSize;
    const nextCursor =
      hasMore && pageThreads.length > 0
        ? encodeThreadCursor(pageThreads[pageThreads.length - 1])
        : null;

    await recordKnowledgeBaseReadAudit({ actor, resource });

    await respondWithSimple({
      res,
      statusCode: 200,
      responsePayload: shouldPageThreads
        ? {
            threads: toThreadSummaryResponse(pageThreads),
            hasMore,
            nextCursor,
          }
        : toThreadSummaryResponse(threads),
      runtimeScope,
      apiType: ApiType.GET_THREADS,
      requestPayload: shouldPageThreads
        ? {
            limit: pageSize,
            cursor: getSingleQueryValue(req.query.cursor) || null,
            keyword: parseThreadSearchKeyword(req.query.keyword) || null,
          }
        : {},
      headers: req.headers as Record<string, string>,
      startTime,
    });
  } catch (error) {
    await handleApiError({
      error,
      res,
      runtimeScope,
      apiType: req.method === 'POST' ? ApiType.ASK : ApiType.GET_THREADS,
      requestPayload:
        req.method === 'POST' && req.body && typeof req.body === 'object'
          ? req.body
          : {},
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}

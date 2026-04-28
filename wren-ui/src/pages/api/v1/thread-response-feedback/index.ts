import type { NextApiRequest, NextApiResponse } from 'next';
import { buildApiContextFromRequest } from '@/server/api/apiContext';
import { sendRestApiError } from '@/server/api/restApi';
import { ApiError } from '@/server/utils/apiUtils';
import {
  authorize,
  buildAuthorizationActorFromValidatedSession,
} from '@server/authz';
import { getSessionTokenFromRequest } from '@server/context/actorClaims';
import type {
  KnowledgeBase,
  ThreadResponseFeedback,
  ThreadResponseFeedbackRating,
  ThreadResponseFeedbackSource,
  Workspace,
} from '@server/repositories';
import type { IContext } from '@server/types';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

const firstQueryValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const parseInteger = (
  value: string | string[] | undefined,
  fallback: number,
) => {
  const parsed = Number.parseInt(String(firstQueryValue(value) || ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseLimit = (value: string | string[] | undefined) =>
  Math.min(Math.max(parseInteger(value, DEFAULT_LIMIT), 1), MAX_LIMIT);

const parseOffset = (value: string | string[] | undefined) =>
  Math.max(parseInteger(value, 0), 0);

const parseRating = (
  value: string | string[] | undefined,
): ThreadResponseFeedbackRating | null => {
  const rawValue = firstQueryValue(value);
  if (!rawValue) {
    return null;
  }
  if (rawValue === 'positive' || rawValue === 'negative') {
    return rawValue;
  }
  throw new ApiError('Feedback rating is invalid.', 400);
};

const parseSource = (
  value: string | string[] | undefined,
): ThreadResponseFeedbackSource | null => {
  const rawValue = firstQueryValue(value);
  if (!rawValue) {
    return null;
  }
  if (
    rawValue === 'result_footer' ||
    rawValue === 'regression_test' ||
    rawValue === 'api'
  ) {
    return rawValue;
  }
  throw new ApiError('Feedback source is invalid.', 400);
};

const trimOptionalQueryValue = (value: string | string[] | undefined) => {
  const trimmed = String(firstQueryValue(value) || '').trim();
  return trimmed || null;
};

const normalizeWorkspaceFilter = (value: string | string[] | undefined) => {
  const trimmed = trimOptionalQueryValue(value);
  if (!trimmed || trimmed === 'all') {
    return null;
  }
  return trimmed;
};

const serializeWorkspace = (workspace: Workspace) => ({
  id: workspace.id,
  name: workspace.name,
  slug: workspace.slug || null,
  kind: workspace.kind || null,
});

const serializeKnowledgeBase = (knowledgeBase: KnowledgeBase) => ({
  id: knowledgeBase.id,
  workspaceId: knowledgeBase.workspaceId,
  name: knowledgeBase.name,
  slug: knowledgeBase.slug || null,
  kind: knowledgeBase.kind || null,
});

const byName = <T extends { name?: string | null; id: string }>(a: T, b: T) =>
  String(a.name || a.id).localeCompare(String(b.name || b.id), 'zh-Hans-CN');

const resolveFeedbackReadableWorkspaces = async ({
  ctx,
  req,
}: {
  ctx: IContext;
  req: NextApiRequest;
}) => {
  const sessionToken = getSessionTokenFromRequest(req);
  if (!sessionToken) {
    throw new ApiError('Authentication required', 401);
  }

  const validatedSession = await ctx.authService.validateSession(sessionToken);
  if (!validatedSession) {
    throw new ApiError('Authentication required', 401);
  }

  const visibleWorkspaces = await ctx.workspaceService.listWorkspacesForUser(
    validatedSession.user.id,
  );
  const uniqueVisibleWorkspaces = Array.from(
    new Map(
      visibleWorkspaces
        .filter((workspace) => workspace.status === 'active')
        .map((workspace) => [workspace.id, workspace] as const),
    ).values(),
  ).sort(byName);

  const readableWorkspaces: Workspace[] = [];
  for (const workspace of uniqueVisibleWorkspaces) {
    const workspaceSession = await ctx.authService
      .validateSession(sessionToken, workspace.id)
      .catch(() => null);
    if (!workspaceSession) {
      continue;
    }

    const actor = buildAuthorizationActorFromValidatedSession(workspaceSession);
    const decision = authorize({
      actor,
      action: 'feedback.read',
      resource: {
        resourceType: 'workspace',
        resourceId: workspace.id,
        workspaceId: workspace.id,
        attributes: {
          workspaceKind: workspace.kind || null,
        },
      },
    });

    if (decision.allowed) {
      readableWorkspaces.push(workspace);
    }
  }

  return {
    userId: validatedSession.user.id,
    workspaces: readableWorkspaces,
  };
};

const loadKnowledgeBaseOptions = async ({
  ctx,
  workspaceIds,
}: {
  ctx: IContext;
  workspaceIds: string[];
}) => {
  const knowledgeBaseGroups = await Promise.all(
    workspaceIds.map((workspaceId) =>
      ctx.knowledgeBaseRepository
        .findAllBy({ workspaceId }, { order: 'name asc' })
        .catch(() => [] as KnowledgeBase[]),
    ),
  );

  return knowledgeBaseGroups
    .flat()
    .filter((knowledgeBase) => !knowledgeBase.archivedAt)
    .sort(byName);
};

const decorateFeedbackItem = ({
  item,
  workspaceById,
  knowledgeBaseById,
}: {
  item: ThreadResponseFeedback;
  workspaceById: Map<string, Workspace>;
  knowledgeBaseById: Map<string, KnowledgeBase>;
}) => ({
  ...item,
  workspace: item.workspaceId
    ? serializeWorkspace(
        workspaceById.get(item.workspaceId) ||
          ({
            id: item.workspaceId,
            name: item.workspaceId,
            slug: '',
            status: 'unknown',
          } as Workspace),
      )
    : null,
  knowledgeBase: item.knowledgeBaseId
    ? serializeKnowledgeBase(
        knowledgeBaseById.get(item.knowledgeBaseId) ||
          ({
            id: item.knowledgeBaseId,
            workspaceId: item.workspaceId || '',
            name: item.knowledgeBaseId,
            slug: '',
          } as KnowledgeBase),
      )
    : null,
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      throw new ApiError('Method not allowed', 405);
    }

    const ctx = await buildApiContextFromRequest({
      req,
      runtimeScope: null,
      allowMissingRuntimeScope: true,
    });
    const offset = parseOffset(req.query.offset);
    const limit = parseLimit(req.query.limit);
    const selectedWorkspaceId = normalizeWorkspaceFilter(req.query.workspaceId);
    const { userId, workspaces } = await resolveFeedbackReadableWorkspaces({
      ctx,
      req,
    });
    const authorizedWorkspaceIds = workspaces.map((workspace) => workspace.id);

    if (
      selectedWorkspaceId &&
      !authorizedWorkspaceIds.includes(selectedWorkspaceId)
    ) {
      throw new ApiError('Feedback read permission required', 403);
    }

    const queryWorkspaceIds = selectedWorkspaceId
      ? [selectedWorkspaceId]
      : authorizedWorkspaceIds;
    const knowledgeBases = await loadKnowledgeBaseOptions({
      ctx,
      workspaceIds: authorizedWorkspaceIds,
    });
    const result = await ctx.threadResponseFeedbackService.listFeedback({
      runtimeIdentity: {
        actorUserId: userId,
        workspaceId:
          selectedWorkspaceId ||
          (queryWorkspaceIds.length === 1 ? queryWorkspaceIds[0] : null),
      },
      workspaceIds: queryWorkspaceIds,
      offset,
      limit,
      rating: parseRating(req.query.rating),
      reasonCode: trimOptionalQueryValue(req.query.reasonCode),
      source: parseSource(req.query.source),
      knowledgeBaseId: trimOptionalQueryValue(req.query.knowledgeBaseId),
      keyword: trimOptionalQueryValue(req.query.keyword),
    });
    const workspaceById = new Map(
      workspaces.map((workspace) => [workspace.id, workspace] as const),
    );
    const knowledgeBaseById = new Map(
      knowledgeBases.map(
        (knowledgeBase) => [knowledgeBase.id, knowledgeBase] as const,
      ),
    );

    return res.status(200).json({
      items: result.items.map((item) =>
        decorateFeedbackItem({ item, workspaceById, knowledgeBaseById }),
      ),
      total: result.total,
      hasMore: offset + limit < result.total,
      workspaces: workspaces.map(serializeWorkspace),
      knowledgeBases: knowledgeBases.map(serializeKnowledgeBase),
    });
  } catch (error) {
    return sendRestApiError(res, error, '加载问数反馈失败，请稍后重试。');
  }
}

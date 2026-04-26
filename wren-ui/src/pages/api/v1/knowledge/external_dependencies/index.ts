import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  ApiError,
  respondWithSimple,
  handleApiError,
} from '@/server/utils/apiUtils';
import { getLogger } from '@server/utils';
import * as Errors from '@server/utils/error';
import {
  resolvePersistedKnowledgeBaseId,
  requirePersistedWorkspaceId,
  toCanonicalPersistedRuntimeIdentityFromScope,
} from '@server/utils/persistedRuntimeIdentity';
import {
  OUTDATED_RUNTIME_SNAPSHOT_MESSAGE,
  assertLatestExecutableRuntimeScope,
} from '@/server/utils/runtimeExecutionContext';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  buildAuthorizationContextFromRequest,
  recordAuditEvent,
} from '@server/authz';

const logger = getLogger('API_EXTERNAL_DEPENDENCIES');
logger.level = 'debug';

const {
  runtimeScopeResolver,
  businessKnowledgeService,
  knowledgeBaseRepository,
  kbSnapshotRepository,
} = components;

interface CreateExternalDependencyRequest {
  dependencyId: string;
  name: string;
  aliases?: string[];
  sourceStatus?: string;
  missingBehavior?: string;
  requiredGrain?: string[];
  requiredByTerms?: string[];
  requiredByTemplates?: string[];
  relatedRules?: string[];
  askUserPrompt?: string | null;
  validation?: Record<string, any> | null;
  status?: string;
}

const assertLatestKnowledgeSnapshot = async (runtimeScope: any) => {
  try {
    await assertLatestExecutableRuntimeScope({
      runtimeScope,
      knowledgeBaseRepository,
      kbSnapshotRepository,
    });
  } catch (error) {
    throw new ApiError(
      error instanceof Error
        ? error.message
        : OUTDATED_RUNTIME_SNAPSHOT_MESSAGE,
      409,
      Errors.GeneralErrorCodes.OUTDATED_RUNTIME_SNAPSHOT,
    );
  }
};

const buildKnowledgeBaseReadResource = (runtimeIdentity: any) => ({
  resourceType: 'knowledge_base' as const,
  resourceId: resolvePersistedKnowledgeBaseId(
    runtimeIdentity,
    undefined,
    'Knowledge base scope is required',
  ),
  workspaceId: requirePersistedWorkspaceId(runtimeIdentity),
});

const buildKnowledgeBaseWriteResource = (
  runtimeScope: any,
  runtimeIdentity: any,
) => ({
  ...buildKnowledgeBaseReadResource(runtimeIdentity),
  attributes: {
    workspaceKind: runtimeScope?.workspace?.kind || null,
    knowledgeBaseKind: runtimeScope?.knowledgeBase?.kind || null,
  },
});

const validateInput = (input: CreateExternalDependencyRequest) => {
  if (!input.dependencyId?.trim()) {
    throw new ApiError('External dependency id is required', 400);
  }
  if (!input.name?.trim()) {
    throw new ApiError('External dependency name is required', 400);
  }
};

const handleGetExternalDependencies = async (
  req: NextApiRequest,
  res: NextApiResponse,
  runtimeScope: any,
  startTime: number,
) => {
  const runtimeIdentity =
    toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope);
  const actor = buildAuthorizationActorFromRuntimeScope(runtimeScope);
  await assertAuthorizedWithAudit({
    auditEventRepository: components.auditEventRepository,
    actor,
    action: 'knowledge_base.read',
    resource: buildKnowledgeBaseReadResource(runtimeIdentity),
    context: buildAuthorizationContextFromRequest({
      req,
      sessionId: actor?.sessionId,
      runtimeScope,
    }),
  });

  const externalDependencies =
    await businessKnowledgeService.listExternalDependencies(runtimeIdentity);

  await respondWithSimple({
    res,
    statusCode: 200,
    responsePayload: externalDependencies,
    runtimeScope,
    apiType: ApiType.GET_EXTERNAL_DEPENDENCIES,
    startTime,
    requestPayload: {},
    headers: req.headers as Record<string, string>,
  });
};

const handleCreateExternalDependency = async (
  req: NextApiRequest,
  res: NextApiResponse,
  runtimeScope: any,
  startTime: number,
) => {
  await assertLatestKnowledgeSnapshot(runtimeScope);
  const input = req.body as CreateExternalDependencyRequest;
  validateInput(input);
  const runtimeIdentity =
    toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope);
  const actor = buildAuthorizationActorFromRuntimeScope(runtimeScope);
  const auditContext = buildAuthorizationContextFromRequest({
    req,
    sessionId: actor?.sessionId,
    runtimeScope,
  });
  const resource = buildKnowledgeBaseWriteResource(
    runtimeScope,
    runtimeIdentity,
  );
  await assertAuthorizedWithAudit({
    auditEventRepository: components.auditEventRepository,
    actor,
    action: 'knowledge_base.update',
    resource,
    context: auditContext,
  });

  const externalDependency =
    await businessKnowledgeService.createExternalDependency(
      runtimeIdentity,
      input,
    );

  await recordAuditEvent({
    auditEventRepository: components.auditEventRepository,
    actor,
    action: 'knowledge_base.update',
    resource,
    result: 'succeeded',
    context: auditContext,
    payloadJson: { operation: 'external_dependency.create' },
    afterJson: externalDependency as any,
  });

  await respondWithSimple({
    res,
    statusCode: 201,
    responsePayload: externalDependency,
    runtimeScope,
    apiType: ApiType.CREATE_EXTERNAL_DEPENDENCY,
    startTime,
    requestPayload: req.body,
    headers: req.headers as Record<string, string>,
  });
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const startTime = Date.now();
  let runtimeScope;

  try {
    runtimeScope = await runtimeScopeResolver.resolveRequestScope(req);

    if (req.method === 'GET') {
      await handleGetExternalDependencies(req, res, runtimeScope, startTime);
      return;
    }

    if (req.method === 'POST') {
      await handleCreateExternalDependency(req, res, runtimeScope, startTime);
      return;
    }

    throw new ApiError('Method not allowed', 405);
  } catch (error) {
    await handleApiError({
      error,
      res,
      runtimeScope,
      apiType:
        req.method === 'GET'
          ? ApiType.GET_EXTERNAL_DEPENDENCIES
          : ApiType.CREATE_EXTERNAL_DEPENDENCY,
      requestPayload: req.method === 'GET' ? {} : req.body,
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}

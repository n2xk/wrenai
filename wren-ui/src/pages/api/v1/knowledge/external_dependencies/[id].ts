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

const logger = getLogger('API_EXTERNAL_DEPENDENCY_BY_ID');
logger.level = 'debug';

const {
  runtimeScopeResolver,
  businessKnowledgeService,
  knowledgeBaseRepository,
  kbSnapshotRepository,
} = components;

interface UpdateExternalDependencyRequest {
  dependencyId?: string;
  name?: string;
  aliases?: string[];
  sourceStatus?: string;
  missingBehavior?: string;
  requiredGrain?: string[];
  requiredByTerms?: string[];
  requiredByTemplates?: string[];
  relatedRules?: string[];
  triggerWhen?: string[];
  notTriggerWhen?: string[];
  lifecycle?: string;
  inputModes?: string[];
  askUserPrompt?: string | null;
  validation?: Record<string, any> | null;
  status?: string;
}

const validateAssetId = (id: any): number => {
  if (!id || typeof id !== 'string') {
    throw new ApiError('External dependency ID is required', 400);
  }
  const parsedId = parseInt(id, 10);
  if (Number.isNaN(parsedId)) {
    throw new ApiError('Invalid external dependency ID', 400);
  }
  return parsedId;
};

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

const handleUpdateExternalDependency = async (
  req: NextApiRequest,
  res: NextApiResponse,
  runtimeScope: any,
  startTime: number,
) => {
  await assertLatestKnowledgeSnapshot(runtimeScope);
  const assetId = validateAssetId(req.query.id);
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

  const existing = await businessKnowledgeService.getExternalDependency(
    runtimeIdentity,
    assetId,
  );
  if (!existing) {
    throw new ApiError('External dependency not found', 404);
  }

  const updated = await businessKnowledgeService.updateExternalDependency(
    runtimeIdentity,
    assetId,
    req.body as UpdateExternalDependencyRequest,
  );

  await recordAuditEvent({
    auditEventRepository: components.auditEventRepository,
    actor,
    action: 'knowledge_base.update',
    resource,
    result: 'succeeded',
    context: auditContext,
    beforeJson: existing as any,
    afterJson: updated as any,
    payloadJson: {
      operation: 'external_dependency.update',
      externalDependencyId: assetId,
    },
  });

  await respondWithSimple({
    res,
    statusCode: 200,
    responsePayload: updated,
    runtimeScope,
    apiType: ApiType.UPDATE_EXTERNAL_DEPENDENCY,
    startTime,
    requestPayload: req.body,
    headers: req.headers as Record<string, string>,
  });
};

const handleDeleteExternalDependency = async (
  req: NextApiRequest,
  res: NextApiResponse,
  runtimeScope: any,
  startTime: number,
) => {
  await assertLatestKnowledgeSnapshot(runtimeScope);
  const assetId = validateAssetId(req.query.id);
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

  const existing = await businessKnowledgeService.getExternalDependency(
    runtimeIdentity,
    assetId,
  );
  if (!existing) {
    throw new ApiError('External dependency not found', 404);
  }

  await businessKnowledgeService.deleteExternalDependency(
    runtimeIdentity,
    assetId,
  );

  await recordAuditEvent({
    auditEventRepository: components.auditEventRepository,
    actor,
    action: 'knowledge_base.update',
    resource,
    result: 'succeeded',
    context: auditContext,
    beforeJson: existing as any,
    payloadJson: {
      operation: 'external_dependency.delete',
      externalDependencyId: assetId,
    },
  });

  await respondWithSimple({
    res,
    statusCode: 204,
    responsePayload: {},
    runtimeScope,
    apiType: ApiType.DELETE_EXTERNAL_DEPENDENCY,
    startTime,
    requestPayload: { id: assetId },
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

    if (req.method === 'PUT') {
      await handleUpdateExternalDependency(req, res, runtimeScope, startTime);
      return;
    }

    if (req.method === 'DELETE') {
      await handleDeleteExternalDependency(req, res, runtimeScope, startTime);
      return;
    }

    throw new ApiError('Method not allowed', 405);
  } catch (error) {
    await handleApiError({
      error,
      res,
      runtimeScope,
      apiType:
        req.method === 'PUT'
          ? ApiType.UPDATE_EXTERNAL_DEPENDENCY
          : ApiType.DELETE_EXTERNAL_DEPENDENCY,
      requestPayload: req.method === 'PUT' ? req.body : { id: req.query.id },
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}

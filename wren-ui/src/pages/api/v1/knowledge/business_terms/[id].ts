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

const logger = getLogger('API_BUSINESS_TERM_BY_ID');
logger.level = 'debug';

const {
  runtimeScopeResolver,
  businessKnowledgeService,
  knowledgeBaseRepository,
  kbSnapshotRepository,
} = components;

interface UpdateBusinessTermRequest {
  termId?: string;
  name?: string;
  category?: string;
  aliases?: string[];
  definition?: string;
  canonicalExpression?: string | null;
  sourceTables?: string[];
  sourceFields?: string[];
  relatedRules?: string[];
  relatedTemplates?: string[];
  features?: string[];
  conflictTerms?: string[];
  applicableScenarios?: string[];
  notApplicableScenarios?: string[];
  requiredSlots?: string[];
  status?: string;
}

const validateAssetId = (id: any): number => {
  if (!id || typeof id !== 'string') {
    throw new ApiError('Business term ID is required', 400);
  }
  const parsedId = parseInt(id, 10);
  if (Number.isNaN(parsedId)) {
    throw new ApiError('Invalid business term ID', 400);
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

const handleUpdateBusinessTerm = async (
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

  const existing = await businessKnowledgeService.getBusinessTerm(
    runtimeIdentity,
    assetId,
  );
  if (!existing) {
    throw new ApiError('Business term not found', 404);
  }

  const updated = await businessKnowledgeService.updateBusinessTerm(
    runtimeIdentity,
    assetId,
    req.body as UpdateBusinessTermRequest,
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
    payloadJson: { operation: 'business_term.update', businessTermId: assetId },
  });

  await respondWithSimple({
    res,
    statusCode: 200,
    responsePayload: updated,
    runtimeScope,
    apiType: ApiType.UPDATE_BUSINESS_TERM,
    startTime,
    requestPayload: req.body,
    headers: req.headers as Record<string, string>,
  });
};

const handleDeleteBusinessTerm = async (
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

  const existing = await businessKnowledgeService.getBusinessTerm(
    runtimeIdentity,
    assetId,
  );
  if (!existing) {
    throw new ApiError('Business term not found', 404);
  }

  await businessKnowledgeService.deleteBusinessTerm(runtimeIdentity, assetId);

  await recordAuditEvent({
    auditEventRepository: components.auditEventRepository,
    actor,
    action: 'knowledge_base.update',
    resource,
    result: 'succeeded',
    context: auditContext,
    beforeJson: existing as any,
    payloadJson: { operation: 'business_term.delete', businessTermId: assetId },
  });

  await respondWithSimple({
    res,
    statusCode: 204,
    responsePayload: {},
    runtimeScope,
    apiType: ApiType.DELETE_BUSINESS_TERM,
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
      await handleUpdateBusinessTerm(req, res, runtimeScope, startTime);
      return;
    }

    if (req.method === 'DELETE') {
      await handleDeleteBusinessTerm(req, res, runtimeScope, startTime);
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
          ? ApiType.UPDATE_BUSINESS_TERM
          : ApiType.DELETE_BUSINESS_TERM,
      requestPayload: req.method === 'PUT' ? req.body : { id: req.query.id },
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}

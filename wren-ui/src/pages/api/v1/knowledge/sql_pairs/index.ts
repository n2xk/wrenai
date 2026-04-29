import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  ApiError,
  respondWithSimple,
  handleApiError,
  validateSql,
  deriveRuntimeExecutionContextFromRequest,
} from '@/server/utils/apiUtils';
import { getLogger } from '@server/utils';
import {
  resolvePersistedKnowledgeBaseId,
  requirePersistedWorkspaceId,
  toCanonicalPersistedRuntimeIdentityFromScope,
} from '@server/utils/persistedRuntimeIdentity';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  buildAuthorizationContextFromRequest,
  recordAuditEvent,
} from '@server/authz';
import {
  MAX_SQL_PAIR_QUESTION_LENGTH,
  MAX_SQL_PAIR_SQL_LENGTH,
} from '@/server/utils/sqlPairLimits';
import {
  finalizeSqlPairTemplateMetadata,
  normalizeSqlPairTemplateMetadata,
} from '@server/utils/sqlPairTemplateMetadata';

const logger = getLogger('API_SQL_PAIRS');
logger.level = 'debug';

const { runtimeScopeResolver, sqlPairService, queryService } = components;

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

/**
 * SQL Pairs API - Manages SQL query and question pairs for knowledge base
 */
interface CreateSqlPairRequest {
  sql: string;
  question: string;
  skipSqlValidation?: boolean;
  sqlMode?: 'wren' | 'dialect';
  assetKind?: string;
  approvedAt?: string | null;
  approvedBy?: string | null;
  templateLevel?: string;
  templateMode?: string;
  sourceType?: string;
  scopeType?: string;
  parameterSchema?: Record<string, any> | null;
  businessSignature?: Record<string, any> | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  templateVersion?: number;
  status?: string;
}

const resolveSqlPairTemplateMetadataForWrite = ({
  actor,
  currentSqlPair,
  payload,
}: {
  actor: any;
  currentSqlPair?: Record<string, any> | null;
  payload: Record<string, any>;
}) => {
  try {
    return finalizeSqlPairTemplateMetadata({
      actor,
      currentSqlPair,
      metadata: normalizeSqlPairTemplateMetadata(payload, {
        includeDefaults: !currentSqlPair,
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('workspace owner/admin approval')) {
      throw new ApiError('只有工作空间所有者或管理员可以标记业务口径模板', 403);
    }
    if (message.includes('effectiveFrom')) {
      throw new ApiError('SQL 模板生效时间范围不合法', 400);
    }
    throw error;
  }
};

/**
 * Handle GET request - list all SQL pairs for the current runtime scope
 */
const handleGetSqlPairs = async (
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
  // Get all SQL pairs for the current runtime scope
  const sqlPairs = await sqlPairService.listSqlPairs(runtimeIdentity);

  // Return the SQL pairs array directly
  await respondWithSimple({
    res,
    statusCode: 200,
    responsePayload: sqlPairs,
    runtimeScope,
    apiType: ApiType.GET_SQL_PAIRS,
    startTime,
    requestPayload: {},
    headers: req.headers as Record<string, string>,
  });
};

/**
 * Handle POST request - create a new SQL pair
 */
const handleCreateSqlPair = async (
  req: NextApiRequest,
  res: NextApiResponse,
  runtimeScope: any,
  executionContext: any,
  startTime: number,
) => {
  const { sql, question, skipSqlValidation, sqlMode } =
    req.body as CreateSqlPairRequest;
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

  // Input validation
  if (!sql) {
    throw new ApiError('SQL is required', 400);
  }

  if (!question) {
    throw new ApiError('Question is required', 400);
  }

  if (sql.length > MAX_SQL_PAIR_SQL_LENGTH) {
    throw new ApiError(
      `SQL is too long (max ${MAX_SQL_PAIR_SQL_LENGTH} characters)`,
      400,
    );
  }

  if (question.length > MAX_SQL_PAIR_QUESTION_LENGTH) {
    throw new ApiError(
      `Question is too long (max ${MAX_SQL_PAIR_QUESTION_LENGTH} characters)`,
      400,
    );
  }

  // Validate SQL syntax and compatibility unless the caller explicitly opts
  // into indexing a dialect-specific example pair (for example TiDB/MySQL
  // templates used as retrieval hints rather than executable Wren SQL).
  if (!skipSqlValidation) {
    if (sqlMode === 'wren' || sqlMode === 'dialect') {
      await validateSql(sql, executionContext, queryService, sqlMode);
    } else {
      await validateSql(sql, executionContext, queryService);
    }
  }

  // Create the SQL pair
  const templateMetadata = resolveSqlPairTemplateMetadataForWrite({
    actor,
    payload: req.body || {},
  });
  const newSqlPair = await sqlPairService.createSqlPair(runtimeIdentity, {
    sql,
    question,
    ...templateMetadata,
  });

  await recordAuditEvent({
    auditEventRepository: components.auditEventRepository,
    actor,
    action: 'knowledge_base.update',
    resource,
    result: 'succeeded',
    context: auditContext,
    afterJson: newSqlPair as any,
    payloadJson: {
      operation: 'sql_pair.create',
    },
  });

  // Return the created SQL pair directly
  await respondWithSimple({
    res,
    statusCode: 201,
    responsePayload: newSqlPair,
    runtimeScope,
    apiType: ApiType.CREATE_SQL_PAIR,
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

    // Handle GET method - list SQL pairs
    if (req.method === 'GET') {
      await handleGetSqlPairs(req, res, runtimeScope, startTime);
      return;
    }

    // Handle POST method - create SQL pair
    if (req.method === 'POST') {
      const derivedContext = await deriveRuntimeExecutionContextFromRequest({
        req,
        runtimeScopeResolver,
        noDeploymentMessage:
          'No deployment found, please deploy your project first',
        requireLatestExecutableSnapshot: true,
      });
      runtimeScope = derivedContext.runtimeScope;
      await handleCreateSqlPair(
        req,
        res,
        runtimeScope,
        derivedContext.executionContext,
        startTime,
      );
      return;
    }

    // Method not allowed
    throw new ApiError('Method not allowed', 405);
  } catch (error) {
    await handleApiError({
      error,
      res,
      runtimeScope,
      apiType:
        req.method === 'GET' ? ApiType.GET_SQL_PAIRS : ApiType.CREATE_SQL_PAIR,
      requestPayload: req.method === 'GET' ? {} : req.body,
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}

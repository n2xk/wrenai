import { DataSourceName, IContext } from '../types';
import { DeployResponse } from '../services/deployService';
import { syncLatestExecutableKnowledgeBaseSnapshot } from '../utils/knowledgeBaseRuntime';
import {
  isMissingRuntimeExecutionContextError,
  SyncStatusEnum,
} from './modelControllerShared';

const KNOWLEDGE_ASSET_DEPLOY_TIMEOUT_MS = 90_000;
const KNOWLEDGE_ASSET_DEPLOY_POLL_INTERVAL_MS = 500;

interface ModelControllerRuntimeDeps {
  assertKnowledgeBaseReadAccess: (
    ctx: IContext,
    runtimeScope?: IContext['runtimeScope'],
  ) => Promise<void>;
  assertKnowledgeBaseWriteAccess: (ctx: IContext) => Promise<void>;
  getCurrentRuntimeIdentity: (ctx: IContext) => any;
  getRuntimeSelection: (ctx: IContext) => { runtimeIdentity: any };
  getRuntimeProject: (
    ctx: IContext,
    fallbackBridgeProjectId?: number | null,
  ) => Promise<any>;
  resolveBridgeProjectIdFallback: (
    runtimeIdentity: any,
    fallbackBridgeProjectId?: number | null,
  ) => number | null;
  recordKnowledgeBaseReadAudit: (
    ctx: IContext,
    args: {
      runtimeScope?: IContext['runtimeScope'];
      resourceType?: string | null;
      resourceId?: string | number | null;
      payloadJson?: Record<string, any> | null;
    },
  ) => Promise<void>;
  recordKnowledgeBaseWriteAudit: (
    ctx: IContext,
    args: {
      resourceType: string;
      resourceId?: string | number | null;
      afterJson?: Record<string, any> | null;
      payloadJson?: Record<string, any> | null;
    },
  ) => Promise<void>;
  isInternalAiServiceRequest: (ctx: IContext) => boolean;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const waitForInstructionDeployment = async ({
  ctx,
  queryId,
}: {
  ctx: IContext;
  queryId: string;
}) => {
  const deadline = Date.now() + KNOWLEDGE_ASSET_DEPLOY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const result = await ctx.wrenAIAdaptor.getInstructionResult(queryId);
    if (result.status === 'FINISHED') {
      return;
    }
    if (result.status === 'FAILED' || result.error) {
      throw new Error(result.error?.message || 'Failed to index instructions');
    }
    await sleep(KNOWLEDGE_ASSET_DEPLOY_POLL_INTERVAL_MS);
  }

  throw new Error('Instruction indexing timed out');
};

const waitForSqlPairDeployment = async ({
  ctx,
  queryId,
}: {
  ctx: IContext;
  queryId: string;
}) => {
  const deadline = Date.now() + KNOWLEDGE_ASSET_DEPLOY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const result = await ctx.wrenAIAdaptor.getSqlPairResult(queryId);
    if (result.status === 'FINISHED') {
      return;
    }
    if (result.status === 'FAILED' || result.error) {
      throw new Error(result.error?.message || 'Failed to index SQL pair');
    }
    await sleep(KNOWLEDGE_ASSET_DEPLOY_POLL_INTERVAL_MS);
  }

  throw new Error('SQL pair indexing timed out');
};

const syncKnowledgeAssetsToDeployment = async ({
  ctx,
  runtimeIdentity,
}: {
  ctx: IContext;
  runtimeIdentity: {
    workspaceId: string;
    knowledgeBaseId: string;
    kbSnapshotId: string;
    deployHash: string;
    actorUserId?: string | null;
  };
}) => {
  const [instructions, sqlPairs] = await Promise.all([
    ctx.instructionService.listInstructions({
      projectId: null,
      workspaceId: runtimeIdentity.workspaceId,
      knowledgeBaseId: runtimeIdentity.knowledgeBaseId,
      kbSnapshotId: runtimeIdentity.kbSnapshotId,
      deployHash: runtimeIdentity.deployHash,
      actorUserId: runtimeIdentity.actorUserId ?? null,
    }),
    ctx.sqlPairService.listSqlPairs({
      projectId: null,
      workspaceId: runtimeIdentity.workspaceId,
      knowledgeBaseId: runtimeIdentity.knowledgeBaseId,
      kbSnapshotId: runtimeIdentity.kbSnapshotId,
      deployHash: runtimeIdentity.deployHash,
      actorUserId: runtimeIdentity.actorUserId ?? null,
    }),
  ]);

  if (instructions.length > 0) {
    const instructionQuery = await ctx.wrenAIAdaptor.generateInstruction({
      instructions: instructions.map((instruction) => ({
        id: instruction.id,
        instruction: instruction.instruction,
        questions: instruction.questions,
        isDefault: instruction.isDefault,
      })),
      runtimeIdentity,
    });
    await waitForInstructionDeployment({
      ctx,
      queryId: instructionQuery.queryId,
    });
  }

  for (const sqlPair of sqlPairs) {
    const sqlPairQuery = await ctx.wrenAIAdaptor.deploySqlPair({
      sqlPair,
      runtimeIdentity,
    });
    await waitForSqlPairDeployment({
      ctx,
      queryId: sqlPairQuery.queryId,
    });
  }
};

export const checkModelSyncAction = async ({
  ctx,
  deps,
}: {
  ctx: IContext;
  deps: Pick<
    ModelControllerRuntimeDeps,
    | 'assertKnowledgeBaseReadAccess'
    | 'getCurrentRuntimeIdentity'
    | 'recordKnowledgeBaseReadAudit'
  >;
}) => {
  await deps.assertKnowledgeBaseReadAccess(ctx);
  const runtimeIdentity = deps.getCurrentRuntimeIdentity(ctx);
  try {
    const mdlResult =
      await ctx.mdlService.makeCurrentModelMDLByRuntimeIdentity(
        runtimeIdentity,
      );
    const currentHash = ctx.deployService.createMDLHashByRuntimeIdentity(
      mdlResult.manifest,
      runtimeIdentity,
      mdlResult.project.id,
    );
    const lastDeploy =
      await ctx.deployService.getLastDeploymentByRuntimeIdentity(
        runtimeIdentity,
      );
    const inProgressDeployment =
      await ctx.deployService.getInProgressDeploymentByRuntimeIdentity(
        runtimeIdentity,
      );
    if (inProgressDeployment) {
      await deps.recordKnowledgeBaseReadAudit(ctx, {
        resourceType: 'project',
        resourceId: mdlResult.project.id,
        payloadJson: { operation: 'check_model_sync' },
      });
      return { status: SyncStatusEnum.IN_PROGRESS };
    }
    await deps.recordKnowledgeBaseReadAudit(ctx, {
      resourceType: 'project',
      resourceId: mdlResult.project.id,
      payloadJson: { operation: 'check_model_sync' },
    });
    return currentHash == lastDeploy?.hash
      ? { status: SyncStatusEnum.SYNCRONIZED }
      : { status: SyncStatusEnum.UNSYNCRONIZED };
  } catch (error) {
    if (!isMissingRuntimeExecutionContextError(error)) {
      throw error;
    }
    await deps.recordKnowledgeBaseReadAudit(ctx, {
      payloadJson: {
        operation: 'check_model_sync',
        fallbackStatus: SyncStatusEnum.UNSYNCRONIZED,
      },
    });
    return { status: SyncStatusEnum.UNSYNCRONIZED };
  }
};

export const deployAction = async ({
  force,
  ctx,
  allowInternalBypass = false,
  deps,
}: {
  force: boolean;
  ctx: IContext;
  allowInternalBypass?: boolean;
  deps: Pick<
    ModelControllerRuntimeDeps,
    | 'assertKnowledgeBaseWriteAccess'
    | 'getRuntimeSelection'
    | 'getRuntimeProject'
    | 'resolveBridgeProjectIdFallback'
    | 'recordKnowledgeBaseWriteAudit'
    | 'isInternalAiServiceRequest'
  >;
}): Promise<DeployResponse> => {
  if (!(allowInternalBypass && deps.isInternalAiServiceRequest(ctx))) {
    await deps.assertKnowledgeBaseWriteAccess(ctx);
  }
  const { runtimeIdentity } = deps.getRuntimeSelection(ctx);
  const mdlResult =
    await ctx.mdlService.makeCurrentModelMDLByRuntimeIdentity(runtimeIdentity);
  const project =
    mdlResult.project ||
    (await deps.getRuntimeProject(
      ctx,
      deps.resolveBridgeProjectIdFallback(runtimeIdentity),
    ));
  const resolvedProjectId = project.id;
  if (!project.version && project.type !== DataSourceName.DUCKDB) {
    const version =
      await ctx.projectService.getProjectConnectionVersion(project);
    await ctx.projectService.updateProject(resolvedProjectId, { version });
  }
  const deployRes = await ctx.deployService.deploy(
    mdlResult.manifest,
    {
      ...runtimeIdentity,
      projectId: resolvedProjectId,
    },
    force,
  );

  let latestSnapshotId: string | null = null;
  let latestSnapshotDeployHash: string | null = null;

  if (deployRes.status === 'SUCCESS') {
    const knowledgeBaseId =
      ctx.runtimeScope?.knowledgeBase?.id || runtimeIdentity.knowledgeBaseId;
    const knowledgeBase = knowledgeBaseId
      ? await ctx.knowledgeBaseRepository.findOneBy({ id: knowledgeBaseId })
      : null;
    const latestSnapshot = await syncLatestExecutableKnowledgeBaseSnapshot({
      knowledgeBase,
      knowledgeBaseRepository: ctx.knowledgeBaseRepository,
      kbSnapshotRepository: ctx.kbSnapshotRepository,
      deployLogRepository: ctx.deployRepository,
      deployService: ctx.deployService,
      modelRepository: ctx.modelRepository,
      relationRepository: ctx.relationRepository,
      viewRepository: ctx.viewRepository,
    });
    latestSnapshotId = latestSnapshot?.id || null;
    latestSnapshotDeployHash = latestSnapshot?.deployHash || null;

    if (
      runtimeIdentity.workspaceId &&
      runtimeIdentity.knowledgeBaseId &&
      latestSnapshotId &&
      latestSnapshotDeployHash
    ) {
      await syncKnowledgeAssetsToDeployment({
        ctx,
        runtimeIdentity: {
          workspaceId: runtimeIdentity.workspaceId,
          knowledgeBaseId: runtimeIdentity.knowledgeBaseId,
          kbSnapshotId: latestSnapshotId,
          deployHash: latestSnapshotDeployHash,
          actorUserId: runtimeIdentity.actorUserId ?? null,
        },
      });
    }
  }

  await deps.recordKnowledgeBaseWriteAudit(ctx, {
    resourceType: 'project',
    resourceId: resolvedProjectId,
    afterJson: deployRes as any,
    payloadJson: { operation: 'deploy' },
  });

  if (
    deployRes.status === 'SUCCESS' &&
    runtimeIdentity.workspaceId &&
    runtimeIdentity.knowledgeBaseId &&
    latestSnapshotId &&
    latestSnapshotDeployHash
  ) {
    return {
      ...deployRes,
      selector: {
        workspaceId: runtimeIdentity.workspaceId,
        knowledgeBaseId: runtimeIdentity.knowledgeBaseId,
        kbSnapshotId: latestSnapshotId,
        deployHash: latestSnapshotDeployHash,
      },
    } as DeployResponse;
  }

  return deployRes;
};

export const getMDLAction = async ({
  hash,
  ctx,
  deps,
}: {
  hash: string;
  ctx: IContext;
  deps: Pick<
    ModelControllerRuntimeDeps,
    'assertKnowledgeBaseReadAccess' | 'recordKnowledgeBaseReadAudit'
  >;
}) => {
  await deps.assertKnowledgeBaseReadAccess(ctx);
  const mdl = await ctx.deployService.getMDLByHash(hash);
  await deps.recordKnowledgeBaseReadAudit(ctx, {
    payloadJson: { operation: 'get_mdl', hash },
  });
  return { hash, mdl };
};

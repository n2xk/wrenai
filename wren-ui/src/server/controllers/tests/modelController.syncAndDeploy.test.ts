import { ModelController } from '../modelController';
import {
  createContext,
  restoreModelControllerBindingMode,
} from './modelController.testSupport';

describe('ModelController scope guards', () => {
  afterEach(() => {
    restoreModelControllerBindingMode();
  });

  it('uses runtime-identity-aware MDL building when checking model sync without a project bridge', async () => {
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.runtimeScope.project = { id: null };
    ctx.mdlService = {
      makeCurrentModelMDLByRuntimeIdentity: jest
        .fn()
        .mockResolvedValue({ manifest: { models: [] }, project: { id: 42 } }),
    };
    ctx.deployService.getLastDeploymentByRuntimeIdentity = jest
      .fn()
      .mockResolvedValue({ hash: 'hash-42' });
    ctx.deployService.getInProgressDeploymentByRuntimeIdentity = jest
      .fn()
      .mockResolvedValue(null);
    ctx.deployService.createMDLHashByRuntimeIdentity = jest
      .fn()
      .mockReturnValue('hash-42');

    const result = await resolver.checkModelSync({ ctx });

    expect(
      ctx.mdlService.makeCurrentModelMDLByRuntimeIdentity,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: null, deployHash: 'deploy-1' }),
    );
    expect(
      ctx.deployService.getLastDeploymentByRuntimeIdentity,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: null, deployHash: 'deploy-1' }),
    );
    expect(
      ctx.deployService.createMDLHashByRuntimeIdentity,
    ).toHaveBeenCalledWith(
      { models: [] },
      expect.objectContaining({ projectId: null, deployHash: 'deploy-1' }),
      42,
    );
    expect(result).toEqual({ status: 'SYNCRONIZED' });
    expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.read',
        result: 'allowed',
        payloadJson: {
          operation: 'check_model_sync',
        },
      }),
    );
  });

  it('prefers runtime-identity-aware MDL building for checkModelSync even when a legacy project bridge exists', async () => {
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.mdlService = {
      makeCurrentModelMDL: jest.fn(),
      makeCurrentModelMDLByRuntimeIdentity: jest
        .fn()
        .mockResolvedValue({ manifest: { models: [] }, project: { id: 42 } }),
    };
    ctx.deployService.getLastDeploymentByRuntimeIdentity = jest
      .fn()
      .mockResolvedValue({ hash: 'hash-42' });
    ctx.deployService.getInProgressDeploymentByRuntimeIdentity = jest
      .fn()
      .mockResolvedValue(null);
    ctx.deployService.createMDLHashByRuntimeIdentity = jest
      .fn()
      .mockReturnValue('hash-42');

    const result = await resolver.checkModelSync({ ctx });

    expect(ctx.mdlService.makeCurrentModelMDL).not.toHaveBeenCalled();
    expect(
      ctx.mdlService.makeCurrentModelMDLByRuntimeIdentity,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      }),
    );
    expect(
      ctx.deployService.getLastDeploymentByRuntimeIdentity,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      }),
    );
    expect(result).toEqual({ status: 'SYNCRONIZED' });
  });

  it('rejects checkModelSync without knowledge base read permission in binding-only mode', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.mdlService = {
      makeCurrentModelMDLByRuntimeIdentity: jest.fn(),
    };
    ctx.authorizationActor = {
      ...ctx.authorizationActor,
      grantedActions: [],
      workspaceRoleSource: 'legacy',
      platformRoleSource: 'legacy',
    };

    await expect(resolver.checkModelSync({ ctx })).rejects.toThrow(
      'Knowledge base read permission required',
    );

    expect(
      ctx.mdlService.makeCurrentModelMDLByRuntimeIdentity,
    ).not.toHaveBeenCalled();
  });

  it('treats missing executable runtime metadata as unsynchronized instead of failing the request', async () => {
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.mdlService = {
      makeCurrentModelMDLByRuntimeIdentity: jest
        .fn()
        .mockRejectedValue(
          new Error(
            'MDL runtime identity requires deploy metadata or resolvable project metadata',
          ),
        ),
    };

    await expect(resolver.checkModelSync({ ctx })).resolves.toEqual({
      status: 'UNSYNCRONIZED',
    });
    expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.read',
        result: 'allowed',
        payloadJson: {
          operation: 'check_model_sync',
          fallbackStatus: 'UNSYNCRONIZED',
        },
      }),
    );
  });

  it('records allowed access audit events for getMDL', async () => {
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.deployService.getMDLByHash = jest.fn().mockResolvedValue('mdl-body');

    const result = await resolver.getMDL({ hash: 'deploy-hash-1', ctx });

    expect(ctx.deployService.getMDLByHash).toHaveBeenCalledWith(
      'deploy-hash-1',
    );
    expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.read',
        result: 'allowed',
        payloadJson: {
          operation: 'get_mdl',
          hash: 'deploy-hash-1',
        },
      }),
    );
    expect(result).toEqual({
      hash: 'deploy-hash-1',
      mdl: 'mdl-body',
    });
  });

  it('rejects getMDL without knowledge base read permission in binding-only mode', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.authorizationActor = {
      ...ctx.authorizationActor,
      grantedActions: [],
      workspaceRoleSource: 'legacy',
      platformRoleSource: 'legacy',
    };
    ctx.deployService.getMDLByHash = jest.fn();

    await expect(
      resolver.getMDL({ hash: 'deploy-hash-1', ctx }),
    ).rejects.toThrow('Knowledge base read permission required');

    expect(ctx.deployService.getMDLByHash).not.toHaveBeenCalled();
  });

  it('rejects validateView without knowledge base write permission in binding-only mode', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.authorizationActor = {
      ...ctx.authorizationActor,
      grantedActions: [],
      workspaceRoleSource: 'legacy',
      platformRoleSource: 'legacy',
    };

    await expect(
      resolver.validateView({
        name: 'Orders View',
        ctx,
      }),
    ).rejects.toThrow('Knowledge base write permission required');

    expect(
      ctx.modelService.validateViewNameByRuntimeIdentity,
    ).not.toHaveBeenCalled();
  });

  it('prefers runtime-identity-aware MDL building for deploy even when a legacy project bridge exists', async () => {
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.mdlService = {
      makeCurrentModelMDL: jest.fn(),
      makeCurrentModelMDLByRuntimeIdentity: jest.fn().mockResolvedValue({
        manifest: { models: [] },
        project: {
          id: 42,
          version: '',
          type: 'POSTGRES',
          sampleDataset: null,
        },
      }),
    };
    ctx.projectService.getProjectConnectionVersion = jest
      .fn()
      .mockResolvedValue('16');
    ctx.projectService.updateProject = jest.fn().mockResolvedValue(undefined);
    ctx.deployService.deploy = jest.fn().mockResolvedValue({
      status: 'SUCCESS',
    });

    const result = await resolver.deploy({ force: false, ctx });

    expect(ctx.mdlService.makeCurrentModelMDL).not.toHaveBeenCalled();
    expect(
      ctx.mdlService.makeCurrentModelMDLByRuntimeIdentity,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      }),
    );
    expect(ctx.deployService.deploy).toHaveBeenCalledWith(
      { models: [] },
      expect.objectContaining({
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      }),
      false,
    );
    expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.update',
        resourceType: 'project',
        resourceId: '42',
        result: 'succeeded',
        afterJson: { status: 'SUCCESS' },
        payloadJson: {
          operation: 'deploy',
        },
      }),
    );
    expect(result).toEqual({ status: 'SUCCESS' });
  });

  it('reindexes instructions and sql pairs into the latest deployment scope after deploy succeeds', async () => {
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.mdlService = {
      makeCurrentModelMDLByRuntimeIdentity: jest.fn().mockResolvedValue({
        manifest: { models: [] },
        project: {
          id: 42,
          version: '16',
          type: 'POSTGRES',
          sampleDataset: null,
        },
      }),
    };
    ctx.projectService.getProjectConnectionVersion = jest.fn();
    ctx.projectService.updateProject = jest.fn();
    ctx.deployService.deploy = jest.fn().mockResolvedValue({
      status: 'SUCCESS',
      hash: 'deploy-2',
    });
    ctx.deployService.getLastDeploymentByRuntimeIdentity = jest
      .fn()
      .mockResolvedValue({
        id: 99,
        projectId: 42,
        hash: 'deploy-2',
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: null,
      });
    ctx.knowledgeBaseRepository.findOneBy = jest.fn().mockResolvedValue({
      id: 'kb-1',
      name: 'KB 1',
      workspaceId: 'workspace-1',
      defaultKbSnapshotId: null,
    });
    ctx.modelRepository = {
      findAllBy: jest.fn().mockResolvedValue([]),
      updateOne: jest.fn(),
    };
    ctx.relationRepository = {
      findAllBy: jest.fn().mockResolvedValue([]),
      updateOne: jest.fn(),
    };
    ctx.viewRepository = {
      findAllBy: jest.fn().mockResolvedValue([]),
      updateOne: jest.fn(),
    };
    ctx.knowledgeBaseRepository.updateOne = jest.fn().mockResolvedValue({});
    ctx.kbSnapshotRepository.findOneBy = jest.fn().mockResolvedValue(null);
    ctx.kbSnapshotRepository.createOne = jest.fn().mockResolvedValue({
      id: 'snapshot-2',
      deployHash: 'deploy-2',
    });
    ctx.deployRepository = {
      updateOne: jest.fn().mockResolvedValue({}),
    };
    ctx.instructionService = {
      listInstructions: jest.fn().mockResolvedValue([
        {
          id: 7,
          instruction: '首存定义为成功存款且 times = 1',
          questions: ['首充用户怎么定义？'],
          isDefault: false,
        },
      ]),
    };
    ctx.sqlPairService = {
      listSqlPairs: jest.fn().mockResolvedValue([
        {
          id: 8,
          question: '统计全部用户的存款、提现、充提差',
          sql: 'SELECT 1',
        },
      ]),
    };
    ctx.wrenAIAdaptor = {
      generateInstruction: jest
        .fn()
        .mockResolvedValue({ queryId: 'instruction-job-1' }),
      getInstructionResult: jest.fn().mockResolvedValue({ status: 'FINISHED' }),
      deploySqlPair: jest.fn().mockResolvedValue({ queryId: 'sql-pair-job-1' }),
      getSqlPairResult: jest.fn().mockResolvedValue({ status: 'FINISHED' }),
    };

    const result = await resolver.deploy({ force: false, ctx });

    expect(ctx.instructionService.listInstructions).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        deployHash: 'deploy-2',
      }),
    );
    expect(ctx.sqlPairService.listSqlPairs).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        deployHash: 'deploy-2',
      }),
    );
    expect(ctx.wrenAIAdaptor.generateInstruction).toHaveBeenCalledWith({
      instructions: [
        {
          id: 7,
          instruction: '首存定义为成功存款且 times = 1',
          questions: ['首充用户怎么定义？'],
          isDefault: false,
        },
      ],
      runtimeIdentity: {
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-2',
        deployHash: 'deploy-2',
        actorUserId: 'user-1',
      },
    });
    expect(ctx.wrenAIAdaptor.deploySqlPair).toHaveBeenCalledWith({
      sqlPair: {
        id: 8,
        question: '统计全部用户的存款、提现、充提差',
        sql: 'SELECT 1',
      },
      runtimeIdentity: {
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-2',
        deployHash: 'deploy-2',
        actorUserId: 'user-1',
      },
    });
    expect(result).toEqual({
      status: 'SUCCESS',
      hash: 'deploy-2',
      selector: {
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-2',
        deployHash: 'deploy-2',
      },
    });
  });
});

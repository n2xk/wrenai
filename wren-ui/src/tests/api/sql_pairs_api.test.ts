const mockResolveRequestScope = jest.fn();
const mockDeriveRuntimeExecutionContextFromRequest = jest.fn();
const mockValidateSql = jest.fn();
const mockCreateSqlPair = jest.fn();
const mockGetSqlPair = jest.fn();
const mockUpdateSqlPair = jest.fn();
const mockListSqlPairs = jest.fn();
const mockDeleteSqlPair = jest.fn();
const mockRespondWithSimple = jest.fn();
const mockCreateAuditEvent = jest.fn();
const mockAssertAuthorizedWithAudit = jest.fn();
const mockBuildAuthorizationActorFromRuntimeScope = jest.fn();
const mockBuildAuthorizationContextFromRequest = jest.fn();
const mockAssertLatestExecutableRuntimeScope = jest.fn();
const mockHandleApiError = jest.fn(
  async ({
    error,
    res,
  }: {
    error: Error & { statusCode?: number };
    res: any;
  }) => {
    res.statusCode = error.statusCode || 500;
    res.body = { error: error.message };
  },
);

class MockApiError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

jest.mock('@/common', () => ({
  components: {
    runtimeScopeResolver: { resolveRequestScope: mockResolveRequestScope },
    sqlPairService: {
      listSqlPairs: mockListSqlPairs,
      createSqlPair: mockCreateSqlPair,
      getSqlPair: mockGetSqlPair,
      updateSqlPair: mockUpdateSqlPair,
      deleteSqlPair: mockDeleteSqlPair,
    },
    queryService: {},
    auditEventRepository: {
      createOne: mockCreateAuditEvent,
    },
    knowledgeBaseRepository: {},
    kbSnapshotRepository: {},
  },
}));

jest.mock('@/server/utils/apiUtils', () => ({
  ApiError: MockApiError,
  respondWithSimple: mockRespondWithSimple,
  handleApiError: mockHandleApiError,
  validateSql: mockValidateSql,
  deriveRuntimeExecutionContextFromRequest:
    mockDeriveRuntimeExecutionContextFromRequest,
}));

jest.mock('@/server/utils/runtimeExecutionContext', () => ({
  OUTDATED_RUNTIME_SNAPSHOT_MESSAGE:
    'This snapshot is outdated and cannot be executed',
  assertLatestExecutableRuntimeScope: (...args: any[]) =>
    mockAssertLatestExecutableRuntimeScope(...args),
}));

jest.mock('@server/authz', () => ({
  assertAuthorizedWithAudit: (...args: any[]) =>
    mockAssertAuthorizedWithAudit(...args),
  buildAuthorizationActorFromRuntimeScope: (...args: any[]) =>
    mockBuildAuthorizationActorFromRuntimeScope(...args),
  buildAuthorizationContextFromRequest: (...args: any[]) =>
    mockBuildAuthorizationContextFromRequest(...args),
  recordAuditEvent: ({ auditEventRepository, ...payload }: any) =>
    auditEventRepository.createOne(payload),
}));

jest.mock('@server/utils', () => ({
  getLogger: () => ({
    level: 'debug',
    error: jest.fn(),
  }),
}));

describe('pages/api/v1/knowledge/sql_pairs routes', () => {
  const runtimeScope = {
    project: null,
    deployment: { projectId: 42, hash: 'deploy-1', manifest: { models: [] } },
    workspace: { id: 'workspace-1' },
    knowledgeBase: { id: 'kb-1' },
    kbSnapshot: { id: 'snapshot-1' },
    deployHash: 'deploy-1',
    userId: 'user-1',
  };
  const authActor = {
    principalId: 'user-1',
    sessionId: 'session-1',
    workspaceRoleKeys: ['owner'],
  };
  const authContext = { requestId: 'request-1' };
  const executionContext = {
    project: { id: 42, language: 'EN' },
    deployment: runtimeScope.deployment,
    manifest: runtimeScope.deployment.manifest,
    language: 'English',
    runtimeIdentity: {
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      actorUserId: 'user-1',
    },
  };
  const defaultSqlPairMetadata = {
    assetKind: 'sql_pair',
    approvedAt: null,
    approvedBy: null,
    templateLevel: 'L0',
    templateMode: 'reference',
    sourceType: 'user_saved',
    scopeType: 'knowledge_base',
    parameterSchema: null,
    businessSignature: null,
    effectiveFrom: null,
    effectiveTo: null,
    templateVersion: 1,
    status: 'active',
  };

  const createReq = (overrides: Partial<any> = {}) =>
    ({
      method: 'POST',
      query: {},
      body: {},
      headers: {},
      ...overrides,
    }) as any;

  const createRes = () => ({ statusCode: 200, body: null }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveRequestScope.mockResolvedValue(runtimeScope);
    mockDeriveRuntimeExecutionContextFromRequest.mockResolvedValue({
      runtimeScope,
      executionContext,
    });
    mockAssertLatestExecutableRuntimeScope.mockResolvedValue(undefined);
    mockBuildAuthorizationActorFromRuntimeScope.mockReturnValue(authActor);
    mockBuildAuthorizationContextFromRequest.mockReturnValue(authContext);
    mockAssertAuthorizedWithAudit.mockResolvedValue(undefined);
    mockGetSqlPair.mockResolvedValue({
      id: 7,
      sql: 'select 1',
      question: 'Existing question',
      ...defaultSqlPairMetadata,
    });
  });

  it('authorizes knowledge base read before listing sql pairs', async () => {
    const handler = (await import('../../pages/api/v1/knowledge/sql_pairs'))
      .default;
    const req = createReq({ method: 'GET' });
    const res = createRes();

    mockListSqlPairs.mockResolvedValue([{ id: 1, sql: 'select 1' }]);

    await handler(req, res);

    expect(mockAssertAuthorizedWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: authActor,
        action: 'knowledge_base.read',
        resource: expect.objectContaining({
          resourceType: 'knowledge_base',
          resourceId: 'kb-1',
          workspaceId: 'workspace-1',
        }),
        context: authContext,
      }),
    );
    expect(mockListSqlPairs).toHaveBeenCalledWith(
      executionContext.runtimeIdentity,
    );
  });

  it('creates sql pairs with derived runtime execution context when runtimeScope.project is absent', async () => {
    const handler = (await import('../../pages/api/v1/knowledge/sql_pairs'))
      .default;
    const req = createReq({
      method: 'POST',
      body: {
        sql: 'select 1',
        question: 'What happened?',
      },
    });
    const res = createRes();
    mockCreateSqlPair.mockResolvedValue({ id: 9, sql: 'select 1' });

    await handler(req, res);

    expect(mockDeriveRuntimeExecutionContextFromRequest).toHaveBeenCalledWith({
      req,
      runtimeScopeResolver: expect.any(Object),
      noDeploymentMessage:
        'No deployment found, please deploy your project first',
      requireLatestExecutableSnapshot: true,
    });
    expect(mockValidateSql).toHaveBeenCalledWith(
      'select 1',
      executionContext,
      expect.any(Object),
    );
    expect(mockCreateSqlPair).toHaveBeenCalledWith(
      executionContext.runtimeIdentity,
      {
        sql: 'select 1',
        question: 'What happened?',
        ...defaultSqlPairMetadata,
      },
    );
    expect(mockAssertAuthorizedWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.update',
      }),
    );
    expect(mockCreateAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.update',
        result: 'succeeded',
        payloadJson: {
          operation: 'sql_pair.create',
        },
      }),
    );
  });

  it('allows longer analytical sql templates during creation', async () => {
    const handler = (await import('../../pages/api/v1/knowledge/sql_pairs'))
      .default;
    const req = createReq({
      method: 'POST',
      body: {
        sql: `select 1 -- ${'x'.repeat(12000)}`,
        question: 'Import long SQL template',
      },
    });
    const res = createRes();
    mockCreateSqlPair.mockResolvedValue({ id: 10, sql: 'select 1' });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(mockValidateSql).toHaveBeenCalledWith(
      req.body.sql,
      executionContext,
      expect.any(Object),
    );
    expect(mockCreateSqlPair).toHaveBeenCalledWith(
      executionContext.runtimeIdentity,
      expect.objectContaining({ sql: req.body.sql }),
    );
  });

  it('allows callers to skip sql dry-run validation during creation', async () => {
    const handler = (await import('../../pages/api/v1/knowledge/sql_pairs'))
      .default;
    const req = createReq({
      method: 'POST',
      body: {
        sql: 'select date_add(current_date, interval 1 day)',
        question: 'Import TiDB template',
        skipSqlValidation: true,
      },
    });
    const res = createRes();
    mockCreateSqlPair.mockResolvedValue({ id: 12, sql: req.body.sql });

    await handler(req, res);

    expect(mockValidateSql).not.toHaveBeenCalled();
    expect(mockCreateSqlPair).toHaveBeenCalledWith(
      executionContext.runtimeIdentity,
      {
        sql: req.body.sql,
        question: 'Import TiDB template',
        ...defaultSqlPairMetadata,
      },
    );
  });

  it('passes explicit sql template metadata during creation', async () => {
    const handler = (await import('../../pages/api/v1/knowledge/sql_pairs'))
      .default;
    const req = createReq({
      method: 'POST',
      body: {
        sql: 'select * from deposits',
        question: '首存金额分桶',
        assetKind: 'sql_template',
        templateLevel: 'L2',
        templateMode: 'anchored_template',
        sourceType: 'business_import',
        scopeType: 'knowledge_base',
        parameterSchema: { required: ['start_date'] },
        businessSignature: { ctes: ['base', 'bucketed'] },
        templateVersion: 2,
        status: 'active',
        skipSqlValidation: true,
      },
    });
    const res = createRes();
    mockCreateSqlPair.mockResolvedValue({ id: 14, sql: req.body.sql });

    await handler(req, res);

    expect(mockCreateSqlPair).toHaveBeenCalledWith(
      executionContext.runtimeIdentity,
      {
        sql: req.body.sql,
        question: req.body.question,
        assetKind: 'sql_template',
        approvedBy: 'user-1',
        approvedAt: expect.any(String),
        templateLevel: 'L2',
        templateMode: 'anchored_template',
        sourceType: 'business_import',
        scopeType: 'knowledge_base',
        parameterSchema: { required: ['start_date'] },
        businessSignature: { ctes: ['base', 'bucketed'] },
        effectiveFrom: null,
        effectiveTo: null,
        templateVersion: 2,
        status: 'active',
      },
    );
  });

  it('updates sql pairs with derived runtime execution context when runtimeScope.project is absent', async () => {
    const handler = (
      await import('../../pages/api/v1/knowledge/sql_pairs/[id]')
    ).default;
    const req = createReq({
      method: 'PUT',
      query: { id: '7' },
      body: {
        sql: 'select 2',
        question: 'Updated question',
      },
    });
    const res = createRes();
    mockUpdateSqlPair.mockResolvedValue({ id: 7, sql: 'select 2' });

    await handler(req, res);

    expect(mockDeriveRuntimeExecutionContextFromRequest).toHaveBeenCalledWith({
      req,
      runtimeScopeResolver: expect.any(Object),
      noDeploymentMessage:
        'No deployment found, please deploy your project first',
      requireLatestExecutableSnapshot: true,
    });
    expect(mockValidateSql).toHaveBeenCalledWith(
      'select 2',
      executionContext,
      expect.any(Object),
    );
    expect(mockUpdateSqlPair).toHaveBeenCalledWith(
      executionContext.runtimeIdentity,
      7,
      expect.objectContaining({
        sql: 'select 2',
        question: 'Updated question',
        ...defaultSqlPairMetadata,
      }),
    );
    expect(mockCreateAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.update',
        result: 'succeeded',
        payloadJson: {
          operation: 'sql_pair.update',
          sqlPairId: 7,
        },
      }),
    );
  });

  it('allows longer analytical sql templates during updates', async () => {
    const handler = (
      await import('../../pages/api/v1/knowledge/sql_pairs/[id]')
    ).default;
    const req = createReq({
      method: 'PUT',
      query: { id: '11' },
      body: {
        sql: `select 2 -- ${'y'.repeat(12000)}`,
      },
    });
    const res = createRes();
    mockUpdateSqlPair.mockResolvedValue({ id: 11, sql: 'select 2' });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(mockValidateSql).toHaveBeenCalledWith(
      req.body.sql,
      executionContext,
      expect.any(Object),
    );
    expect(mockUpdateSqlPair).toHaveBeenCalledWith(
      executionContext.runtimeIdentity,
      11,
      expect.objectContaining({ sql: req.body.sql }),
    );
  });

  it('allows callers to skip sql dry-run validation during updates', async () => {
    const handler = (
      await import('../../pages/api/v1/knowledge/sql_pairs/[id]')
    ).default;
    const req = createReq({
      method: 'PUT',
      query: { id: '13' },
      body: {
        sql: 'select date_add(current_date, interval 1 day)',
        skipSqlValidation: true,
      },
    });
    const res = createRes();
    mockUpdateSqlPair.mockResolvedValue({ id: 13, sql: req.body.sql });

    await handler(req, res);

    expect(mockValidateSql).not.toHaveBeenCalled();
    expect(mockUpdateSqlPair).toHaveBeenCalledWith(
      executionContext.runtimeIdentity,
      13,
      expect.objectContaining({
        sql: req.body.sql,
        question: undefined,
        ...defaultSqlPairMetadata,
      }),
    );
  });

  it('updates only explicitly provided template metadata', async () => {
    const handler = (
      await import('../../pages/api/v1/knowledge/sql_pairs/[id]')
    ).default;
    const req = createReq({
      method: 'PUT',
      query: { id: '15' },
      body: {
        templateMode: 'anchored_template',
      },
    });
    const res = createRes();
    mockUpdateSqlPair.mockResolvedValue({
      id: 15,
      templateMode: 'anchored_template',
    });
    mockGetSqlPair.mockResolvedValue({
      id: 15,
      sql: 'select 1',
      question: 'Existing question',
      ...defaultSqlPairMetadata,
    });

    await handler(req, res);

    expect(mockUpdateSqlPair).toHaveBeenCalledWith(
      executionContext.runtimeIdentity,
      15,
      expect.objectContaining({
        ...defaultSqlPairMetadata,
        assetKind: 'sql_template',
        approvedBy: 'user-1',
        approvedAt: expect.any(String),
        sourceType: 'admin_marked',
        templateLevel: 'L2',
        templateMode: 'anchored_template',
      }),
    );
  });

  it('rejects business template promotion for non-manager writers', async () => {
    const handler = (await import('../../pages/api/v1/knowledge/sql_pairs'))
      .default;
    const req = createReq({
      method: 'POST',
      body: {
        sql: 'select * from deposits',
        question: '首存金额分桶',
        templateMode: 'anchored_template',
      },
    });
    const res = createRes();
    mockBuildAuthorizationActorFromRuntimeScope.mockReturnValue({
      principalId: 'user-2',
      sessionId: 'session-2',
      workspaceRoleKeys: ['member'],
    });

    await handler(req, res);

    expect(res.statusCode).toBe(403);
    expect(mockCreateSqlPair).not.toHaveBeenCalled();
  });

  it('audits sql pair deletion as knowledge base update', async () => {
    const handler = (
      await import('../../pages/api/v1/knowledge/sql_pairs/[id]')
    ).default;
    const req = createReq({
      method: 'DELETE',
      query: { id: '8' },
    });
    const res = createRes();

    await handler(req, res);

    expect(mockDeleteSqlPair).toHaveBeenCalledWith(
      executionContext.runtimeIdentity,
      8,
    );
    expect(mockAssertAuthorizedWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.update',
      }),
    );
    expect(mockCreateAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.update',
        result: 'succeeded',
        payloadJson: {
          operation: 'sql_pair.delete',
          sqlPairId: 8,
        },
      }),
    );
  });
});

export {};

export {};

const mockResolveRequestScope = jest.fn();
const mockGetFeedbackForResponse = jest.fn();
const mockListFeedback = jest.fn();
const mockUpsertFeedbackForResponse = jest.fn();
const mockDeleteFeedbackForResponse = jest.fn();
const mockAssertAuthorizedWithAudit = jest.fn();
const mockAuthorize = jest.fn();
const mockBuildAuthorizationActorFromValidatedSession = jest.fn();
const mockValidateSession = jest.fn();
const mockListWorkspacesForUser = jest.fn();
const mockKnowledgeBaseFindAllBy = jest.fn();

jest.mock('@/common', () => ({
  components: {
    runtimeScopeResolver: {
      resolveRequestScope: mockResolveRequestScope,
    },
    threadResponseFeedbackService: {
      listFeedback: mockListFeedback,
      getFeedbackForResponse: mockGetFeedbackForResponse,
      upsertFeedbackForResponse: mockUpsertFeedbackForResponse,
      deleteFeedbackForResponse: mockDeleteFeedbackForResponse,
    },
    authService: {
      validateSession: mockValidateSession,
    },
    automationService: {},
    auditEventRepository: {},
    telemetry: {},
    wrenEngineAdaptor: {},
    ibisAdaptor: {},
    wrenAIAdaptor: {},
    projectService: {},
    modelService: {},
    mdlService: {},
    deployService: {},
    askingService: {},
    queryService: {},
    dashboardService: {},
    spreadsheetService: {},
    sqlPairService: {},
    instructionService: {},
    businessKnowledgeService: {},
    workspaceService: {
      listWorkspacesForUser: mockListWorkspacesForUser,
    },
    secretService: {},
    connectorService: {},
    skillService: {},
    scheduleService: {},
    projectRepository: {},
    modelRepository: {},
    modelColumnRepository: {},
    modelNestedColumnRepository: {},
    relationRepository: {},
    viewRepository: {},
    deployLogRepository: {},
    schemaChangeRepository: {},
    learningRepository: {},
    dashboardRepository: {},
    dashboardItemRepository: {},
    spreadsheetRepository: {},
    spreadsheetSettingRepository: {},
    spreadsheetHistoryRepository: {},
    threadResponseFeedbackRepository: {},
    sqlPairRepository: {},
    instructionRepository: {},
    businessTermRepository: {},
    externalDependencyRepository: {},
    apiHistoryRepository: {},
    dashboardItemRefreshJobRepository: {},
    workspaceRepository: {},
    knowledgeBaseRepository: {
      findAllBy: mockKnowledgeBaseFindAllBy,
    },
    kbSnapshotRepository: {},
    connectorRepository: {},
    secretRepository: {},
    skillDefinitionRepository: {},
    skillMarketplaceCatalogRepository: {},
    userRepository: {},
    authIdentityRepository: {},
    authSessionRepository: {},
    workspaceMemberRepository: {},
    dashboardCacheBackgroundTracker: {},
  },
  serverConfig: {},
}));

jest.mock('@server/authz', () => ({
  assertAuthorizedWithAudit: (...args: any[]) =>
    mockAssertAuthorizedWithAudit(...args),
  authorize: (...args: any[]) => mockAuthorize(...args),
  buildAuthorizationActorFromValidatedSession: (...args: any[]) =>
    mockBuildAuthorizationActorFromValidatedSession(...args),
  buildAuthorizationActorFromRuntimeScope: jest.fn(() => ({
    actorId: 'user-1',
  })),
  recordAuditEvent: jest.fn(),
}));

describe('pages/api/v1/thread-responses/[id]/feedback route', () => {
  const buildRuntimeScope = (overrides: Partial<any> = {}) => ({
    source: 'explicit-request',
    selector: {
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
    },
    project: { id: 21 },
    deployment: null,
    deployHash: null,
    workspace: { id: 'workspace-1', kind: 'regular' },
    knowledgeBase: { id: 'kb-1', kind: 'regular' },
    kbSnapshot: null,
    userId: 'user-1',
    requestActor: {
      userId: 'user-1',
      authorizationActor: { actorId: 'user-1' },
    },
    ...overrides,
  });

  const createReq = (overrides: Partial<any> = {}) =>
    ({
      method: 'GET',
      query: { id: '88' },
      body: {},
      headers: {},
      ...overrides,
    }) as any;

  const createRes = () => {
    const res: any = {};
    res.status = jest.fn((statusCode: number) => {
      res.statusCode = statusCode;
      return res;
    });
    res.json = jest.fn((payload: unknown) => {
      res.body = payload;
      return res;
    });
    res.setHeader = jest.fn();
    return res;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveRequestScope.mockResolvedValue(buildRuntimeScope());
    mockAssertAuthorizedWithAudit.mockResolvedValue(undefined);
  });

  it('returns current feedback', async () => {
    const handler = (
      await import('../../pages/api/v1/thread-responses/[id]/feedback')
    ).default;
    const req = createReq({ method: 'GET' });
    const res = createRes();
    mockGetFeedbackForResponse.mockResolvedValue({
      id: 1,
      threadResponseId: 88,
      rating: 'positive',
      reasonCodes: [],
    });

    await handler(req, res);

    expect(mockGetFeedbackForResponse).toHaveBeenCalledWith({
      responseId: 88,
      runtimeIdentity: expect.objectContaining({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        actorUserId: 'user-1',
      }),
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.feedback.rating).toBe('positive');
  });

  it('upserts negative feedback with reason codes', async () => {
    const handler = (
      await import('../../pages/api/v1/thread-responses/[id]/feedback')
    ).default;
    const req = createReq({
      method: 'PUT',
      body: {
        rating: 'negative',
        reasonCodes: ['incorrect_data_retrieved'],
        comment: 'wrong metric',
      },
    });
    const res = createRes();
    mockUpsertFeedbackForResponse.mockResolvedValue({
      id: 2,
      threadResponseId: 88,
      rating: 'negative',
      reasonCodes: ['incorrect_data_retrieved'],
    });

    await handler(req, res);

    expect(mockUpsertFeedbackForResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        responseId: 88,
        rating: 'negative',
        reasonCodes: ['incorrect_data_retrieved'],
        comment: 'wrong metric',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.feedback.rating).toBe('negative');
  });

  it('rejects invalid rating', async () => {
    const handler = (
      await import('../../pages/api/v1/thread-responses/[id]/feedback')
    ).default;
    const req = createReq({
      method: 'PUT',
      body: { rating: 'bad' },
    });
    const res = createRes();

    await handler(req, res);

    expect(mockUpsertFeedbackForResponse).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('deletes feedback for the current response', async () => {
    const handler = (
      await import('../../pages/api/v1/thread-responses/[id]/feedback')
    ).default;
    const req = createReq({ method: 'DELETE' });
    const res = createRes();
    mockDeleteFeedbackForResponse.mockResolvedValue(true);

    await handler(req, res);

    expect(mockDeleteFeedbackForResponse).toHaveBeenCalledWith({
      responseId: 88,
      runtimeIdentity: expect.objectContaining({
        workspaceId: 'workspace-1',
        actorUserId: 'user-1',
      }),
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.success).toBe(true);
  });
});

describe('pages/api/v1/thread-response-feedback route', () => {
  const workspaceOne = {
    id: 'workspace-1',
    name: 'Workspace 1',
    slug: 'workspace-1',
    kind: 'regular',
    status: 'active',
  };
  const workspaceTwo = {
    id: 'workspace-2',
    name: 'Workspace 2',
    slug: 'workspace-2',
    kind: 'regular',
    status: 'active',
  };
  const buildRuntimeScope = (overrides: Partial<any> = {}) => ({
    source: 'explicit-request',
    selector: {
      workspaceId: 'workspace-1',
    },
    project: { id: 21 },
    deployment: null,
    deployHash: null,
    workspace: { id: 'workspace-1', kind: 'regular' },
    knowledgeBase: null,
    kbSnapshot: null,
    userId: 'user-1',
    requestActor: {
      userId: 'user-1',
      authorizationActor: { actorId: 'user-1' },
    },
    ...overrides,
  });

  const buildValidatedSession = (workspace = workspaceOne) => ({
    session: { id: 'session-1' },
    user: { id: 'user-1', email: 'user@example.com' },
    workspace,
    membership: { id: `member-${workspace.id}`, workspaceId: workspace.id },
    actorClaims: {
      userId: 'user-1',
      workspaceId: workspace.id,
      workspaceMemberId: `member-${workspace.id}`,
      roleKeys: ['admin'],
      permissionScopes: [],
      grantedActions: ['feedback.read'],
      isPlatformAdmin: false,
    },
  });

  const createReq = (overrides: Partial<any> = {}) =>
    ({
      method: 'GET',
      query: {},
      body: {},
      headers: {},
      ...overrides,
    }) as any;

  const createRes = () => {
    const res: any = {};
    res.status = jest.fn((statusCode: number) => {
      res.statusCode = statusCode;
      return res;
    });
    res.json = jest.fn((payload: unknown) => {
      res.body = payload;
      return res;
    });
    res.setHeader = jest.fn();
    return res;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveRequestScope.mockResolvedValue(buildRuntimeScope());
    mockAssertAuthorizedWithAudit.mockResolvedValue(undefined);
    mockValidateSession.mockImplementation(async (_sessionToken, workspaceId) =>
      buildValidatedSession(
        workspaceId === workspaceTwo.id ? workspaceTwo : workspaceOne,
      ),
    );
    mockListWorkspacesForUser.mockResolvedValue([workspaceOne, workspaceTwo]);
    mockKnowledgeBaseFindAllBy.mockImplementation(async ({ workspaceId }) =>
      workspaceId === workspaceTwo.id
        ? [
            {
              id: 'kb-2',
              workspaceId: workspaceTwo.id,
              name: 'KB 2',
              slug: 'kb-2',
              kind: 'regular',
            },
          ]
        : [
            {
              id: 'kb-1',
              workspaceId: workspaceOne.id,
              name: 'KB 1',
              slug: 'kb-1',
              kind: 'regular',
            },
          ],
    );
    mockBuildAuthorizationActorFromValidatedSession.mockImplementation(
      (validatedSession) => ({
        principalType: 'user',
        principalId: validatedSession.user.id,
        workspaceId: validatedSession.workspace.id,
        workspaceRoleKeys: ['admin'],
        permissionScopes: [],
        grantedActions: ['feedback.read'],
        isPlatformAdmin: false,
        platformRoleKeys: [],
      }),
    );
    mockAuthorize.mockReturnValue({ allowed: true });
  });

  it('lists feedback with feedback.read authorization', async () => {
    const handler = (
      await import('../../pages/api/v1/thread-response-feedback')
    ).default;
    const req = createReq({
      headers: {
        cookie: 'wren_session=session-1',
      },
      query: {
        offset: '10',
        limit: '200',
        rating: 'negative',
        reasonCode: 'incorrect_data_retrieved',
        keyword: 'GMV',
      },
    });
    const res = createRes();
    mockListFeedback.mockResolvedValue({
      items: [
        {
          id: 1,
          threadResponseId: 88,
          rating: 'negative',
          reasonCodes: ['incorrect_data_retrieved'],
        },
      ],
      total: 120,
    });

    await handler(req, res);

    expect(mockListWorkspacesForUser).toHaveBeenCalledWith('user-1');
    expect(mockAuthorize).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'feedback.read',
        resource: expect.objectContaining({
          workspaceId: 'workspace-1',
        }),
      }),
    );
    expect(mockListFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeIdentity: expect.objectContaining({
          actorUserId: 'user-1',
        }),
        workspaceIds: ['workspace-1', 'workspace-2'],
        offset: 10,
        limit: 100,
        rating: 'negative',
        reasonCode: 'incorrect_data_retrieved',
        keyword: 'GMV',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.total).toBe(120);
    expect(res.body.hasMore).toBe(true);
    expect(res.body.workspaces).toHaveLength(2);
    expect(res.body.knowledgeBases).toHaveLength(2);
  });

  it('lists feedback for a selected authorized workspace', async () => {
    const handler = (
      await import('../../pages/api/v1/thread-response-feedback')
    ).default;
    const req = createReq({
      headers: {
        cookie: 'wren_session=session-1',
      },
      query: {
        workspaceId: 'workspace-2',
      },
    });
    const res = createRes();
    mockListFeedback.mockResolvedValue({
      items: [],
      total: 0,
    });

    await handler(req, res);

    expect(mockListFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceIds: ['workspace-2'],
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejects selected workspace without feedback.read access', async () => {
    mockAuthorize.mockImplementation(({ resource }) => ({
      allowed: resource.workspaceId === 'workspace-1',
    }));
    const handler = (
      await import('../../pages/api/v1/thread-response-feedback')
    ).default;
    const req = createReq({
      headers: {
        cookie: 'wren_session=session-1',
      },
      query: {
        workspaceId: 'workspace-2',
      },
    });
    const res = createRes();

    await handler(req, res);

    expect(mockListFeedback).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rejects invalid list rating', async () => {
    const handler = (
      await import('../../pages/api/v1/thread-response-feedback')
    ).default;
    const req = createReq({
      headers: {
        cookie: 'wren_session=session-1',
      },
      query: {
        rating: 'bad',
      },
    });
    const res = createRes();

    await handler(req, res);

    expect(mockListFeedback).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

export {};

const mockBuildApiContextFromRequest = jest.fn();
const mockSendRestApiError = jest.fn(
  (res: any, error: Error & { statusCode?: number }) => {
    res.statusCode = error.statusCode || 500;
    res.body = { error: error.message };
    return res;
  },
);
const mockAssertKnowledgeBaseReadAccess = jest.fn();
const mockAssertKnowledgeBaseWriteAccess = jest.fn();

class MockApiError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

jest.mock('@/server/api/apiContext', () => ({
  buildApiContextFromRequest: mockBuildApiContextFromRequest,
}));

jest.mock('@/server/api/restApi', () => ({
  sendRestApiError: mockSendRestApiError,
}));

jest.mock('@/server/utils/apiUtils', () => ({
  ApiError: MockApiError,
}));

jest.mock('@server/controllers/modelControllerScopeSupport', () => ({
  assertKnowledgeBaseReadAccess: mockAssertKnowledgeBaseReadAccess,
  assertKnowledgeBaseWriteAccess: mockAssertKnowledgeBaseWriteAccess,
}));

describe('pages/api/v1/ask-policy-rules routes', () => {
  const createReq = (overrides: Partial<any> = {}) =>
    ({
      method: 'GET',
      query: {},
      body: {},
      headers: {},
      ...overrides,
    }) as any;

  const createRes = () => {
    const res = { statusCode: 200, body: null, headers: {} } as any;
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (payload: any) => {
      res.body = payload;
      return res;
    };
    res.setHeader = jest.fn((key: string, value: string) => {
      res.headers[key] = value;
    });
    return res;
  };

  const repository = {
    findAllForScope: jest.fn(),
    createOne: jest.fn(),
    findOneBy: jest.fn(),
    updateOne: jest.fn(),
    deleteOne: jest.fn(),
  };

  const ctx = {
    runtimeScope: {
      workspace: { id: 'workspace-1' },
      knowledgeBase: { id: 'kb-1' },
      project: { id: 42 },
    },
    requestActor: { userId: 'user-1' },
    askPolicyRuleRepository: repository,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildApiContextFromRequest.mockResolvedValue(ctx);
    mockAssertKnowledgeBaseReadAccess.mockResolvedValue(undefined);
    mockAssertKnowledgeBaseWriteAccess.mockResolvedValue(undefined);
    repository.findAllForScope.mockResolvedValue([{ id: 1, name: '安全策略' }]);
    repository.createOne.mockResolvedValue({ id: 2, name: '新增策略' });
    repository.findOneBy.mockResolvedValue({
      id: 2,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      name: '旧策略',
      status: 'active',
      version: 1,
      queryContainsAny: [],
      templateIds: [],
      forbiddenTemplates: [],
      requiredSlots: [],
      reasonCode: 'existing',
      description: null,
    });
    repository.updateOne.mockResolvedValue({ id: 2, name: '新名称' });
    repository.deleteOne.mockResolvedValue(undefined);
  });

  it('authorizes knowledge base read before listing ask policy rules', async () => {
    const handler = (await import('../../pages/api/v1/ask-policy-rules'))
      .default;
    const req = createReq({ method: 'GET' });
    const res = createRes();

    await handler(req, res);

    expect(mockAssertKnowledgeBaseReadAccess).toHaveBeenCalledWith(ctx);
    expect(repository.findAllForScope).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      includeWorkspaceRules: false,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ items: [{ id: 1, name: '安全策略' }] });
  });

  it('blocks create when caller lacks knowledge base write access', async () => {
    const handler = (await import('../../pages/api/v1/ask-policy-rules'))
      .default;
    const req = createReq({
      method: 'POST',
      body: { name: '禁止硬套日报', forbiddenTemplates: ['13'] },
    });
    const res = createRes();
    mockAssertKnowledgeBaseWriteAccess.mockRejectedValue(
      new MockApiError('Permission denied', 403),
    );

    await handler(req, res);

    expect(mockAssertKnowledgeBaseWriteAccess).toHaveBeenCalledWith(ctx);
    expect(repository.createOne).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Permission denied' });
  });

  it('creates scoped ask policy rules when caller has write access', async () => {
    const handler = (await import('../../pages/api/v1/ask-policy-rules'))
      .default;
    const req = createReq({
      method: 'POST',
      body: {
        name: '缺租户先追问',
        queryContainsAny: '首充,首存',
        requiredSlots: ['tenant_plat_id'],
        scope: 'knowledge_base',
      },
    });
    const res = createRes();

    await handler(req, res);

    expect(mockAssertKnowledgeBaseWriteAccess).toHaveBeenCalledWith(ctx);
    expect(repository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        actorUserId: 'user-1',
        name: '缺租户先追问',
        queryContainsAny: ['首充', '首存'],
        requiredSlots: ['tenant_plat_id'],
      }),
    );
    expect(res.statusCode).toBe(201);
  });

  it('always creates knowledge-base scoped ask policy rules from the management API', async () => {
    const handler = (await import('../../pages/api/v1/ask-policy-rules'))
      .default;
    const req = createReq({
      method: 'POST',
      body: {
        name: '固定知识库范围',
        scope: 'workspace',
      },
    });
    const res = createRes();

    await handler(req, res);

    expect(repository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        name: '固定知识库范围',
      }),
    );
    expect(res.statusCode).toBe(201);
  });

  it('does not allow patching a policy rule from another workspace', async () => {
    const handler = (await import('../../pages/api/v1/ask-policy-rules/[id]'))
      .default;
    const req = createReq({
      method: 'PATCH',
      query: { id: '9' },
      body: { name: 'x' },
    });
    const res = createRes();
    repository.findOneBy.mockResolvedValue({
      id: 9,
      workspaceId: 'workspace-2',
    });

    await handler(req, res);

    expect(mockAssertKnowledgeBaseWriteAccess).not.toHaveBeenCalled();
    expect(repository.updateOne).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Policy rule not found.' });
  });

  it('does not allow patching a workspace-level policy rule from the knowledge page', async () => {
    const handler = (await import('../../pages/api/v1/ask-policy-rules/[id]'))
      .default;
    const req = createReq({
      method: 'PATCH',
      query: { id: '9' },
      body: { name: 'x' },
    });
    const res = createRes();
    repository.findOneBy.mockResolvedValue({
      id: 9,
      workspaceId: 'workspace-1',
      knowledgeBaseId: null,
    });

    await handler(req, res);

    expect(mockAssertKnowledgeBaseWriteAccess).not.toHaveBeenCalled();
    expect(repository.updateOne).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Policy rule not found.' });
  });

  it('authorizes knowledge base write before deleting ask policy rules', async () => {
    const handler = (await import('../../pages/api/v1/ask-policy-rules/[id]'))
      .default;
    const req = createReq({ method: 'DELETE', query: { id: '2' } });
    const res = createRes();

    await handler(req, res);

    expect(mockAssertKnowledgeBaseWriteAccess).toHaveBeenCalledWith(ctx);
    expect(repository.deleteOne).toHaveBeenCalledWith(2);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
  });
});

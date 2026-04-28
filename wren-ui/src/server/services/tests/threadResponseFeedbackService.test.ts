import { ThreadResponseFeedbackService } from '../threadResponseFeedbackService';

const createThreadResponseFeedbackServiceHarness = () => {
  const mockThreadResponseFeedbackRepository = {
    findOneByResponseAndActor: jest.fn(),
    findAllForManagement: jest.fn(),
    upsertForResponseActor: jest.fn(),
    deleteByResponseAndActor: jest.fn(),
  };
  const mockAskingService = {
    getResponseScoped: jest.fn(),
    getAskingTaskById: jest.fn(),
  };
  const threadResponseFeedbackService = new ThreadResponseFeedbackService({
    threadResponseFeedbackRepository:
      mockThreadResponseFeedbackRepository as any,
    askingService: mockAskingService as any,
  });

  return {
    threadResponseFeedbackService,
    mockThreadResponseFeedbackRepository,
    mockAskingService,
  };
};

const buildResponse = (overrides: Partial<any> = {}) => ({
  id: 88,
  threadId: 12,
  askingTaskId: 99,
  question: 'GMV 趋势如何？',
  sql: 'select * from gmv_daily',
  workspaceId: 'workspace-1',
  knowledgeBaseId: 'kb-1',
  kbSnapshotId: 'snapshot-1',
  deployHash: 'deploy-1',
  responseKind: 'ANSWER',
  answerDetail: { status: 'FINISHED' },
  chartDetail: { status: 'FINISHED', chartType: 'line' },
  ...overrides,
});

describe('ThreadResponseFeedbackService', () => {
  it('lists feedback by workspace scope with normalized filters', async () => {
    const {
      threadResponseFeedbackService,
      mockThreadResponseFeedbackRepository,
    } = createThreadResponseFeedbackServiceHarness();
    mockThreadResponseFeedbackRepository.findAllForManagement.mockResolvedValue(
      {
        items: [
          {
            id: 1,
            threadResponseId: 88,
            rating: 'negative',
            reasonCodes: ['incorrect_data_retrieved'],
          },
        ],
        total: 1,
      },
    );

    const result = await threadResponseFeedbackService.listFeedback({
      runtimeIdentity: {
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
      },
      rating: 'negative',
      reasonCode: 'incorrect_data_retrieved',
      keyword: 'GMV',
      offset: 5,
      limit: 500,
    });

    expect(
      mockThreadResponseFeedbackRepository.findAllForManagement,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        rating: 'negative',
        reasonCode: 'incorrect_data_retrieved',
        keyword: 'GMV',
      }),
      {
        offset: 5,
        limit: 100,
      },
    );
    expect(result.total).toBe(1);
  });

  it('lists feedback across authorized workspace scopes', async () => {
    const {
      threadResponseFeedbackService,
      mockThreadResponseFeedbackRepository,
    } = createThreadResponseFeedbackServiceHarness();
    mockThreadResponseFeedbackRepository.findAllForManagement.mockResolvedValue(
      {
        items: [],
        total: 0,
      },
    );

    await threadResponseFeedbackService.listFeedback({
      runtimeIdentity: {
        actorUserId: 'user-1',
      },
      workspaceIds: ['workspace-1', 'workspace-2', 'workspace-1', ''],
      offset: 0,
      limit: 20,
    });

    expect(
      mockThreadResponseFeedbackRepository.findAllForManagement,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: null,
        workspaceId: null,
        workspaceIds: ['workspace-1', 'workspace-2'],
        knowledgeBaseId: null,
      }),
      {
        offset: 0,
        limit: 20,
      },
    );
  });

  it('returns empty results when no authorized workspace scope is provided', async () => {
    const {
      threadResponseFeedbackService,
      mockThreadResponseFeedbackRepository,
    } = createThreadResponseFeedbackServiceHarness();

    const result = await threadResponseFeedbackService.listFeedback({
      runtimeIdentity: {
        actorUserId: 'user-1',
      },
      workspaceIds: [],
    });

    expect(
      mockThreadResponseFeedbackRepository.findAllForManagement,
    ).not.toHaveBeenCalled();
    expect(result).toEqual({
      items: [],
      total: 0,
    });
  });

  it('creates positive feedback and clears reason fields', async () => {
    const {
      threadResponseFeedbackService,
      mockThreadResponseFeedbackRepository,
      mockAskingService,
    } = createThreadResponseFeedbackServiceHarness();
    mockAskingService.getResponseScoped.mockResolvedValue(buildResponse());
    mockAskingService.getAskingTaskById.mockResolvedValue({
      taskId: 99,
      queryId: 'query-1',
      question: 'GMV 趋势如何？',
      type: 'TEXT_TO_SQL',
      traceId: 'trace-1',
      templateDecision: {
        mode: 'reference',
        templateId: 7,
        templateTitle: 'GMV 日报',
        sqlSource: 'sql_pair',
      },
    });
    mockThreadResponseFeedbackRepository.upsertForResponseActor.mockResolvedValue(
      {
        id: 1,
        threadResponseId: 88,
        rating: 'positive',
        reasonCodes: [],
      },
    );

    const result =
      await threadResponseFeedbackService.upsertFeedbackForResponse({
        runtimeIdentity: {
          projectId: 3,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          actorUserId: 'user-1',
        },
        responseId: 88,
        rating: 'positive',
        reasonCodes: ['other'],
        comment: 'old comment',
      });

    expect(mockAskingService.getResponseScoped).toHaveBeenCalledWith(
      88,
      expect.objectContaining({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        actorUserId: 'user-1',
      }),
    );
    expect(
      mockThreadResponseFeedbackRepository.upsertForResponseActor,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        threadResponseId: 88,
        threadId: 12,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        actorUserId: 'user-1',
        rating: 'positive',
        reasonCodes: [],
        comment: null,
        metadata: expect.objectContaining({
          question: 'GMV 趋势如何？',
          sql: 'select * from gmv_daily',
          traceId: 'trace-1',
          templateDecision: expect.objectContaining({
            templateTitle: 'GMV 日报',
          }),
        }),
      }),
    );
    expect(result.rating).toBe('positive');
  });

  it('creates negative feedback with reasons and comment', async () => {
    const {
      threadResponseFeedbackService,
      mockThreadResponseFeedbackRepository,
      mockAskingService,
    } = createThreadResponseFeedbackServiceHarness();
    mockAskingService.getResponseScoped.mockResolvedValue(
      buildResponse({ askingTaskId: null }),
    );
    mockThreadResponseFeedbackRepository.upsertForResponseActor.mockResolvedValue(
      {
        id: 2,
        threadResponseId: 88,
        rating: 'negative',
        reasonCodes: ['incorrect_data_retrieved'],
        comment: '口径不对',
      },
    );

    await threadResponseFeedbackService.upsertFeedbackForResponse({
      runtimeIdentity: {
        workspaceId: 'workspace-1',
        actorUserId: 'user-1',
      },
      responseId: 88,
      rating: 'negative',
      reasonCodes: ['incorrect_data_retrieved', 'incorrect_data_retrieved'],
      comment: ' 口径不对 ',
    });

    expect(mockAskingService.getAskingTaskById).not.toHaveBeenCalled();
    expect(
      mockThreadResponseFeedbackRepository.upsertForResponseActor,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        rating: 'negative',
        reasonCodes: ['incorrect_data_retrieved'],
        comment: '口径不对',
      }),
    );
  });

  it('rejects invalid feedback reasons', async () => {
    const { threadResponseFeedbackService, mockAskingService } =
      createThreadResponseFeedbackServiceHarness();
    mockAskingService.getResponseScoped.mockResolvedValue(buildResponse());

    await expect(
      threadResponseFeedbackService.upsertFeedbackForResponse({
        runtimeIdentity: { workspaceId: 'workspace-1' },
        responseId: 88,
        rating: 'negative',
        reasonCodes: ['not_a_reason'],
      }),
    ).rejects.toMatchObject({
      name: 'ThreadResponseFeedbackValidationError',
      statusCode: 400,
    });
  });

  it('deletes current actor feedback after scope validation', async () => {
    const {
      threadResponseFeedbackService,
      mockThreadResponseFeedbackRepository,
      mockAskingService,
    } = createThreadResponseFeedbackServiceHarness();
    mockAskingService.getResponseScoped.mockResolvedValue(buildResponse());
    mockThreadResponseFeedbackRepository.deleteByResponseAndActor.mockResolvedValue(
      1,
    );

    const success =
      await threadResponseFeedbackService.deleteFeedbackForResponse({
        runtimeIdentity: {
          workspaceId: 'workspace-1',
          actorUserId: 'user-1',
        },
        responseId: 88,
      });

    expect(
      mockThreadResponseFeedbackRepository.deleteByResponseAndActor,
    ).toHaveBeenCalledWith(88, 'user-1');
    expect(success).toBe(true);
  });

  it('loads current actor feedback after scope validation', async () => {
    const {
      threadResponseFeedbackService,
      mockThreadResponseFeedbackRepository,
      mockAskingService,
    } = createThreadResponseFeedbackServiceHarness();
    mockAskingService.getResponseScoped.mockResolvedValue(buildResponse());
    mockThreadResponseFeedbackRepository.findOneByResponseAndActor.mockResolvedValue(
      {
        id: 1,
        threadResponseId: 88,
        rating: 'positive',
      },
    );

    const feedback = await threadResponseFeedbackService.getFeedbackForResponse(
      {
        runtimeIdentity: {
          workspaceId: 'workspace-1',
          actorUserId: 'user-1',
        },
        responseId: 88,
      },
    );

    expect(
      mockThreadResponseFeedbackRepository.findOneByResponseAndActor,
    ).toHaveBeenCalledWith(88, 'user-1');
    expect(feedback?.rating).toBe('positive');
  });
});

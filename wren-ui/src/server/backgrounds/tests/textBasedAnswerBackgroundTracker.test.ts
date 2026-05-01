import { TextBasedAnswerStatus } from '@server/models/adaptor';
import {
  TEXT_TO_SQL_SQL_MISSING_ERROR_CODE,
  TEXT_TO_SQL_SQL_MISSING_USER_MESSAGE,
  ThreadResponseAnswerStatus,
} from '@server/services/askingService';
import { TextBasedAnswerBackgroundTracker } from '../textBasedAnswerBackgroundTracker';

describe('TextBasedAnswerBackgroundTracker', () => {
  const waitForMacrotask = () =>
    new Promise<void>((resolve) => setImmediate(resolve));

  const flushBackgroundJobs = async (times = 8) => {
    for (let i = 0; i < times; i += 1) {
      await Promise.resolve();
    }
    await waitForMacrotask();
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('uses persisted response deploy hash instead of the latest deployment', async () => {
    let intervalHandler: (() => Promise<void>) | undefined;
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    setIntervalSpy.mockImplementation(((handler: TimerHandler) => {
      intervalHandler = handler as () => Promise<void>;
      return 1 as any;
    }) as any);

    const wrenAIAdaptor = {
      createTextBasedAnswer: jest.fn().mockResolvedValue({ queryId: 'text-1' }),
      getTextBasedAnswerResult: jest.fn().mockResolvedValue({
        status: TextBasedAnswerStatus.SUCCEEDED,
        numRowsUsedInLLM: 10,
        content: 'hello',
      }),
    };
    const threadResponseRepository = {
      updateOne: jest.fn().mockResolvedValue({}),
    };
    const threadRepository = {
      findOneBy: jest.fn(),
    };
    const projectService = {
      getProjectById: jest.fn().mockResolvedValue({
        id: 42,
        language: 'EN',
      }),
    };
    const deployService = {
      getDeploymentByRuntimeIdentity: jest
        .fn()
        .mockResolvedValue({ projectId: 42, manifest: { models: [] } }),
    };
    const queryService = {
      preview: jest.fn().mockResolvedValue({ data: [] }),
    };

    const tracker = new TextBasedAnswerBackgroundTracker({
      wrenAIAdaptor: wrenAIAdaptor as any,
      threadResponseRepository: threadResponseRepository as any,
      threadRepository: threadRepository as any,
      projectService: projectService as any,
      deployService: deployService as any,
      queryService: queryService as any,
    });

    tracker.addTask({
      id: 7,
      threadId: 5,
      projectId: 42,
      deployHash: 'deploy-1',
      question: 'summarize it',
      sql: 'select * from orders',
      answerDetail: {
        status: ThreadResponseAnswerStatus.NOT_STARTED,
      },
    } as any);

    if (!intervalHandler) {
      throw new Error('Interval handler was not registered');
    }
    await intervalHandler();
    await flushBackgroundJobs();

    expect(deployService.getDeploymentByRuntimeIdentity).toHaveBeenCalledWith({
      projectId: null,
      workspaceId: null,
      knowledgeBaseId: null,
      kbSnapshotId: null,
      deployHash: 'deploy-1',
      actorUserId: null,
    });
    expect(wrenAIAdaptor.createTextBasedAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeScopeId: 'deploy-1',
        runtimeIdentity: {
          projectId: undefined,
          workspaceId: null,
          knowledgeBaseId: null,
          kbSnapshotId: null,
          deployHash: 'deploy-1',
          actorUserId: null,
        },
      }),
    );
    expect(threadRepository.findOneBy).not.toHaveBeenCalled();
  });

  it('uses canonical response runtime scope directly without falling back to the thread project bridge', async () => {
    let intervalHandler: (() => Promise<void>) | undefined;
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    setIntervalSpy.mockImplementation(((handler: TimerHandler) => {
      intervalHandler = handler as () => Promise<void>;
      return 1 as any;
    }) as any);

    const wrenAIAdaptor = {
      createTextBasedAnswer: jest
        .fn()
        .mockResolvedValue({ queryId: 'text-1b' }),
      getTextBasedAnswerResult: jest.fn().mockResolvedValue({
        status: TextBasedAnswerStatus.SUCCEEDED,
        numRowsUsedInLLM: 10,
        content: 'hello',
      }),
    };
    const threadResponseRepository = {
      updateOne: jest.fn().mockResolvedValue({}),
    };
    const threadRepository = {
      findOneBy: jest.fn(),
    };
    const projectService = {
      getProjectById: jest.fn().mockResolvedValue({
        id: 42,
        language: 'EN',
      }),
    };
    const deployService = {
      getDeploymentByRuntimeIdentity: jest
        .fn()
        .mockResolvedValue({ projectId: 42, manifest: { models: [] } }),
    };
    const queryService = {
      preview: jest.fn().mockResolvedValue({ data: [] }),
    };

    const tracker = new TextBasedAnswerBackgroundTracker({
      wrenAIAdaptor: wrenAIAdaptor as any,
      threadResponseRepository: threadResponseRepository as any,
      threadRepository: threadRepository as any,
      projectService: projectService as any,
      deployService: deployService as any,
      queryService: queryService as any,
    });

    tracker.addTask({
      id: 17,
      threadId: 5,
      projectId: 42,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      question: 'summarize it',
      sql: 'select * from orders',
      answerDetail: {
        status: ThreadResponseAnswerStatus.NOT_STARTED,
      },
    } as any);

    if (!intervalHandler) {
      throw new Error('Interval handler was not registered');
    }
    await intervalHandler();
    await flushBackgroundJobs();

    expect(deployService.getDeploymentByRuntimeIdentity).toHaveBeenCalledWith({
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      actorUserId: null,
    });
    expect(wrenAIAdaptor.createTextBasedAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeScopeId: 'deploy-1',
        runtimeIdentity: {
          projectId: undefined,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: null,
        },
      }),
    );
    expect(threadRepository.findOneBy).not.toHaveBeenCalled();
  });

  it('falls back to parent thread runtime identity when response uses legacy-null bridge fields', async () => {
    let intervalHandler: (() => Promise<void>) | undefined;
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    setIntervalSpy.mockImplementation(((handler: TimerHandler) => {
      intervalHandler = handler as () => Promise<void>;
      return 1 as any;
    }) as any);

    const wrenAIAdaptor = {
      createTextBasedAnswer: jest.fn().mockResolvedValue({ queryId: 'text-2' }),
      getTextBasedAnswerResult: jest.fn().mockResolvedValue({
        status: TextBasedAnswerStatus.SUCCEEDED,
        numRowsUsedInLLM: 10,
        content: 'hello',
      }),
    };
    const threadResponseRepository = {
      updateOne: jest.fn().mockResolvedValue({}),
    };
    const threadRepository = {
      findOneBy: jest.fn().mockResolvedValue({
        id: 5,
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-thread',
        actorUserId: 'user-1',
      }),
    };
    const projectService = {
      getProjectById: jest.fn().mockResolvedValue({
        id: 42,
        language: 'EN',
      }),
    };
    const deployService = {
      getDeploymentByRuntimeIdentity: jest
        .fn()
        .mockResolvedValue({ projectId: 42, manifest: { models: [] } }),
    };
    const queryService = {
      preview: jest.fn().mockResolvedValue({ data: [] }),
    };

    const tracker = new TextBasedAnswerBackgroundTracker({
      wrenAIAdaptor: wrenAIAdaptor as any,
      threadResponseRepository: threadResponseRepository as any,
      threadRepository: threadRepository as any,
      projectService: projectService as any,
      deployService: deployService as any,
      queryService: queryService as any,
    });

    tracker.addTask({
      id: 8,
      threadId: 5,
      projectId: null,
      workspaceId: null,
      knowledgeBaseId: null,
      kbSnapshotId: null,
      deployHash: null,
      actorUserId: null,
      question: 'summarize it',
      sql: 'select * from orders',
      answerDetail: {
        status: ThreadResponseAnswerStatus.NOT_STARTED,
      },
    } as any);

    if (!intervalHandler) {
      throw new Error('Interval handler was not registered');
    }
    await intervalHandler();
    await flushBackgroundJobs();

    expect(deployService.getDeploymentByRuntimeIdentity).toHaveBeenCalledWith({
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-thread',
      actorUserId: 'user-1',
    });
    expect(wrenAIAdaptor.createTextBasedAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeScopeId: 'deploy-thread',
        runtimeIdentity: {
          projectId: undefined,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-thread',
          actorUserId: 'user-1',
        },
      }),
    );
    expect(threadRepository.findOneBy).toHaveBeenCalledWith({ id: 5 });
  });

  it('prefers knowledge base language over bridged project language', async () => {
    let intervalHandler: (() => Promise<void>) | undefined;
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    setIntervalSpy.mockImplementation(((handler: TimerHandler) => {
      intervalHandler = handler as () => Promise<void>;
      return 1 as any;
    }) as any);

    const wrenAIAdaptor = {
      createTextBasedAnswer: jest.fn().mockResolvedValue({ queryId: 'text-3' }),
      getTextBasedAnswerResult: jest.fn().mockResolvedValue({
        status: TextBasedAnswerStatus.SUCCEEDED,
        numRowsUsedInLLM: 10,
        content: 'hello',
      }),
    };
    const threadResponseRepository = {
      updateOne: jest.fn().mockResolvedValue({}),
    };
    const threadRepository = {
      findOneBy: jest.fn(),
    };
    const projectService = {
      getProjectById: jest.fn().mockResolvedValue({
        id: 42,
        language: 'EN',
      }),
    };
    const deployService = {
      getDeploymentByRuntimeIdentity: jest
        .fn()
        .mockResolvedValue({ projectId: 42, manifest: { models: [] } }),
    };
    const queryService = {
      preview: jest.fn().mockResolvedValue({ data: [] }),
    };
    const knowledgeBaseRepository = {
      findOneBy: jest.fn().mockResolvedValue({
        id: 'kb-1',
        language: 'ZH_TW',
      }),
    };

    const tracker = new TextBasedAnswerBackgroundTracker({
      wrenAIAdaptor: wrenAIAdaptor as any,
      threadResponseRepository: threadResponseRepository as any,
      threadRepository: threadRepository as any,
      projectService: projectService as any,
      deployService: deployService as any,
      queryService: queryService as any,
      knowledgeBaseRepository: knowledgeBaseRepository as any,
    });

    tracker.addTask({
      id: 9,
      threadId: 5,
      projectId: 42,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      actorUserId: 'user-1',
      question: 'summarize it',
      sql: 'select * from orders',
      answerDetail: {
        status: ThreadResponseAnswerStatus.NOT_STARTED,
      },
    } as any);

    if (!intervalHandler) {
      throw new Error('Interval handler was not registered');
    }
    await intervalHandler();
    await flushBackgroundJobs();

    expect(knowledgeBaseRepository.findOneBy).toHaveBeenCalledWith({
      id: 'kb-1',
    });
    expect(wrenAIAdaptor.createTextBasedAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        configurations: {
          language: 'Traditional Chinese',
        },
      }),
    );
  });

  it('recovers persisted streaming answers and finalizes content without rerunning SQL answer generation', async () => {
    let intervalHandler: (() => Promise<void>) | undefined;
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    setIntervalSpy.mockImplementation(((handler: TimerHandler) => {
      intervalHandler = handler as () => Promise<void>;
      return 1 as any;
    }) as any);

    const wrenAIAdaptor = {
      createTextBasedAnswer: jest.fn(),
      getTextBasedAnswerResult: jest.fn().mockResolvedValue({
        status: TextBasedAnswerStatus.SUCCEEDED,
        numRowsUsedInLLM: 8,
        content: 'recovered answer',
      }),
    };
    const threadResponseRepository = {
      updateOne: jest.fn().mockResolvedValue({}),
    };
    const tracker = new TextBasedAnswerBackgroundTracker({
      wrenAIAdaptor: wrenAIAdaptor as any,
      threadResponseRepository: threadResponseRepository as any,
      threadRepository: { findOneBy: jest.fn() } as any,
      projectService: { getProjectById: jest.fn() } as any,
      deployService: { getDeploymentByRuntimeIdentity: jest.fn() } as any,
      queryService: { preview: jest.fn() } as any,
    });

    tracker.addTask({
      id: 17,
      threadId: 5,
      projectId: 42,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      actorUserId: 'user-1',
      question: 'summarize it',
      sql: 'select * from orders',
      answerDetail: {
        status: ThreadResponseAnswerStatus.STREAMING,
        queryId: 'text-stream-1',
        numRowsUsedInLLM: 8,
      },
    } as any);

    if (!intervalHandler) {
      throw new Error('Interval handler was not registered');
    }
    await intervalHandler();
    await flushBackgroundJobs();

    expect(wrenAIAdaptor.createTextBasedAnswer).not.toHaveBeenCalled();
    expect(wrenAIAdaptor.getTextBasedAnswerResult).toHaveBeenCalledWith(
      'text-stream-1',
    );
    expect(threadResponseRepository.updateOne).toHaveBeenCalledWith(17, {
      answerDetail: {
        status: ThreadResponseAnswerStatus.FINISHED,
        queryId: 'text-stream-1',
        numRowsUsedInLLM: 8,
        content: 'recovered answer',
      },
    });
  });

  it('retries transient upstream resets while finalizing persisted streaming answers', async () => {
    let intervalHandler: (() => Promise<void>) | undefined;
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    setIntervalSpy.mockImplementation(((handler: TimerHandler) => {
      intervalHandler = handler as () => Promise<void>;
      return 1 as any;
    }) as any);

    const wrenAIAdaptor = {
      createTextBasedAnswer: jest.fn(),
      getTextBasedAnswerResult: jest
        .fn()
        .mockRejectedValueOnce(new Error('read ECONNRESET'))
        .mockResolvedValueOnce({
          status: TextBasedAnswerStatus.SUCCEEDED,
          numRowsUsedInLLM: 8,
          content: 'recovered after retry',
        }),
    };
    const threadResponseRepository = {
      updateOne: jest.fn().mockResolvedValue({}),
    };
    const tracker = new TextBasedAnswerBackgroundTracker({
      wrenAIAdaptor: wrenAIAdaptor as any,
      threadResponseRepository: threadResponseRepository as any,
      threadRepository: {
        findOneBy: jest.fn().mockResolvedValue({
          id: 5,
          projectId: 42,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-thread',
          actorUserId: 'user-1',
        }),
      } as any,
      projectService: {
        getProjectById: jest.fn().mockResolvedValue({
          id: 42,
          language: 'EN',
        }),
      } as any,
      deployService: {
        getDeploymentByRuntimeIdentity: jest
          .fn()
          .mockResolvedValue({ projectId: 42, manifest: { models: [] } }),
      } as any,
      queryService: { preview: jest.fn() } as any,
    });

    tracker.addTask({
      id: 18,
      threadId: 5,
      projectId: 42,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      actorUserId: 'user-1',
      question: 'summarize it',
      sql: 'select * from orders',
      answerDetail: {
        status: ThreadResponseAnswerStatus.STREAMING,
        queryId: 'text-stream-retry',
        numRowsUsedInLLM: 8,
      },
    } as any);

    if (!intervalHandler) {
      throw new Error('Interval handler was not registered');
    }
    await intervalHandler();
    await new Promise((resolve) => setTimeout(resolve, 400));
    await flushBackgroundJobs();

    expect(wrenAIAdaptor.createTextBasedAnswer).not.toHaveBeenCalled();
    expect(wrenAIAdaptor.getTextBasedAnswerResult).toHaveBeenCalledTimes(2);
    expect(threadResponseRepository.updateOne).toHaveBeenCalledWith(18, {
      answerDetail: {
        status: ThreadResponseAnswerStatus.FINISHED,
        queryId: 'text-stream-retry',
        numRowsUsedInLLM: 8,
        content: 'recovered after retry',
      },
    });
  });

  it('resumes persisted preprocessing answers from the existing query id without recreating answer jobs', async () => {
    let intervalHandler: (() => Promise<void>) | undefined;
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    setIntervalSpy.mockImplementation(((handler: TimerHandler) => {
      intervalHandler = handler as () => Promise<void>;
      return 1 as any;
    }) as any);

    const wrenAIAdaptor = {
      createTextBasedAnswer: jest.fn(),
      getTextBasedAnswerResult: jest
        .fn()
        .mockResolvedValueOnce({
          status: TextBasedAnswerStatus.PREPROCESSING,
          instructionCount: 2,
        })
        .mockResolvedValueOnce({
          status: TextBasedAnswerStatus.SUCCEEDED,
          instructionCount: 2,
          numRowsUsedInLLM: 6,
        })
        .mockResolvedValueOnce({
          status: TextBasedAnswerStatus.SUCCEEDED,
          instructionCount: 2,
          numRowsUsedInLLM: 6,
          content: 'resumed answer',
        }),
    };
    const threadResponseRepository = {
      updateOne: jest.fn().mockResolvedValue({}),
    };
    const tracker = new TextBasedAnswerBackgroundTracker({
      wrenAIAdaptor: wrenAIAdaptor as any,
      threadResponseRepository: threadResponseRepository as any,
      threadRepository: {
        findOneBy: jest.fn().mockResolvedValue({
          id: 5,
          projectId: 42,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-thread',
          actorUserId: 'user-1',
        }),
      } as any,
      projectService: {
        getProjectById: jest.fn().mockResolvedValue({
          id: 42,
          language: 'EN',
        }),
      } as any,
      deployService: {
        getDeploymentByRuntimeIdentity: jest
          .fn()
          .mockResolvedValue({ projectId: 42, manifest: { models: [] } }),
      } as any,
      queryService: { preview: jest.fn() } as any,
    });

    tracker.addTask({
      id: 19,
      threadId: 5,
      projectId: 42,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      actorUserId: 'user-1',
      question: 'summarize it',
      sql: 'select * from orders',
      answerDetail: {
        status: ThreadResponseAnswerStatus.PREPROCESSING,
        queryId: 'text-pre-1',
        instructionCount: 2,
      },
    } as any);

    if (!intervalHandler) {
      throw new Error('Interval handler was not registered');
    }
    await intervalHandler();
    await new Promise((resolve) => setTimeout(resolve, 600));
    await flushBackgroundJobs();

    expect(wrenAIAdaptor.createTextBasedAnswer).not.toHaveBeenCalled();
    expect(threadResponseRepository.updateOne).toHaveBeenNthCalledWith(1, 19, {
      answerDetail: {
        status: ThreadResponseAnswerStatus.STREAMING,
        queryId: 'text-pre-1',
        instructionCount: 2,
        numRowsUsedInLLM: 6,
        error: undefined,
      },
    });
    expect(threadResponseRepository.updateOne).toHaveBeenNthCalledWith(2, 19, {
      answerDetail: {
        status: ThreadResponseAnswerStatus.FINISHED,
        queryId: 'text-pre-1',
        instructionCount: 2,
        numRowsUsedInLLM: 6,
        error: undefined,
        content: 'resumed answer',
      },
    });
  });

  it('marks malformed historical answer tasks as failed when SQL is missing', async () => {
    let intervalHandler: (() => Promise<void>) | undefined;
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    setIntervalSpy.mockImplementation(((handler: TimerHandler) => {
      intervalHandler = handler as () => Promise<void>;
      return 1 as any;
    }) as any);

    const wrenAIAdaptor = {
      createTextBasedAnswer: jest.fn(),
      getTextBasedAnswerResult: jest.fn(),
    };
    const threadResponseRepository = {
      updateOne: jest.fn().mockResolvedValue({}),
    };
    const tracker = new TextBasedAnswerBackgroundTracker({
      wrenAIAdaptor: wrenAIAdaptor as any,
      threadResponseRepository: threadResponseRepository as any,
      threadRepository: {
        findOneBy: jest.fn().mockResolvedValue({
          id: 5,
          projectId: 42,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-thread',
          actorUserId: 'user-1',
        }),
      } as any,
      projectService: {
        getProjectById: jest.fn().mockResolvedValue({
          id: 42,
          language: 'EN',
        }),
      } as any,
      deployService: {
        getDeploymentByRuntimeIdentity: jest
          .fn()
          .mockResolvedValue({ projectId: 42, manifest: { models: [] } }),
      } as any,
      queryService: { preview: jest.fn() } as any,
    });

    tracker.addTask({
      id: 52,
      threadId: 5,
      projectId: 42,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-thread',
      actorUserId: 'user-1',
      question: 'summarize it',
      sql: null,
      answerDetail: {
        status: ThreadResponseAnswerStatus.FETCHING_DATA,
      },
    } as any);

    if (!intervalHandler) {
      throw new Error('Interval handler was not registered');
    }
    await intervalHandler();
    await flushBackgroundJobs();

    expect(wrenAIAdaptor.createTextBasedAnswer).not.toHaveBeenCalled();
    expect(threadResponseRepository.updateOne).toHaveBeenNthCalledWith(1, 52, {
      answerDetail: {
        status: ThreadResponseAnswerStatus.FETCHING_DATA,
      },
    });
    expect(threadResponseRepository.updateOne).toHaveBeenNthCalledWith(2, 52, {
      answerDetail: {
        status: ThreadResponseAnswerStatus.FAILED,
        error: expect.objectContaining({
          code: TEXT_TO_SQL_SQL_MISSING_ERROR_CODE,
          message: TEXT_TO_SQL_SQL_MISSING_USER_MESSAGE,
        }),
      },
    });
    expect(tracker.getTasks()).toEqual({});
  });

  it('uses dialect preview mode for anchored template SQL before generating text answers', async () => {
    let intervalHandler: (() => Promise<void>) | undefined;
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    setIntervalSpy.mockImplementation(((handler: TimerHandler) => {
      intervalHandler = handler as () => Promise<void>;
      return 1 as any;
    }) as any);

    const wrenAIAdaptor = {
      createTextBasedAnswer: jest.fn().mockResolvedValue({ queryId: 'text-4' }),
      getTextBasedAnswerResult: jest.fn().mockResolvedValue({
        status: TextBasedAnswerStatus.SUCCEEDED,
        numRowsUsedInLLM: 10,
        content: 'hello',
      }),
    };
    const threadResponseRepository = {
      updateOne: jest.fn().mockResolvedValue({}),
    };
    const threadRepository = {
      findOneBy: jest.fn(),
    };
    const projectService = {
      getProjectById: jest.fn().mockResolvedValue({
        id: 42,
        language: 'EN',
      }),
    };
    const deployService = {
      getDeploymentByRuntimeIdentity: jest
        .fn()
        .mockResolvedValue({ projectId: 42, manifest: { models: [] } }),
    };
    const askingTaskRepository = {
      findOneBy: jest.fn().mockResolvedValue({
        id: 9,
        detail: {
          templateDecision: {
            mode: 'anchored_template',
            sqlSource: 'anchored_template',
            missingParameters: [],
          },
        },
      }),
    };
    const queryService = {
      preview: jest.fn().mockResolvedValue({ data: [], columns: [] }),
    };

    const tracker = new TextBasedAnswerBackgroundTracker({
      wrenAIAdaptor: wrenAIAdaptor as any,
      threadResponseRepository: threadResponseRepository as any,
      threadRepository: threadRepository as any,
      projectService: projectService as any,
      deployService: deployService as any,
      queryService: queryService as any,
      askingTaskRepository: askingTaskRepository as any,
    });

    tracker.addTask({
      id: 27,
      threadId: 5,
      projectId: 42,
      deployHash: 'deploy-1',
      askingTaskId: 9,
      question: 'summarize it',
      sql: 'SELECT * FROM raw_template_sql',
      answerDetail: {
        status: ThreadResponseAnswerStatus.NOT_STARTED,
      },
    } as any);

    if (!intervalHandler) {
      throw new Error('Interval handler was not registered');
    }
    await intervalHandler();
    await flushBackgroundJobs();

    expect(queryService.preview).toHaveBeenCalledWith(
      'SELECT * FROM raw_template_sql',
      expect.objectContaining({
        sqlMode: 'dialect',
        limit: 500,
      }),
    );
  });
});

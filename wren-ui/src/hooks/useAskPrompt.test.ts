import {
  buildRecommendedQuestionHistory,
  canFetchThreadResponse,
  canGenerateAnswer,
  isReadyToThreadResponse,
} from './useAskPrompt';
import {
  handleUpdateRerunAskingTaskCache,
  handleUpdateThreadCache,
  resolvePendingClarificationSubmitDefaults,
} from './askPromptUtils';
import {
  AskingTask,
  AskingTaskStatus,
  AskingTaskType,
  ThreadResponseAnswerStatus,
} from '@/types/home';

describe('useAskPrompt helpers', () => {
  it('only triggers text answer generation for finished text-to-sql tasks', () => {
    expect(
      canGenerateAnswer(
        {
          status: AskingTaskStatus.FINISHED,
          type: AskingTaskType.TEXT_TO_SQL,
        } as AskingTask,
        null,
      ),
    ).toBe(true);
  });

  it('treats searching text-to-sql tasks as ready thread responses', () => {
    expect(
      isReadyToThreadResponse({
        status: AskingTaskStatus.SEARCHING,
        type: AskingTaskType.TEXT_TO_SQL,
      } as AskingTask),
    ).toBe(true);
  });

  it('continues thread-response polling until the task fails or stops', () => {
    expect(
      canFetchThreadResponse({
        status: AskingTaskStatus.FINISHED,
        type: AskingTaskType.TEXT_TO_SQL,
      } as AskingTask),
    ).toBe(true);
  });

  it('builds recommendation history with de-duplication and latest context', () => {
    expect(
      buildRecommendedQuestionHistory(
        ['问题1', '问题2', '问题2', '问题3'],
        '当前问题',
      ),
    ).toEqual(['问题1', '问题2', '问题3', '当前问题']);

    expect(buildRecommendedQuestionHistory([], '')).toEqual([]);
  });

  it('hydrates finished general answers into the cached thread response', () => {
    let nextState: any = null;

    handleUpdateThreadCache(
      {
        queryId: 'task-general-1',
        status: AskingTaskStatus.FINISHED,
        type: AskingTaskType.GENERAL,
        candidates: [],
        intentReasoning:
          '问题依赖当前知识库中缺失的外部指标：投放金额。在用户补充这些指标前，不能直接编造结果。',
      } as AskingTask,
      (updater) => {
        nextState = updater({
          thread: {
            responses: [
              {
                id: 101,
                question: 'ROI',
                askingTask: {
                  queryId: 'task-general-1',
                  status: AskingTaskStatus.SEARCHING,
                  type: AskingTaskType.GENERAL,
                },
                answerDetail: null,
              },
            ],
          },
        } as any);
      },
    );

    expect(nextState.thread.responses[0].answerDetail).toEqual({
      status: ThreadResponseAnswerStatus.FINISHED,
      content:
        '问题依赖当前知识库中缺失的外部指标：投放金额。在用户补充这些指标前，不能直接编造结果。',
    });
  });

  it('hydrates generated SQL into the cached thread response when text-to-sql finishes', () => {
    let nextState: any = null;

    handleUpdateThreadCache(
      {
        queryId: 'task-sql-1',
        status: AskingTaskStatus.FINISHED,
        type: AskingTaskType.TEXT_TO_SQL,
        candidates: [
          {
            type: 'LLM',
            sql: 'SELECT 1 AS value',
          },
        ],
      } as AskingTask,
      (updater) => {
        nextState = updater({
          thread: {
            responses: [
              {
                id: 102,
                question: '查询指标',
                askingTask: {
                  queryId: 'task-sql-1',
                  status: AskingTaskStatus.SEARCHING,
                  type: AskingTaskType.TEXT_TO_SQL,
                },
                answerDetail: null,
                sql: null,
              },
            ],
          },
        } as any);
      },
    );

    expect(nextState.thread.responses[0].sql).toBe('SELECT 1 AS value');
    expect(nextState.thread.responses[0].answerDetail).toBeNull();
  });

  it('clears stale SQL failure while rerunning a text-to-sql response', () => {
    let nextState: any = null;

    handleUpdateRerunAskingTaskCache({
      threadResponseId: 103,
      askingTask: {
        queryId: 'task-sql-rerun-1',
        status: AskingTaskStatus.UNDERSTANDING,
        type: AskingTaskType.TEXT_TO_SQL,
        candidates: [],
      } as AskingTask,
      updateThreadQuery: (updater) => {
        nextState = updater({
          thread: {
            responses: [
              {
                id: 103,
                question: '查询指标',
                askingTask: {
                  queryId: 'task-sql-old',
                  status: AskingTaskStatus.FAILED,
                  type: AskingTaskType.TEXT_TO_SQL,
                },
                answerDetail: {
                  status: ThreadResponseAnswerStatus.FAILED,
                  error: {
                    code: 'TEXT_TO_SQL_SQL_MISSING',
                    message: 'SQL 生成失败，未能生成可执行查询。',
                  },
                },
                sql: null,
              },
            ],
          },
        } as any);
      },
    });

    expect(nextState.thread.responses[0].askingTask).toEqual(
      expect.objectContaining({
        queryId: 'task-sql-rerun-1',
        status: AskingTaskStatus.SEARCHING,
        type: AskingTaskType.TEXT_TO_SQL,
      }),
    );
    expect(nextState.thread.responses[0].answerDetail).toBeNull();
  });

  it('hydrates failed text-to-sql reruns without SQL into SQL failure state', () => {
    let nextState: any = null;

    handleUpdateThreadCache(
      {
        queryId: 'task-sql-rerun-2',
        status: AskingTaskStatus.FAILED,
        type: AskingTaskType.TEXT_TO_SQL,
        candidates: [],
      } as AskingTask,
      (updater) => {
        nextState = updater({
          thread: {
            responses: [
              {
                id: 104,
                question: '查询指标',
                askingTask: {
                  queryId: 'task-sql-rerun-2',
                  status: AskingTaskStatus.SEARCHING,
                  type: AskingTaskType.TEXT_TO_SQL,
                },
                answerDetail: null,
                sql: null,
              },
            ],
          },
        } as any);
      },
    );

    expect(nextState.thread.responses[0].answerDetail).toEqual({
      status: ThreadResponseAnswerStatus.FAILED,
      error: {
        code: 'TEXT_TO_SQL_SQL_MISSING',
        message:
          'SQL 生成失败，未能生成可执行查询。请尝试重新生成，或调整问题描述。',
      },
    });
  });

  it('resolves the latest pending clarification session for follow-up submit', () => {
    expect(
      resolvePendingClarificationSubmitDefaults([
        {
          askingTask: {
            diagnostics: {
              clarificationState: {
                status: 'needs_clarification',
                clarificationSessionId: 'ask-old',
                pendingSlots: ['tenant_plat_id'],
              },
            },
          },
        } as any,
        {
          askingTask: {
            diagnostics: {
              clarificationState: {
                status: 'needs_clarification',
                clarificationSessionId: 'ask-latest',
                pendingSlots: ['tenant_plat_id'],
              },
            },
          },
        } as any,
      ]),
    ).toEqual({
      clarificationSessionId: 'ask-latest',
      clarificationState: {
        status: 'needs_clarification',
        clarificationSessionId: 'ask-latest',
        pendingSlots: ['tenant_plat_id'],
      },
      slotValues: null,
    });
  });

  it('carries resolved clarification slots into the next follow-up submit', () => {
    expect(
      resolvePendingClarificationSubmitDefaults([
        {
          askingTask: {
            diagnostics: {
              clarificationState: {
                status: 'needs_clarification',
                clarificationSessionId: 'ask-keep-slots',
                pendingSlots: ['period_days'],
                resolvedSlots: {
                  tenant_plat_id: '990001',
                  channel_id: '990011',
                },
              },
            },
          },
        } as any,
      ]),
    ).toEqual({
      clarificationSessionId: 'ask-keep-slots',
      clarificationState: {
        status: 'needs_clarification',
        clarificationSessionId: 'ask-keep-slots',
        pendingSlots: ['period_days'],
        resolvedSlots: {
          tenant_plat_id: '990001',
          channel_id: '990011',
        },
      },
      slotValues: {
        tenant_plat_id: '990001',
        channel_id: '990011',
      },
    });
  });

  it('does not reuse stale clarification when a later ask response exists', () => {
    expect(
      resolvePendingClarificationSubmitDefaults([
        {
          askingTask: {
            diagnostics: {
              clarificationState: {
                status: 'needs_clarification',
                clarificationSessionId: 'ask-old',
                pendingSlots: ['tenant_plat_id'],
              },
            },
          },
        } as any,
        {
          askingTask: {
            diagnostics: {
              semanticPlan: {
                decision: { route: 'normal_text_to_sql' },
              },
            },
          },
        } as any,
      ]),
    ).toEqual({});
  });
});

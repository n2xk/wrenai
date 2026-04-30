import {
  buildRecommendedQuestionHistory,
  canFetchThreadResponse,
  canGenerateAnswer,
  isReadyToThreadResponse,
} from './useAskPrompt';
import {
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

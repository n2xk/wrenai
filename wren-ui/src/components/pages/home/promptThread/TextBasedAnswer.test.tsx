import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TextBasedAnswer, {
  resolveTextAnswerErrorPresentation,
  shouldHideSqlGenerationErrorDuringRerun,
} from './TextBasedAnswer';
import {
  AskingTaskStatus,
  AskingTaskType,
  ThreadResponseAnswerStatus,
} from '@/types/home';

const mockUseTextBasedAnswerStreamTask = jest.fn();
const mockOnGenerateTextBasedAnswer = jest.fn();
const mockOnReRunAskingTask = jest.fn();
const mockUseResponsePreviewData = jest.fn();

jest.mock('./store', () => ({
  usePromptThreadActionsStore: () => ({
    onGenerateTextBasedAnswer: mockOnGenerateTextBasedAnswer,
  }),
  usePromptThreadPreparationStore: () => ({
    preparation: {
      onReRunAskingTask: mockOnReRunAskingTask,
    },
  }),
}));

jest.mock('@/hooks/useTextBasedAnswerStreamTask', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseTextBasedAnswerStreamTask(...args),
}));

jest.mock('@/hooks/useResponsePreviewData', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseResponsePreviewData(...args),
}));

jest.mock('@/hooks/useRuntimeScopeNavigation', () => ({
  __esModule: true,
  default: () => ({
    selector: {
      workspaceId: 'ws-fallback',
      knowledgeBaseId: 'kb-fallback',
    },
  }),
}));

jest.mock('@/components/editor/MarkdownBlock', () => ({
  __esModule: true,
  default: () => null,
}));

describe('TextBasedAnswer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseTextBasedAnswerStreamTask.mockReturnValue([
      jest.fn(),
      { data: '', loading: false, onReset: jest.fn() },
    ]);
    mockUseResponsePreviewData.mockReturnValue({
      ensureLoaded: jest.fn(),
      data: null,
      called: false,
      loading: false,
    });
  });

  it('passes the persisted response runtime selector into the streaming hook', () => {
    renderToStaticMarkup(
      <TextBasedAnswer
        motion={false}
        mode="timeline"
        isLastThreadResponse={false}
        isOpeningQuestion={false}
        onInitPreviewDone={() => undefined}
        shouldAutoPreview={false}
        threadResponse={
          {
            id: 21,
            threadId: 9,
            question: '各岗位的平均薪资分别是多少？',
            workspaceId: 'ws-response',
            knowledgeBaseId: 'kb-response',
            kbSnapshotId: 'snap-response',
            deployHash: 'deploy-response',
            answerDetail: {
              status: ThreadResponseAnswerStatus.STREAMING,
              content: '',
            },
          } as any
        }
      />,
    );

    expect(mockUseTextBasedAnswerStreamTask).toHaveBeenCalledWith({
      workspaceId: 'ws-response',
      knowledgeBaseId: 'kb-response',
      kbSnapshotId: 'snap-response',
      deployHash: 'deploy-response',
    });
  });

  it('renders a friendly retry state for transient text answer failures', () => {
    const markup = renderToStaticMarkup(
      <TextBasedAnswer
        motion={false}
        mode="timeline"
        isLastThreadResponse={false}
        isOpeningQuestion={false}
        onInitPreviewDone={() => undefined}
        shouldAutoPreview={false}
        threadResponse={
          {
            id: 22,
            threadId: 9,
            question: '查询每日登录用户数',
            workspaceId: 'ws-response',
            knowledgeBaseId: 'kb-response',
            answerDetail: {
              status: ThreadResponseAnswerStatus.FAILED,
              error: {
                message: 'socket hang up',
              },
            },
          } as any
        }
      />,
    );

    expect(markup).toContain('文字解读生成失败');
    expect(markup).toContain('数据结果已生成');
    expect(markup).toContain('重新生成解读');
    expect(markup).not.toContain('socket hang up');
  });

  it('renders SQL generation failures as SQL failures instead of text answer failures', () => {
    const markup = renderToStaticMarkup(
      <TextBasedAnswer
        motion={false}
        mode="timeline"
        isLastThreadResponse={false}
        isOpeningQuestion={false}
        onInitPreviewDone={() => undefined}
        shouldAutoPreview={false}
        threadResponse={
          {
            id: 23,
            threadId: 9,
            question: '统计首存 cohort 累计收入',
            workspaceId: 'ws-response',
            knowledgeBaseId: 'kb-response',
            sql: null,
            answerDetail: {
              status: ThreadResponseAnswerStatus.FAILED,
              error: {
                code: 'TEXT_TO_SQL_SQL_MISSING',
                message:
                  'SQL 生成失败，未能生成可执行查询。请尝试重新生成，或调整问题描述。',
              },
            },
          } as any
        }
      />,
    );

    expect(markup).toContain('SQL 生成失败');
    expect(markup).toContain('重新生成 SQL');
    expect(markup).not.toContain('文字解读生成失败');
    expect(markup).not.toContain('重新生成解读');
  });

  it('hides stale SQL failure while the same response is rerunning text-to-sql', () => {
    const markup = renderToStaticMarkup(
      <TextBasedAnswer
        motion={false}
        mode="timeline"
        isLastThreadResponse={false}
        isOpeningQuestion={false}
        onInitPreviewDone={() => undefined}
        shouldAutoPreview={false}
        threadResponse={
          {
            id: 24,
            threadId: 9,
            question: '统计首存 cohort 累计收入',
            workspaceId: 'ws-response',
            knowledgeBaseId: 'kb-response',
            sql: null,
            askingTask: {
              status: AskingTaskStatus.SEARCHING,
              type: AskingTaskType.TEXT_TO_SQL,
              candidates: [],
            },
            answerDetail: {
              status: ThreadResponseAnswerStatus.FAILED,
              error: {
                code: 'TEXT_TO_SQL_SQL_MISSING',
                message:
                  'SQL 生成失败，未能生成可执行查询。请尝试重新生成，或调整问题描述。',
              },
            },
          } as any
        }
      />,
    );

    expect(markup).not.toContain('SQL 生成失败');
    expect(markup).not.toContain('重新生成 SQL');
  });

  it('hides SQL failure immediately after clicking rerun before task polling updates cache', () => {
    expect(
      shouldHideSqlGenerationErrorDuringRerun({
        askingTask: {
          status: AskingTaskStatus.FAILED,
          type: AskingTaskType.TEXT_TO_SQL,
          candidates: [],
        },
        regenerateFailureLoading: true,
        retryTarget: 'asking_task',
      }),
    ).toBe(true);
  });

  it('keeps non-transient text answer errors specific', () => {
    expect(
      resolveTextAnswerErrorPresentation({
        shortMessage: '回答生成失败',
        message: '模型返回为空',
      }),
    ).toEqual({
      actionLabel: '重新生成解读',
      actionTitle: '重新生成解读',
      message: '回答生成失败',
      retryTarget: 'text_answer',
      description: '模型返回为空',
    });
  });
});

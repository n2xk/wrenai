import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TextBasedAnswer, {
  resolveTextAnswerErrorPresentation,
} from './TextBasedAnswer';
import { ThreadResponseAnswerStatus } from '@/types/home';

const mockUseTextBasedAnswerStreamTask = jest.fn();
const mockOnGenerateTextBasedAnswer = jest.fn();
const mockUseResponsePreviewData = jest.fn();

jest.mock('./store', () => ({
  usePromptThreadActionsStore: () => ({
    onGenerateTextBasedAnswer: mockOnGenerateTextBasedAnswer,
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

  it('keeps non-transient text answer errors specific', () => {
    expect(
      resolveTextAnswerErrorPresentation({
        shortMessage: '回答生成失败',
        message: '模型返回为空',
      }),
    ).toEqual({
      message: '回答生成失败',
      description: '模型返回为空',
    });
  });
});

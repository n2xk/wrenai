import { resolveModelingAssistantTaskStatusPresentation } from './ModelingAssistantTaskStatusPanel';

describe('resolveModelingAssistantTaskStatusPresentation', () => {
  it('returns stable details for a finished observable task', () => {
    const presentation = resolveModelingAssistantTaskStatusPresentation({
      task: {
        id: 'task-1',
        status: 'FINISHED',
        traceId: 'trace-1',
      },
      resultCount: 6,
      resultLabel: '关联关系',
    });

    expect(presentation).toMatchObject({
      statusLabel: '已完成',
      statusTone: 'success',
      summary: '任务完成，已返回 6 条关联关系。',
    });
    expect(presentation.detailItems).toEqual([
      { label: '任务 ID', value: 'task-1' },
      { label: '任务状态', value: 'FINISHED' },
      { label: '关联关系', value: '6' },
      { label: 'Trace ID', value: 'trace-1' },
    ]);
  });

  it('keeps failed task error visible', () => {
    const presentation = resolveModelingAssistantTaskStatusPresentation({
      task: {
        id: 'task-2',
        status: 'FAILED',
        error: { message: 'AI service failed' },
      },
      resultLabel: '语义描述',
    });

    expect(presentation.statusLabel).toBe('失败');
    expect(presentation.statusTone).toBe('error');
    expect(presentation.summary).toBe('AI service failed');
  });
});

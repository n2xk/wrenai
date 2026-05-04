import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { message } from 'antd';
import { useThreadResponseMutationActions } from './useThreadResponseMutationActions';

const mockAdjustThreadResponseChart = jest.fn();
const mockCreateThreadResponse = jest.fn();
const mockTriggerThreadResponseAnswer = jest.fn();
const mockTriggerThreadResponseChart = jest.fn();
const mockUpdateThreadResponseSql = jest.fn();

jest.mock('antd', () => ({
  message: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

jest.mock('@/utils/threadRest', () => ({
  adjustThreadResponseChart: (...args: any[]) =>
    mockAdjustThreadResponseChart(...args),
  createThreadResponse: (...args: any[]) => mockCreateThreadResponse(...args),
  triggerThreadResponseAnswer: (...args: any[]) =>
    mockTriggerThreadResponseAnswer(...args),
  triggerThreadResponseChart: (...args: any[]) =>
    mockTriggerThreadResponseChart(...args),
  updateThreadResponseSql: (...args: any[]) =>
    mockUpdateThreadResponseSql(...args),
}));

describe('useThreadResponseMutationActions', () => {
  const mockMessageError = message.error as jest.Mock;
  const mockMessageSuccess = message.success as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const renderHarness = (options?: {
    currentResponses?: Array<any>;
    currentThreadId?: number | null;
  }) => {
    let current: ReturnType<typeof useThreadResponseMutationActions> | null =
      null;

    const runtimeScopeSelector = {
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
    };
    const startThreadResponsePolling = jest.fn();
    const upsertThreadResponse = jest.fn();
    const onSelectResponse = jest.fn();

    const Harness = () => {
      current = useThreadResponseMutationActions({
        currentResponses: options?.currentResponses || [],
        currentThreadId: options?.currentThreadId,
        onSelectResponse,
        runtimeScopeSelector,
        startThreadResponsePolling,
        upsertThreadResponse,
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    if (!current) {
      throw new Error('Failed to initialize useThreadResponseMutationActions');
    }

    return {
      hook: current as ReturnType<typeof useThreadResponseMutationActions>,
      runtimeScopeSelector,
      startThreadResponsePolling,
      upsertThreadResponse,
      onSelectResponse,
    };
  };

  it('generates an answer and starts polling', async () => {
    mockTriggerThreadResponseAnswer.mockResolvedValue({
      id: 9,
      question: '继续分析',
    });
    const {
      hook,
      runtimeScopeSelector,
      startThreadResponsePolling,
      upsertThreadResponse,
    } = renderHarness();

    await hook.onGenerateThreadResponseAnswer(9);

    expect(mockTriggerThreadResponseAnswer).toHaveBeenCalledWith(
      runtimeScopeSelector,
      9,
    );
    expect(upsertThreadResponse).toHaveBeenCalledWith(
      expect.objectContaining({ id: 9 }),
    );
    expect(startThreadResponsePolling).toHaveBeenCalledWith(9);
  });

  it('uses the persisted response runtime selector when mutating an existing response', async () => {
    mockTriggerThreadResponseAnswer.mockResolvedValue({
      id: 9,
      question: '继续分析',
    });
    const { hook } = renderHarness({
      currentResponses: [
        {
          id: 9,
          question: '继续分析',
          workspaceId: 'ws-2',
          knowledgeBaseId: 'kb-2',
          kbSnapshotId: 'snap-2',
          deployHash: 'deploy-2',
        },
      ],
    });

    await hook.onGenerateThreadResponseAnswer(9);

    expect(mockTriggerThreadResponseAnswer).toHaveBeenCalledWith(
      {
        workspaceId: 'ws-2',
        knowledgeBaseId: 'kb-2',
        kbSnapshotId: 'snap-2',
        deployHash: 'deploy-2',
      },
      9,
    );
  });

  it('adjusts a chart and upserts the response', async () => {
    mockAdjustThreadResponseChart.mockResolvedValue({
      id: 12,
      question: '图表',
    });
    const { hook, runtimeScopeSelector, upsertThreadResponse } =
      renderHarness();

    await hook.onAdjustThreadResponseChart(12, {
      chartSchema: { mark: 'bar' },
    } as any);

    expect(mockAdjustThreadResponseChart).toHaveBeenCalledWith(
      runtimeScopeSelector,
      12,
      expect.objectContaining({
        chartSchema: { mark: 'bar' },
      }),
    );
    expect(upsertThreadResponse).toHaveBeenCalledWith(
      expect.objectContaining({ id: 12 }),
    );
  });

  it('updates SQL, reports success, and regenerates the answer', async () => {
    mockUpdateThreadResponseSql.mockResolvedValue({
      id: 15,
      question: 'SQL 修正',
    });
    mockTriggerThreadResponseAnswer.mockResolvedValue({
      id: 15,
      question: 'SQL 修正',
    });
    const {
      hook,
      runtimeScopeSelector,
      startThreadResponsePolling,
      upsertThreadResponse,
    } = renderHarness();

    await hook.onFixSQLStatement(15, 'select 1');

    expect(mockUpdateThreadResponseSql).toHaveBeenCalledWith(
      runtimeScopeSelector,
      15,
      { sql: 'select 1' },
    );
    expect(mockMessageSuccess).toHaveBeenCalledWith('SQL 语句已更新。');
    expect(mockTriggerThreadResponseAnswer).toHaveBeenCalledWith(
      runtimeScopeSelector,
      15,
    );
    expect(upsertThreadResponse).toHaveBeenCalled();
    expect(startThreadResponsePolling).toHaveBeenCalledWith(15);
  });

  it('shows error feedback when chart generation fails', async () => {
    mockTriggerThreadResponseChart.mockRejectedValue(new Error('boom'));
    const { hook } = renderHarness({
      currentResponses: [{ id: 30, question: '图表', sql: 'select 1' }],
      currentThreadId: 10,
    });

    await hook.onGenerateThreadResponseChart(30);

    expect(mockMessageError).toHaveBeenCalledWith('生成图表失败，请稍后重试');
  });

  it('creates a chart follow-up response when generating from a normal answer', async () => {
    mockCreateThreadResponse.mockResolvedValue({
      id: 31,
      question: '生成图表',
      responseKind: 'CHART_FOLLOWUP',
      sourceResponseId: 30,
      sql: 'select 1',
    });
    mockTriggerThreadResponseChart.mockResolvedValue({
      id: 31,
      question: '生成图表',
      responseKind: 'CHART_FOLLOWUP',
      sourceResponseId: 30,
      sql: 'select 1',
      chartDetail: {
        status: 'GENERATING',
      },
    });

    const {
      hook,
      onSelectResponse,
      runtimeScopeSelector,
      startThreadResponsePolling,
      upsertThreadResponse,
    } = renderHarness({
      currentResponses: [{ id: 30, question: '原始回答', sql: 'select 1' }],
      currentThreadId: 19,
    });

    await hook.onGenerateThreadResponseChart(30, {
      question: '生成一张图表给我',
      sourceResponseId: 30,
    });

    expect(mockCreateThreadResponse).toHaveBeenCalledWith(
      runtimeScopeSelector,
      19,
      expect.objectContaining({
        question: '生成一张图表给我',
        responseKind: 'CHART_FOLLOWUP',
        sourceResponseId: 30,
      }),
    );
    expect(onSelectResponse).toHaveBeenCalledWith(
      31,
      expect.objectContaining({
        artifact: 'chart',
        openWorkbench: false,
      }),
    );
    expect(upsertThreadResponse).toHaveBeenCalledWith(
      expect.objectContaining({ id: 31 }),
    );
    expect(mockTriggerThreadResponseChart).toHaveBeenCalledWith(
      runtimeScopeSelector,
      31,
      { customInstruction: '生成一张图表给我' },
    );
    expect(startThreadResponsePolling).toHaveBeenCalledWith(31);
  });

  it('blocks chart generation before creating a follow-up when the answer result is empty', async () => {
    const { hook } = renderHarness({
      currentResponses: [
        {
          id: 30,
          question: '原始回答',
          sql: 'select * from orders where 1 = 0',
          answerDetail: {
            status: 'FINISHED',
            numRowsUsedInLLM: 0,
          },
        },
      ],
      currentThreadId: 19,
    });

    await hook.onGenerateThreadResponseChart(30, {
      question: '生成一张图表给我',
      sourceResponseId: 30,
    });

    expect(mockCreateThreadResponse).not.toHaveBeenCalled();
    expect(mockTriggerThreadResponseChart).not.toHaveBeenCalled();
    expect(mockMessageError).toHaveBeenCalledWith(
      '当前查询结果为空，暂时无法生成图表。',
    );
  });

  it('does not retry chartability-blocked chart follow-up responses', async () => {
    const { hook } = renderHarness({
      currentResponses: [
        {
          id: 31,
          question: '生成图表',
          responseKind: 'CHART_FOLLOWUP',
          sourceResponseId: 30,
          sql: 'select * from orders where 1 = 0',
          chartDetail: {
            status: 'FAILED',
            chartability: {
              chartable: false,
              reasonCode: 'EMPTY_RESULT_SET',
              message: '当前查询结果为空，暂时无法生成图表。',
            },
          },
        },
      ],
      currentThreadId: 19,
    });

    await hook.onGenerateThreadResponseChart(31);

    expect(mockTriggerThreadResponseChart).not.toHaveBeenCalled();
    expect(mockMessageError).toHaveBeenCalledWith(
      '当前查询结果为空，暂时无法生成图表。',
    );
  });

  it('clears stale chart validation failure while regenerating an existing chart follow-up', async () => {
    mockTriggerThreadResponseChart.mockResolvedValue({
      id: 31,
      question: '生成图表',
      responseKind: 'CHART_FOLLOWUP',
      sourceResponseId: 30,
      sql: 'select 1',
      chartDetail: {
        status: 'FETCHING',
      },
    });

    const { hook, upsertThreadResponse } = renderHarness({
      currentResponses: [
        { id: 30, question: '原始回答', sql: 'select 1' },
        {
          id: 31,
          question: '生成图表',
          responseKind: 'CHART_FOLLOWUP',
          sourceResponseId: 30,
          sql: 'select 1',
          chartDetail: {
            status: 'FAILED',
            error: { message: '图表校验失败' },
            validationErrors: ['图表校验失败'],
            fallbackUsed: true,
            thinking: {
              currentStepKey: 'chart.chart_validated',
              steps: [
                {
                  key: 'chart.chart_validated',
                  messageKey: 'chart.chart_validated',
                  status: 'failed',
                },
              ],
            },
          },
        },
      ],
      currentThreadId: 19,
    });

    await hook.onGenerateThreadResponseChart(30, {
      question: '生成一张图表给我',
      sourceResponseId: 30,
    });

    expect(upsertThreadResponse).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: 31,
        chartDetail: expect.objectContaining({
          status: 'GENERATING',
          error: null,
          fallbackUsed: false,
          thinking: null,
          validationErrors: [],
        }),
      }),
    );
    expect(mockTriggerThreadResponseChart).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1' }),
      31,
      { customInstruction: '生成一张图表给我' },
    );
  });

  it('passes chart refine prompts as custom chart generation instructions', async () => {
    mockTriggerThreadResponseChart.mockResolvedValue({
      id: 31,
      question: '生成图表',
      responseKind: 'CHART_FOLLOWUP',
      sourceResponseId: 30,
      sql: 'select 1',
      chartDetail: {
        status: 'FETCHING',
      },
    });

    const { hook, runtimeScopeSelector } = renderHarness({
      currentResponses: [
        {
          id: 31,
          question: '生成图表',
          responseKind: 'CHART_FOLLOWUP',
          sourceResponseId: 30,
          sql: 'select 1',
          chartDetail: {
            status: 'FINISHED',
            chartSchema: { mark: { type: 'line' } },
          },
        },
      ],
      currentThreadId: 19,
    });

    await hook.onGenerateThreadResponseChart(31, {
      question: '为折线图添加数据标签',
      sourceResponseId: 31,
    });

    expect(mockCreateThreadResponse).not.toHaveBeenCalled();
    expect(mockTriggerThreadResponseChart).toHaveBeenCalledWith(
      runtimeScopeSelector,
      31,
      { customInstruction: '为折线图添加数据标签' },
    );
  });
});

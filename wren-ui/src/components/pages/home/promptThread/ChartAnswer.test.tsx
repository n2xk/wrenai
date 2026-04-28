import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ChartAnswer from './ChartAnswer';

const mockCreateDashboardItem = jest.fn();
const mockUsePromptThreadActionsStore = jest.fn();
const mockEnsureLoaded = jest.fn();
const mockLoadDashboardListPayload = jest.fn();
const mockLoadDashboardDetailPayload = jest.fn();
const mockCreateDashboard = jest.fn();
const mockPushWorkspace = jest.fn();
const mockMessageSuccess = jest.fn();
const mockMessageError = jest.fn();
const mockMessageWarning = jest.fn();
let mockWatchedChartType: string | null = 'LINE';
let mockChartSpecOptionValues: { chartType: string | null } = {
  chartType: 'LINE',
};
let mockPreviewData: any = { data: [], columns: [] };
const capturedButtons: any[] = [];
let capturedChartProps: any = null;

let capturedPinModalProps: any = null;

jest.mock('next/dynamic', () => () => {
  const React = jest.requireActual('react');
  return (props: any) => {
    capturedChartProps = props;
    return React.createElement('div', null, props.onPin ? 'Chart' : 'NoChart');
  };
});

jest.mock('antd', () => {
  const React = jest.requireActual('react');
  const FormComponent = ({ children }: any) =>
    React.createElement('form', null, children);
  (FormComponent as any).useForm = () => [
    {
      setFieldsValue: jest.fn(),
      getFieldsValue: () => ({ chartType: mockWatchedChartType }),
      resetFields: jest.fn(),
    },
  ];
  (FormComponent as any).useWatch = () => mockWatchedChartType;

  return {
    Alert: ({ message, title, description }: any) =>
      React.createElement('div', null, message || title, description),
    Form: FormComponent,
    Button: ({ children, onClick, ...props }: any) => {
      capturedButtons.push({ children, onClick, ...props });
      return React.createElement('button', { onClick }, children);
    },
    Popover: ({ children, content }: any) =>
      React.createElement('div', null, children, content),
    Skeleton: ({ children }: any) => React.createElement('div', null, children),
    Input: Object.assign(
      ({ allowClear: _allowClear, ...props }: any) =>
        React.createElement('input', props),
      {
        Search: ({ allowClear: _allowClear, ...props }: any) =>
          React.createElement('input', props),
      },
    ),
    Modal: () => React.createElement('section'),
    message: {
      success: (...args: any[]) => mockMessageSuccess(...args),
      error: (...args: any[]) => mockMessageError(...args),
      warning: (...args: any[]) => mockMessageWarning(...args),
    },
  };
});

jest.mock('./ChartAnswerPinModal', () => ({
  __esModule: true,
  default: (props: any) => {
    capturedPinModalProps = props;
    const React = jest.requireActual('react');
    return React.createElement(
      'section',
      null,
      props.open ? 'PinModalOpen' : 'PinModalClosed',
    );
  },
}));

jest.mock('./ChartAnswerPinPopover', () => ({
  __esModule: true,
  default: () => {
    const React = jest.requireActual('react');
    return React.createElement('section', null, 'PinPopover');
  },
}));

jest.mock('@/components/chart/properties/BasicProperties', () => () => null);
jest.mock('@/components/chart/properties/DonutProperties', () => () => null);
jest.mock('@/components/chart/properties/LineProperties', () => () => null);
jest.mock(
  '@/components/chart/properties/StackedBarProperties',
  () => () => null,
);
jest.mock(
  '@/components/chart/properties/GroupedBarProperties',
  () => () => null,
);

jest.mock('@/components/chart/meta', () => ({
  getChartSpecFieldTitleMap: () => ({}),
  getChartSpecOptionValues: () => mockChartSpecOptionValues,
}));

jest.mock('@/hooks/useResponsePreviewData', () => ({
  __esModule: true,
  default: () => ({
    data: { previewData: mockPreviewData },
    loading: false,
    error: undefined,
    called: true,
    ensureLoaded: mockEnsureLoaded,
    refetch: jest.fn(),
  }),
}));

jest.mock('@/components/pages/home/promptThread/store', () => ({
  __esModule: true,
  usePromptThreadActionsStore: () => mockUsePromptThreadActionsStore(),
}));

jest.mock('@/utils/dashboardRest', () => ({
  createDashboard: (...args: any[]) => mockCreateDashboard(...args),
  loadDashboardDetailPayload: (...args: any[]) =>
    mockLoadDashboardDetailPayload(...args),
  loadDashboardListPayload: (...args: any[]) =>
    mockLoadDashboardListPayload(...args),
  resolveDashboardDisplayName: (name?: string | null) =>
    !name || name === 'Dashboard' ? '默认看板' : name,
}));

jest.mock('@/utils/homeRest', () => ({
  createDashboardItem: (...args: any[]) => mockCreateDashboardItem(...args),
}));

jest.mock('@/hooks/useRuntimeScopeNavigation', () => ({
  __esModule: true,
  default: () => ({
    selector: {
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'deploy-1',
    },
    workspaceSelector: { workspaceId: 'ws-1' },
    pushWorkspace: mockPushWorkspace,
  }),
}));

const setStateOverrides = (overrides: Partial<Record<number, any>>) => {
  let callIndex = 0;
  const spy = jest.spyOn(React, 'useState' as any) as jest.SpyInstance;
  return spy.mockImplementation(((initial: any) => {
    callIndex += 1;
    if (Object.prototype.hasOwnProperty.call(overrides, callIndex)) {
      return [overrides[callIndex], jest.fn()];
    }
    return [typeof initial === 'function' ? initial() : initial, jest.fn()];
  }) as any);
};

describe('ChartAnswer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedPinModalProps = null;
    capturedChartProps = null;
    capturedButtons.length = 0;
    mockWatchedChartType = 'LINE';
    mockChartSpecOptionValues = { chartType: 'LINE' };
    mockPreviewData = { data: [], columns: [] };
    mockEnsureLoaded.mockResolvedValue({
      previewData: { data: [], columns: [] },
    });
    mockUsePromptThreadActionsStore.mockReturnValue({
      onGenerateChartAnswer: jest.fn(),
      onAdjustChartAnswer: jest.fn(),
    });
    mockLoadDashboardListPayload.mockResolvedValue([
      { id: 11, name: '经营总览' },
      { id: 12, name: '销售看板' },
    ]);
    mockLoadDashboardDetailPayload.mockResolvedValue({
      id: 11,
      items: [],
    });
    mockCreateDashboard.mockResolvedValue({
      id: 13,
      name: '本周经营复盘',
      isDefault: false,
      cacheEnabled: false,
      scheduleFrequency: null,
    });
    mockCreateDashboardItem.mockResolvedValue({
      id: 901,
      dashboardId: 11,
    });
  });

  it('pins directly when there is only one dashboard', async () => {
    const useStateSpy = setStateOverrides({
      // 8th state: dashboardOptions
      8: [{ id: 11, name: '经营总览' }],
    });
    mockLoadDashboardListPayload.mockResolvedValueOnce([
      { id: 11, name: '经营总览' },
    ]);

    renderToStaticMarkup(
      React.createElement(ChartAnswer, {
        threadResponse: {
          id: 91,
          chartDetail: {
            status: 'FINISHED',
            description: '销售趋势',
            chartSchema: {
              mark: 'line',
              encoding: {
                x: { field: 'date', type: 'temporal' },
                y: { field: 'value', type: 'quantitative' },
              },
            },
          },
        },
      } as any),
    );

    await capturedChartProps.onPin();

    expect(mockCreateDashboardItem).toHaveBeenCalledWith(
      {
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
      },
      {
        itemType: 'LINE',
        responseId: 91,
        dashboardId: 11,
      },
    );
    expect(mockLoadDashboardDetailPayload).toHaveBeenCalledWith({
      dashboardId: 11,
      selector: { workspaceId: 'ws-1' },
      useCache: false,
    });

    useStateSpy.mockRestore();
  });

  it('submits createDashboardItem with selected dashboard id from the popover when multiple dashboards exist', async () => {
    const useStateSpy = setStateOverrides({
      // 5th state: isPinPopoverOpen
      5: true,
      // 8th state: dashboardOptions
      8: [
        { id: 11, name: '经营总览' },
        { id: 12, name: '销售看板' },
      ],
    });
    mockCreateDashboardItem.mockResolvedValueOnce({
      id: 901,
      dashboardId: 12,
    });

    renderToStaticMarkup(
      React.createElement(ChartAnswer, {
        threadResponse: {
          id: 91,
          chartDetail: {
            status: 'FINISHED',
            description: '销售趋势',
            chartSchema: {
              mark: 'line',
              encoding: {
                x: { field: 'date', type: 'temporal' },
                y: { field: 'value', type: 'quantitative' },
              },
            },
          },
        },
      } as any),
    );

    const popoverElement = capturedChartProps.pinPopoverContent;
    await popoverElement.props.onSelectDashboard(12, '销售看板');

    expect(mockCreateDashboardItem).toHaveBeenCalledWith(
      {
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
      },
      {
        itemType: 'LINE',
        responseId: 91,
        dashboardId: 12,
      },
    );
    expect(mockLoadDashboardDetailPayload).toHaveBeenCalledWith({
      dashboardId: 12,
      selector: { workspaceId: 'ws-1' },
      useCache: false,
    });

    useStateSpy.mockRestore();
  });

  it('pins with the persisted response runtime selector when the response scope differs from the page scope', async () => {
    const useStateSpy = setStateOverrides({
      8: [{ id: 11, name: '经营总览' }],
    });
    mockLoadDashboardListPayload.mockResolvedValueOnce([
      { id: 11, name: '经营总览' },
    ]);

    renderToStaticMarkup(
      React.createElement(ChartAnswer, {
        threadResponse: {
          id: 96,
          workspaceId: 'ws-9',
          knowledgeBaseId: 'kb-9',
          kbSnapshotId: 'snap-9',
          deployHash: 'deploy-9',
          chartDetail: {
            status: 'FINISHED',
            description: '销售趋势',
            chartSchema: {
              mark: 'line',
              encoding: {
                x: { field: 'date', type: 'temporal' },
                y: { field: 'value', type: 'quantitative' },
              },
            },
          },
        },
      } as any),
    );

    await capturedChartProps.onPin();

    expect(mockCreateDashboardItem).toHaveBeenCalledWith(
      {
        workspaceId: 'ws-9',
        knowledgeBaseId: 'kb-9',
        kbSnapshotId: 'snap-9',
        deployHash: 'deploy-9',
      },
      {
        itemType: 'LINE',
        responseId: 96,
        dashboardId: 11,
      },
    );

    useStateSpy.mockRestore();
  });

  it('pins multi-line charts as a supported dashboard item type', async () => {
    mockWatchedChartType = 'MULTI_LINE';
    mockChartSpecOptionValues = { chartType: 'MULTI_LINE' };
    const useStateSpy = setStateOverrides({
      8: [{ id: 11, name: '经营总览' }],
    });
    mockLoadDashboardListPayload.mockResolvedValueOnce([
      { id: 11, name: '经营总览' },
    ]);

    renderToStaticMarkup(
      React.createElement(ChartAnswer, {
        threadResponse: {
          id: 99,
          chartDetail: {
            status: 'FINISHED',
            description: '多指标趋势',
            chartType: 'MULTI_LINE',
            chartSchema: {
              mark: 'line',
              encoding: {
                x: { field: 'bet_times', type: 'temporal' },
                y: { field: 'Value', type: 'quantitative' },
                color: { field: 'Metric', type: 'nominal' },
              },
            },
          },
        },
      } as any),
    );

    await capturedChartProps.onPin();

    expect(mockCreateDashboardItem).toHaveBeenCalledWith(
      {
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
      },
      {
        itemType: 'MULTI_LINE',
        responseId: 99,
        dashboardId: 11,
      },
    );

    useStateSpy.mockRestore();
  });

  it('renders single-row numeric results as number cards and pins them as NUMBER items', async () => {
    mockWatchedChartType = null;
    mockChartSpecOptionValues = { chartType: null };
    mockPreviewData = {
      columns: [
        { name: 'bet_user_count', type: 'BIGINT' },
        { name: 'bet_order_count', type: 'BIGINT' },
        { name: 'total_valid_bet_amount', type: 'DECIMAL' },
      ],
      data: [[5, 13, '7300.00']],
    };
    const useStateSpy = setStateOverrides({
      8: [{ id: 11, name: '经营总览' }],
    });
    mockLoadDashboardListPayload.mockResolvedValueOnce([
      { id: 11, name: '经营总览' },
    ]);

    const markup = renderToStaticMarkup(
      React.createElement(ChartAnswer, {
        threadResponse: {
          id: 100,
          chartDetail: {
            status: 'FINISHED',
            chartType: 'NUMBER',
            description: '当前结果为单行汇总指标，已切换为指标卡展示。',
            chartability: {
              chartable: true,
              recommendedDisplay: 'NUMBER_CARD',
            },
            renderHints: {
              displayType: 'number_card',
            },
          },
        },
      } as any),
    );

    expect(markup).toContain('bet user count');
    expect(markup).toContain('7,300.00');
    expect(capturedChartProps).toBeNull();

    const pinButton = capturedButtons.find(
      (button) => button.children === '固定到看板',
    );
    await pinButton.onClick();

    expect(mockCreateDashboardItem).toHaveBeenCalledWith(
      {
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
      },
      {
        itemType: 'NUMBER',
        responseId: 100,
        dashboardId: 11,
      },
    );

    useStateSpy.mockRestore();
  });

  it('passes canonical renderer hints through to the chart component', () => {
    renderToStaticMarkup(
      React.createElement(ChartAnswer, {
        threadResponse: {
          id: 92,
          chartDetail: {
            status: 'FINISHED',
            description: '销售趋势',
            renderHints: {
              preferredRenderer: 'canvas',
            },
            chartSchema: {
              mark: 'line',
              encoding: {
                x: { field: 'date', type: 'temporal' },
                y: { field: 'value', type: 'quantitative' },
              },
            },
          },
        },
      } as any),
    );

    expect(capturedChartProps?.preferredRenderer).toBe('canvas');
  });

  it('surfaces chart fallback diagnostics when canonicalization repaired the chart', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ChartAnswer, {
        threadResponse: {
          id: 98,
          chartDetail: {
            status: 'FINISHED',
            description: '销售趋势',
            fallbackUsed: true,
            fallbackReason: 'Encoding channel y is missing type',
            canonicalizationVersion: 'chart-canonical-v1',
            diagnostics: {
              lastErrorCode: 'CHART_SCHEMA_REPAIRED',
              lastErrorMessage: 'Vega-Lite schema warning',
            },
            validationErrors: ['Encoding channel y is missing type'],
            chartSchema: {
              mark: 'line',
              encoding: {
                x: { field: 'date', type: 'temporal' },
                y: { field: 'value', type: 'quantitative' },
              },
            },
          },
        },
      } as any),
    );

    expect(markup).toContain('图表已自动修复/兜底');
    expect(markup).toContain('chart-canonical-v1');
    expect(markup).toContain('Vega-Lite schema warning');
  });

  it('uses the dashboard pin text button while exposing inline chart edit actions', () => {
    renderToStaticMarkup(
      React.createElement(ChartAnswer, {
        threadResponse: {
          id: 95,
          chartDetail: {
            status: 'FINISHED',
            description: '销售趋势',
            chartSchema: {
              mark: 'line',
              encoding: {
                x: { field: 'date', type: 'temporal' },
                y: { field: 'value', type: 'quantitative' },
              },
            },
          },
        },
      } as any),
    );

    expect(capturedChartProps?.pinButtonLabel).toBe('固定到看板');
    expect(capturedChartProps?.hideEditAction).toBeUndefined();
    expect(capturedChartProps?.hideReloadAction).toBe(true);
  });

  it('keeps the pin action visually available while the dashboard list is loading', () => {
    const useStateSpy = setStateOverrides({
      // 7th state: dashboardsLoading
      7: true,
      // 8th state: dashboardOptions
      8: [],
    });

    renderToStaticMarkup(
      React.createElement(ChartAnswer, {
        threadResponse: {
          id: 97,
          chartDetail: {
            status: 'FINISHED',
            description: '销售趋势',
            chartSchema: {
              mark: 'line',
              encoding: {
                x: { field: 'date', type: 'temporal' },
                y: { field: 'value', type: 'quantitative' },
              },
            },
          },
        },
      } as any),
    );

    expect(capturedChartProps?.pinDisabled).toBe(false);

    useStateSpy.mockRestore();
  });

  it('shows normalized default dashboard name in pin success message', async () => {
    const useStateSpy = setStateOverrides({
      // 8th state: dashboardOptions
      8: [{ id: 11, name: 'Dashboard' }],
    });
    mockLoadDashboardListPayload.mockResolvedValueOnce([
      { id: 11, name: 'Dashboard' },
    ]);

    renderToStaticMarkup(
      React.createElement(ChartAnswer, {
        threadResponse: {
          id: 93,
          chartDetail: {
            status: 'FINISHED',
            description: '销售趋势',
            chartSchema: {
              mark: 'line',
              encoding: {
                x: { field: 'date', type: 'temporal' },
                y: { field: 'value', type: 'quantitative' },
              },
            },
          },
        },
      } as any),
    );

    await capturedChartProps.onPin();

    expect(mockMessageSuccess).toHaveBeenCalledWith('已固定到看板「默认看板」');

    useStateSpy.mockRestore();
  });

  it('creates a dashboard before pinning when using create-and-pin action', async () => {
    const useStateSpy = setStateOverrides({
      6: true,
      8: [{ id: 11, name: '经营总览' }],
    });
    mockCreateDashboardItem.mockResolvedValueOnce({
      id: 902,
      dashboardId: 13,
    });

    renderToStaticMarkup(
      React.createElement(ChartAnswer, {
        threadResponse: {
          id: 94,
          chartDetail: {
            status: 'FINISHED',
            description: '销售趋势',
            chartSchema: {
              mark: 'line',
              encoding: {
                x: { field: 'date', type: 'temporal' },
                y: { field: 'value', type: 'quantitative' },
              },
            },
          },
        },
      } as any),
    );

    await capturedPinModalProps.onSubmit('本周经营复盘');

    expect(mockCreateDashboard).toHaveBeenCalledWith(
      { workspaceId: 'ws-1' },
      { name: '本周经营复盘' },
    );
    expect(mockCreateDashboardItem).toHaveBeenCalledWith(
      {
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
      },
      {
        itemType: 'LINE',
        responseId: 94,
        dashboardId: 13,
      },
    );
    expect(mockLoadDashboardDetailPayload).toHaveBeenCalledWith({
      dashboardId: 13,
      selector: { workspaceId: 'ws-1' },
      useCache: false,
    });

    useStateSpy.mockRestore();
  });
});

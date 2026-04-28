import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { DashboardGridPinnedItem } from './DashboardGridPinnedItem';

const capturedButtons: any[] = [];

jest.mock('next/dynamic', () => () => {
  const React = jest.requireActual('react');
  return function MockDynamicChart() {
    return React.createElement('div', null, 'chart');
  };
});

jest.mock('antd', () => {
  const React = jest.requireActual('react');
  return {
    Alert: ({ children }: any) => React.createElement('div', null, children),
    Button: (props: any) => {
      capturedButtons.push(props);
      return React.createElement('button', props, props.children);
    },
    Table: ({ columns = [], dataSource = [] }: any) =>
      React.createElement(
        'table',
        null,
        React.createElement(
          'thead',
          null,
          React.createElement(
            'tr',
            null,
            columns.map((column: any) =>
              React.createElement('th', { key: column.key }, column.title),
            ),
          ),
        ),
        React.createElement(
          'tbody',
          null,
          dataSource.map((row: any) =>
            React.createElement(
              'tr',
              { key: row.key },
              columns.map((column: any) =>
                React.createElement(
                  'td',
                  { key: column.key },
                  row[column.dataIndex],
                ),
              ),
            ),
          ),
        ),
      ),
  };
});

jest.mock('@/components/PageLoading', () => ({
  LoadingWrapper: ({ children }: any) => {
    const React = jest.requireActual('react');
    return React.createElement('div', null, children);
  },
}));

jest.mock('@/utils/antdAppBridge', () => ({
  appMessage: {
    error: jest.fn(),
  },
}));

jest.mock('@/components/diagram/CustomDropdown', () => ({
  DashboardItemDropdown: ({ children }: any) => {
    const React = jest.requireActual('react');
    return React.createElement('div', null, children);
  },
}));

jest.mock('./DashboardGridPinnedItemTitle', () => ({
  DashboardGridPinnedItemTitle: ({ title }: { title: string }) => {
    const React = jest.requireActual('react');
    return React.createElement('span', null, title);
  },
}));

const runtimeScopeSelector = {
  workspaceId: 'ws-1',
  knowledgeBaseId: 'kb-1',
  kbSnapshotId: 'snap-1',
  deployHash: 'deploy-1',
};

describe('DashboardGridPinnedItem', () => {
  beforeEach(() => {
    capturedButtons.length = 0;
  });

  it('stops drag propagation on source-thread button interactions and navigates on click', async () => {
    const onNavigateToThread = jest.fn().mockResolvedValue(undefined);

    renderToStaticMarkup(
      <DashboardGridPinnedItem
        item={{
          id: 1,
          dashboardId: 10,
          type: 'chart',
          displayName: '部门薪资图',
          layout: { x: 0, y: 0, w: 4, h: 3 },
          detail: {
            sql: 'select 1',
            chartSchema: { title: '部门薪资图' },
            sourceThreadId: 5,
            sourceResponseId: 20,
            validationErrors: [],
          },
        }}
        isSupportCached
        runtimeScopeSelector={runtimeScopeSelector}
        onDelete={jest.fn().mockResolvedValue(undefined)}
        onItemUpdated={jest.fn()}
        onNavigateToThread={onNavigateToThread}
      />,
    );

    const sourceThreadButton = capturedButtons.find(
      (props) => props.children === '来源线程',
    );

    expect(sourceThreadButton).toBeTruthy();

    const mouseDownEvent = { stopPropagation: jest.fn() };
    sourceThreadButton.onMouseDown(mouseDownEvent);
    expect(mouseDownEvent.stopPropagation).toHaveBeenCalledTimes(1);

    const touchStartEvent = { stopPropagation: jest.fn() };
    sourceThreadButton.onTouchStart(touchStartEvent);
    expect(touchStartEvent.stopPropagation).toHaveBeenCalledTimes(1);

    const clickEvent = { stopPropagation: jest.fn() };
    sourceThreadButton.onClick(clickEvent);

    expect(clickEvent.stopPropagation).toHaveBeenCalledTimes(1);
    expect(onNavigateToThread).toHaveBeenCalledWith(5, 20);
  });

  it('renders table dashboard items as data tables', () => {
    const markup = renderToStaticMarkup(
      <DashboardGridPinnedItem
        item={{
          id: 2,
          dashboardId: 10,
          type: 'TABLE',
          displayName: '渠道日报明细',
          layout: { x: 0, y: 0, w: 4, h: 3 },
          detail: {
            sql: 'select * from channel_daily',
            sourceQuestion: '查看渠道日报明细',
            validationErrors: [],
          },
        }}
        isSupportCached
        runtimeScopeSelector={runtimeScopeSelector}
        onDelete={jest.fn().mockResolvedValue(undefined)}
        onItemUpdated={jest.fn()}
        onNavigateToThread={jest.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(markup).toContain('渠道日报明细');
    expect(markup).toContain('<table>');
    expect(markup).not.toContain('chart');
  });

  it('renders number dashboard items as indicator cards instead of charts', () => {
    const markup = renderToStaticMarkup(
      <DashboardGridPinnedItem
        item={{
          id: 3,
          dashboardId: 10,
          type: 'NUMBER',
          displayName: '投注汇总指标',
          layout: { x: 0, y: 0, w: 3, h: 2 },
          detail: {
            sql: 'select count(*) as bet_user_count',
            renderHints: { displayType: 'number_card' },
            sourceQuestion: '统计投注汇总指标',
            validationErrors: [],
          },
        }}
        isSupportCached
        runtimeScopeSelector={runtimeScopeSelector}
        onDelete={jest.fn().mockResolvedValue(undefined)}
        onItemUpdated={jest.fn()}
        onNavigateToThread={jest.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(markup).toContain('投注汇总指标');
    expect(markup).toContain('暂无可展示的指标数据');
    expect(markup).not.toContain('chart');
  });
});

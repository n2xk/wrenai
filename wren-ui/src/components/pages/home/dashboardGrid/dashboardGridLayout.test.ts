import {
  DASHBOARD_GRID_ROW_HEIGHT,
  resolveDashboardGridItemMinHeight,
  resolveDashboardGridLayouts,
  resolveDashboardGridWidth,
} from './dashboardGridLayout';

describe('dashboard grid layout helpers', () => {
  it('uses the available container width directly instead of forcing a desktop minimum width', () => {
    expect(resolveDashboardGridWidth(712)).toBe(712);
    expect(resolveDashboardGridWidth(0)).toBe(0);
  });

  it('uses a fixed row height so resizing is not coupled to chart width', () => {
    expect(DASHBOARD_GRID_ROW_HEIGHT).toBe(108);
  });

  it('allows compact KPI cards while keeping charts and tables readable', () => {
    expect(
      resolveDashboardGridItemMinHeight({
        type: 'NUMBER',
      } as any),
    ).toBe(1);
    expect(
      resolveDashboardGridItemMinHeight({
        type: 'BAR',
      } as any),
    ).toBe(3);
    expect(
      resolveDashboardGridItemMinHeight({
        type: 'TABLE',
      } as any),
    ).toBe(3);
  });

  it('keeps pinned charts readable even when a stored layout is shorter', () => {
    expect(
      resolveDashboardGridLayouts([
        {
          id: 8,
          dashboardId: 75,
          type: 'BAR',
          displayName: '图表卡片 8',
          layout: { x: 0, y: 0, w: 3, h: 2 },
          detail: {
            sql: 'select 1',
          },
        } as any,
      ]),
    ).toEqual([
      {
        i: '8',
        x: 0,
        y: 0,
        w: 3,
        h: 3,
      },
    ]);
  });

  it('renders pinned chart cards at least three rows tall', () => {
    expect(
      resolveDashboardGridLayouts([
        {
          id: 9,
          dashboardId: 75,
          type: 'LINE',
          displayName: '图表卡片 9',
          layout: { x: 0, y: 0, w: 3, h: 1 },
          detail: {
            sql: 'select 1',
          },
        } as any,
      ]),
    ).toEqual([
      {
        i: '9',
        x: 0,
        y: 0,
        w: 3,
        h: 3,
      },
    ]);
  });
});

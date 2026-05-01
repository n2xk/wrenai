import {
  createDashboardServiceHarness,
  TestDashboardService,
} from './dashboardService.testSupport';

describe('DashboardService', () => {
  let dashboardService: TestDashboardService;
  let mockDashboardItemRepository: ReturnType<
    typeof createDashboardServiceHarness
  >['mockDashboardItemRepository'];

  beforeEach(() => {
    ({ dashboardService, mockDashboardItemRepository } =
      createDashboardServiceHarness());
  });

  it('returns existing dashboard item when the same source response is pinned twice', async () => {
    mockDashboardItemRepository.findByDashboardIdAndSourceResponseId.mockResolvedValue(
      {
        id: 88,
        dashboardId: 7,
        type: 'BAR',
        detail: {
          sql: 'select 1',
          sourceResponseId: 62,
        },
        layout: { x: 0, y: 0, w: 3, h: 4 },
      },
    );

    const result = await dashboardService.createDashboardItem({
      dashboardId: 7,
      type: 'BAR' as any,
      sql: 'select 1',
      chartSchema: { mark: 'bar' },
      sourceResponseId: 62,
      sourceThreadId: 50,
      sourceQuestion: '统计 990001 平台下各渠道的折扣比例，并生成柱状图',
    });

    expect(
      mockDashboardItemRepository.findByDashboardIdAndSourceResponseId,
    ).toHaveBeenCalledWith(7, 62, 'BAR');
    expect(mockDashboardItemRepository.createOne).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        id: 88,
        dashboardId: 7,
      }),
    );
  });

  it('persists the source runtime identity on newly pinned dashboard items', async () => {
    mockDashboardItemRepository.findByDashboardIdAndSourceResponseId.mockResolvedValue(
      null,
    );
    mockDashboardItemRepository.findAllBy.mockResolvedValue([]);
    mockDashboardItemRepository.createOne.mockResolvedValue({
      id: 91,
      dashboardId: 7,
      type: 'BAR',
      detail: {
        sql: 'select 1',
      },
      layout: { x: 0, y: 0, w: 3, h: 2 },
    });

    await dashboardService.createDashboardItem({
      dashboardId: 7,
      type: 'BAR' as any,
      sql: 'select 1',
      sqlMode: 'dialect',
      chartSchema: { mark: 'bar' },
      sourceRuntimeIdentity: {
        projectId: 999,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      },
      sourceResponseId: 62,
      sourceThreadId: 50,
      sourceQuestion: '统计 990001 平台下各渠道的折扣比例，并生成柱状图',
    });

    expect(mockDashboardItemRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        dashboardId: 7,
        detail: expect.objectContaining({
          sqlMode: 'dialect',
          runtimeIdentity: {
            projectId: null,
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            deployHash: 'deploy-1',
          },
        }),
      }),
    );
  });

  it('persists dashboard query controls on newly pinned dashboard items', async () => {
    mockDashboardItemRepository.findByDashboardIdAndSourceResponseId.mockResolvedValue(
      null,
    );
    mockDashboardItemRepository.findAllBy.mockResolvedValue([]);
    mockDashboardItemRepository.createOne.mockResolvedValue({
      id: 92,
      dashboardId: 7,
      type: 'LINE',
      detail: {
        sql: 'select 1',
      },
      layout: { x: 0, y: 0, w: 3, h: 2 },
    });

    await dashboardService.createDashboardItem({
      dashboardId: 7,
      type: 'LINE' as any,
      sql: "select * from orders where order_date between '2026-04-03' and '2026-04-07'",
      chartSchema: { mark: 'line' },
      queryControls: {
        version: 'dashboard-query-controls-v1',
        timeFilters: [
          {
            id: 'time_filter_1',
            field: 'order_date',
            mode: 'rolling_window',
            originalStartDate: '2026-04-03',
            originalEndDate: '2026-04-07',
            windowDays: 5,
            anchor: 'last_complete_day',
            timezone: 'UTC',
            sqlBinding: {
              kind: 'between',
              startLiteral: '2026-04-03',
              endLiteral: '2026-04-07',
            },
          },
        ],
      },
      sourceResponseId: 62,
      sourceThreadId: 50,
      sourceQuestion: '统计 04-03 到 04-07 的销售趋势',
    });

    expect(mockDashboardItemRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({
          queryControls: expect.objectContaining({
            version: 'dashboard-query-controls-v1',
            timeFilters: [
              expect.objectContaining({
                mode: 'rolling_window',
                windowDays: 5,
              }),
            ],
          }),
        }),
      }),
    );
  });

  it('updates dashboard query controls when the same source response is pinned again', async () => {
    const queryControls = {
      version: 'dashboard-query-controls-v1' as const,
      timeFilters: [
        {
          id: 'time_filter_1',
          field: 'order_date',
          mode: 'rolling_window' as const,
          originalStartDate: '2026-04-03',
          originalEndDate: '2026-04-07',
          windowDays: 5,
          anchor: 'last_complete_day' as const,
          timezone: 'UTC',
          sqlBinding: {
            kind: 'between' as const,
            startLiteral: '2026-04-03',
            endLiteral: '2026-04-07',
          },
        },
      ],
    };
    mockDashboardItemRepository.findByDashboardIdAndSourceResponseId.mockResolvedValue(
      {
        id: 88,
        dashboardId: 7,
        type: 'LINE',
        detail: {
          sql: "select * from orders where order_date between '2026-04-01' and '2026-04-05'",
          sourceResponseId: 62,
          sourceThreadId: 50,
          sourceQuestion: '统计销售趋势',
        },
        layout: { x: 0, y: 0, w: 3, h: 4 },
      },
    );
    mockDashboardItemRepository.updateOne.mockResolvedValue({
      id: 88,
      dashboardId: 7,
      type: 'LINE',
      detail: {
        sql: "select * from orders where order_date between '2026-04-01' and '2026-04-05'",
        queryControls,
        sourceResponseId: 62,
        sourceThreadId: 50,
        sourceQuestion: '统计销售趋势',
      },
      layout: { x: 0, y: 0, w: 3, h: 4 },
    });

    const result = await dashboardService.createDashboardItem({
      dashboardId: 7,
      type: 'LINE' as any,
      sql: "select * from orders where order_date between '2026-04-03' and '2026-04-07'",
      chartSchema: { mark: 'line' },
      queryControls,
      sourceResponseId: 62,
      sourceThreadId: 50,
      sourceQuestion: '统计 04-03 到 04-07 的销售趋势',
    });

    expect(mockDashboardItemRepository.createOne).not.toHaveBeenCalled();
    expect(mockDashboardItemRepository.updateOne).toHaveBeenCalledWith(88, {
      detail: expect.objectContaining({
        queryControls,
        sourceResponseId: 62,
        sourceThreadId: 50,
        sourceQuestion: '统计销售趋势',
      }),
    });
    expect(result).toEqual(
      expect.objectContaining({
        alreadyExists: true,
        updatedQueryControls: true,
        detail: expect.objectContaining({ queryControls }),
      }),
    );
  });

  it('returns the existing dashboard item when a concurrent pin hits the unique index', async () => {
    mockDashboardItemRepository.findByDashboardIdAndSourceResponseId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 89,
        dashboardId: 7,
        type: 'BAR',
        detail: {
          sql: 'select 1',
          sourceResponseId: 62,
        },
        layout: { x: 0, y: 0, w: 3, h: 4 },
      });
    mockDashboardItemRepository.findAllBy.mockResolvedValue([]);
    mockDashboardItemRepository.createOne.mockRejectedValue(
      Object.assign(new Error('duplicate key value'), {
        code: '23505',
        constraint: 'dashboard_item_source_response_unique',
      }),
    );

    const result = await dashboardService.createDashboardItem({
      dashboardId: 7,
      type: 'BAR' as any,
      sql: 'select 1',
      chartSchema: { mark: 'bar' },
      sourceResponseId: 62,
      sourceThreadId: 50,
      sourceQuestion: '统计 990001 平台下各渠道的折扣比例，并生成柱状图',
    });

    expect(
      mockDashboardItemRepository.findByDashboardIdAndSourceResponseId,
    ).toHaveBeenCalledTimes(2);
    expect(result).toEqual(
      expect.objectContaining({
        alreadyExists: true,
        id: 89,
        dashboardId: 7,
      }),
    );
  });

  it('rejects creating table dashboard items because table results are spreadsheet assets', async () => {
    await expect(
      dashboardService.createDashboardItem({
        dashboardId: 7,
        type: 'TABLE' as any,
        sql: 'select * from channel_daily',
        sourceResponseId: 63,
        sourceThreadId: 51,
        sourceQuestion: '查看渠道日报明细',
      }),
    ).rejects.toThrow(
      'Table results should be saved as Spreadsheet assets instead of dashboard items.',
    );

    expect(
      mockDashboardItemRepository.findByDashboardIdAndSourceResponseId,
    ).not.toHaveBeenCalled();
    expect(mockDashboardItemRepository.createOne).not.toHaveBeenCalled();
  });
});

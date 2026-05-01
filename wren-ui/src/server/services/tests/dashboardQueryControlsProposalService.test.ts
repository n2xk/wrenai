import { proposeDashboardQueryControlsForResponse } from '../dashboardQueryControlsProposalService';

const createContext = (overrides: Record<string, any> = {}) =>
  ({
    runtimeScope: {
      project: null,
      workspace: { id: 'workspace-1' },
      knowledgeBase: { id: 'kb-1' },
      kbSnapshot: { id: 'snapshot-1' },
      deployHash: 'deploy-1',
      userId: 'user-1',
    },
    askingService: {
      assertResponseScope: jest.fn(),
      getResponseScoped: jest.fn(),
    },
    wrenAIAdaptor: {
      proposeDashboardQueryControls: jest.fn(),
    },
    ...overrides,
  }) as any;

describe('proposeDashboardQueryControlsForResponse', () => {
  it('returns deterministic candidates without calling AI', async () => {
    const ctx = createContext();
    ctx.askingService.getResponseScoped.mockResolvedValue({
      id: 1,
      question: '统计 04-03 到 04-07 的销售趋势',
      sql: "select * from orders where order_date between '2026-04-03' and '2026-04-07'",
    });

    const result = await proposeDashboardQueryControlsForResponse({
      ctx,
      responseId: 1,
      timezone: 'UTC',
    });

    expect(result).toEqual(
      expect.objectContaining({
        source: 'rule',
        confidence: 'high',
        candidate: expect.objectContaining({
          field: 'order_date',
          windowDays: 5,
        }),
      }),
    );
    expect(
      ctx.wrenAIAdaptor.proposeDashboardQueryControls,
    ).not.toHaveBeenCalled();
  });

  it('uses a validated high-confidence AI proposal when rules are ambiguous', async () => {
    const ctx = createContext();
    ctx.askingService.getResponseScoped.mockResolvedValue({
      id: 2,
      question: '统计订单日期趋势',
      sql: "select * from orders where order_date between '2026-04-03' and '2026-04-07' and created_at between '2026-04-01' and '2026-04-30'",
    });
    ctx.wrenAIAdaptor.proposeDashboardQueryControls.mockResolvedValue({
      response: {
        confidence: 'high',
        reason: 'question focuses on order_date trend',
        timeFilter: {
          field: 'order_date',
          kind: 'between',
          startLiteral: '2026-04-03',
          endLiteral: '2026-04-07',
        },
      },
    });

    const result = await proposeDashboardQueryControlsForResponse({
      ctx,
      responseId: 2,
      timezone: 'UTC',
    });

    expect(
      ctx.wrenAIAdaptor.proposeDashboardQueryControls,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        query: '统计订单日期趋势',
        timezone: 'UTC',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        source: 'ai',
        confidence: 'high',
        candidate: expect.objectContaining({
          field: 'order_date',
          windowDays: 5,
        }),
        warnings: [],
      }),
    );
  });

  it('skips AI when the SQL has no date literals', async () => {
    const ctx = createContext();
    ctx.askingService.getResponseScoped.mockResolvedValue({
      id: 4,
      question: '统计总销售额',
      sql: 'select sum(amount) from orders',
    });

    const result = await proposeDashboardQueryControlsForResponse({
      ctx,
      responseId: 4,
      timezone: 'UTC',
    });

    expect(result).toEqual(
      expect.objectContaining({
        candidate: null,
        warnings: ['sql_date_literal_missing'],
      }),
    );
    expect(
      ctx.wrenAIAdaptor.proposeDashboardQueryControls,
    ).not.toHaveBeenCalled();
  });

  it('safely declines low-confidence or unsafe AI proposals', async () => {
    const ctx = createContext();
    ctx.askingService.getResponseScoped.mockResolvedValue({
      id: 3,
      question: '统计订单日期趋势',
      sql: "select * from orders where order_date between '2026-04-03' and '2026-04-07' and created_at between '2026-04-01' and '2026-04-30'",
    });
    ctx.wrenAIAdaptor.proposeDashboardQueryControls.mockResolvedValueOnce({
      response: {
        confidence: 'low',
        timeFilter: {
          field: 'order_date',
          kind: 'between',
          startLiteral: '2026-04-03',
          endLiteral: '2026-04-07',
        },
      },
    });

    await expect(
      proposeDashboardQueryControlsForResponse({
        ctx,
        responseId: 3,
        timezone: 'UTC',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        candidate: null,
        warnings: ['ai_proposal_low_confidence'],
      }),
    );

    ctx.wrenAIAdaptor.proposeDashboardQueryControls.mockResolvedValueOnce({
      response: {
        confidence: 'high',
        timeFilter: {
          field: 'order_date',
          kind: 'between',
          startLiteral: '2026-04-09',
          endLiteral: '2026-04-12',
        },
      },
    });

    await expect(
      proposeDashboardQueryControlsForResponse({
        ctx,
        responseId: 3,
        timezone: 'UTC',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        candidate: null,
        warnings: ['ai_proposal_invalid_or_unsafe'],
      }),
    );
  });
});

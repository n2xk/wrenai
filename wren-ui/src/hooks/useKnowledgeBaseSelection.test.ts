import {
  areKnowledgeBaseListsEquivalent,
  resolveKnowledgeBaseSwitchActiveId,
  resolveStableKnowledgeBaseList,
  shouldShortCircuitKnowledgeBaseSwitch,
} from './useKnowledgeBaseSelection';

type KnowledgeBase = {
  id: string;
  workspaceId: string;
  slug?: string | null;
  name?: string | null;
  defaultKbSnapshotId?: string | null;
  assetCount?: number | null;
  kind?: string | null;
  sampleDataset?: string | null;
  snapshotCount?: number | null;
  defaultKbSnapshot?: {
    id: string;
    deployHash: string;
  } | null;
};

const buildKnowledgeBase = (
  overrides: Partial<KnowledgeBase> = {},
): KnowledgeBase => ({
  id: 'kb-1',
  workspaceId: 'ws-1',
  slug: 'orders',
  name: '订单分析',
  defaultKbSnapshotId: 'snapshot-1',
  assetCount: 3,
  kind: 'regular',
  sampleDataset: null,
  snapshotCount: 1,
  defaultKbSnapshot: {
    id: 'snapshot-1',
    deployHash: 'deploy-1',
  },
  ...overrides,
});

describe('useKnowledgeBaseSelection helpers', () => {
  it('treats equivalent refreshed knowledge lists as unchanged', () => {
    const current = [buildKnowledgeBase()];
    const refreshed = [buildKnowledgeBase()];

    expect(areKnowledgeBaseListsEquivalent(current, refreshed)).toBe(true);
    expect(resolveStableKnowledgeBaseList(current, refreshed)).toBe(current);
  });

  it('updates when stable display or routing fields change', () => {
    const current = [buildKnowledgeBase()];
    const renamed = [buildKnowledgeBase({ name: '利润分析' })];
    const sampleChanged = [
      buildKnowledgeBase({
        kind: 'system_sample',
        sampleDataset: 'NBA',
      }),
    ];
    const resnapshotted = [
      buildKnowledgeBase({
        defaultKbSnapshotId: 'snapshot-2',
        defaultKbSnapshot: {
          id: 'snapshot-2',
          deployHash: 'deploy-2',
        },
      }),
    ];

    expect(areKnowledgeBaseListsEquivalent(current, renamed)).toBe(false);
    expect(resolveStableKnowledgeBaseList(current, renamed)).toBe(renamed);
    expect(areKnowledgeBaseListsEquivalent(current, sampleChanged)).toBe(false);
    expect(resolveStableKnowledgeBaseList(current, sampleChanged)).toBe(
      sampleChanged,
    );
    expect(areKnowledgeBaseListsEquivalent(current, resnapshotted)).toBe(false);
    expect(resolveStableKnowledgeBaseList(current, resnapshotted)).toBe(
      resnapshotted,
    );
  });

  it('can preserve the current list during transient empty hydration payloads', () => {
    const current = [buildKnowledgeBase()];

    expect(
      resolveStableKnowledgeBaseList(current, [], {
        preserveCurrentWhenNextEmpty: true,
      }),
    ).toBe(current);
    expect(resolveStableKnowledgeBaseList(current, [])).toEqual([]);
  });

  it('uses the route knowledge base as the active switch target when selector state is stale', () => {
    expect(
      resolveKnowledgeBaseSwitchActiveId({
        routeKnowledgeBaseId: 'kb-2',
        currentKnowledgeBaseId: 'kb-1',
      }),
    ).toBe('kb-2');
    expect(
      shouldShortCircuitKnowledgeBaseSwitch({
        targetKnowledgeBaseId: 'kb-1',
        routeKnowledgeBaseId: 'kb-2',
        currentKnowledgeBaseId: 'kb-1',
      }),
    ).toBe(false);
    expect(
      shouldShortCircuitKnowledgeBaseSwitch({
        targetKnowledgeBaseId: 'kb-2',
        routeKnowledgeBaseId: 'kb-2',
        currentKnowledgeBaseId: 'kb-1',
      }),
    ).toBe(true);
  });
});

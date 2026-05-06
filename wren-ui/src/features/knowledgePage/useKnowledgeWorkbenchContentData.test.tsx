import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useKnowledgeWorkbenchContentData from './useKnowledgeWorkbenchContentData';

const mockUseKnowledgeConnectors = jest.fn();
const mockUseKnowledgeDiagramData = jest.fn();
const mockUseKnowledgeRuntimeDataSync = jest.fn();
const mockUseKnowledgeAssets = jest.fn();

jest.mock('@/hooks/useKnowledgeConnectors', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgeConnectors(...args),
}));

jest.mock('@/hooks/useKnowledgeDiagramData', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgeDiagramData(...args),
}));

jest.mock('@/hooks/useKnowledgeRuntimeDataSync', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgeRuntimeDataSync(...args),
}));

jest.mock('@/hooks/useKnowledgeAssets', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgeAssets(...args),
}));

describe('useKnowledgeWorkbenchContentData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseKnowledgeConnectors.mockReturnValue({
      connectors: [{ id: 'c1', displayName: 'Warehouse', type: 'postgres' }],
      connectorsLoading: false,
      selectedSourceType: 'database',
      setSelectedSourceType: jest.fn(),
      selectedConnectorId: 'c1',
      setSelectedConnectorId: jest.fn(),
      selectedDemoTable: undefined,
      setSelectedDemoTable: jest.fn(),
      selectedDemoKnowledge: null,
      isDemoSource: false,
      demoDatabaseOptions: [],
      demoTableOptions: [],
      canContinueAssetWizard: true,
    });
    mockUseKnowledgeDiagramData.mockReturnValue({
      diagramData: { diagram: { models: [] } },
      diagramLoading: false,
      refetchDiagram: jest.fn(async () => null),
    });
    mockUseKnowledgeRuntimeDataSync.mockReturnValue({
      routeRuntimeSyncing: false,
    });
    mockUseKnowledgeAssets.mockReturnValue({
      assets: [{ id: 'asset-1', name: 'orders' }],
      overviewPreviewAsset: { id: 'asset-1', name: 'orders' },
      previewFieldCount: 12,
    });
  });

  const renderHookHarness = (
    overrides: Partial<
      Parameters<typeof useKnowledgeWorkbenchContentData>[0]
    > = {},
  ) => {
    let current!: ReturnType<typeof useKnowledgeWorkbenchContentData>;

    const Harness = () => {
      current = useKnowledgeWorkbenchContentData({
        activeKnowledgeBase: {
          id: 'kb-1',
          name: 'Demo KB',
          slug: 'demo-kb',
          workspaceId: 'ws-1',
        },
        activeKnowledgeBaseExecutable: true,
        activeKnowledgeRuntimeSelector: {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
        },
        activeKnowledgeSnapshotId: 'snapshot-1',
        assetModalOpen: true,
        draftAssets: [],
        fetchConnectors: jest.fn(async () => []),
        handleConnectorLoadError: jest.fn(),
        hasRuntimeScope: true,
        initialKnowledgeSourceType: 'database',
        isKnowledgeMutationDisabled: false,
        knowledgeOwner: 'owner',
        knowledgeSourceOptions: [
          {
            key: 'database',
            category: 'connector',
            label: 'Database',
            icon: 'database',
            meta: 'connector',
          },
        ],
        matchedDemoKnowledge: null,
        refetchRuntimeSelector: jest.fn(async () => undefined),
        runtimeSyncScopeKey: 'sync-key',
        runtimeTransitioning: false,
        ...overrides,
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));
    return current;
  };

  it('composes connector, diagram, runtime-sync and asset hooks into one content surface', () => {
    const hookValue = renderHookHarness();

    expect(hookValue.connectors).toEqual([
      { id: 'c1', displayName: 'Warehouse', type: 'postgres' },
    ]);
    expect(hookValue.previewFieldCount).toBe(12);
    expect(hookValue.routeRuntimeSyncing).toBe(false);
    expect(mockUseKnowledgeConnectors).toHaveBeenCalled();
    expect(mockUseKnowledgeDiagramData).toHaveBeenCalled();
    expect(mockUseKnowledgeRuntimeDataSync).toHaveBeenCalled();
    expect(mockUseKnowledgeAssets).toHaveBeenCalled();
  });

  it('disables wizard continuation when there is no selected knowledge base', () => {
    const hookValue = renderHookHarness({
      activeKnowledgeBase: null,
      activeKnowledgeRuntimeSelector: {
        workspaceId: 'ws-1',
      },
      isKnowledgeMutationDisabled: true,
    });

    expect(hookValue.canContinueAssetWizard).toBe(false);
  });
});

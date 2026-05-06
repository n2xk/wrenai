import {
  buildKnowledgeSwitchPath,
  resolveKnowledgeRuntimeSelector,
} from './useKnowledgePageActions';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { KNOWLEDGE_BASE_REQUIRED_MUTATION_HINT } from '@/utils/knowledgeMutationGuard';
import { clearAntdAppBridge, setAntdAppBridge } from '@/utils/antdAppBridge';
import useKnowledgePageActions from './useKnowledgePageActions';

describe('useKnowledgePageActions helpers', () => {
  it('builds switch path with workspace and snapshot params', () => {
    expect(
      buildKnowledgeSwitchPath({
        id: 'kb-1',
        workspaceId: 'ws-1',
        defaultKbSnapshot: {
          id: 'snap-1',
          deployHash: 'deploy-1',
        },
      }),
    ).toBe(
      '/knowledge?workspaceId=ws-1&knowledgeBaseId=kb-1&kbSnapshotId=snap-1&deployHash=deploy-1',
    );
  });

  it('falls back to runtime selector when no knowledge base is provided', () => {
    expect(
      resolveKnowledgeRuntimeSelector({
        knowledgeBase: null,
        fallbackSelector: { workspaceId: 'ws-1' },
      }),
    ).toEqual({ workspaceId: 'ws-1' });
  });
});

describe('useKnowledgePageActions', () => {
  afterEach(() => {
    clearAntdAppBridge();
  });

  it('blocks opening the asset wizard when no knowledge base is selected', () => {
    const warning = jest.fn();
    const setAssetModalOpen = jest.fn();
    let current!: ReturnType<typeof useKnowledgePageActions>;
    setAntdAppBridge({
      message: {
        warning,
        open: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
        info: jest.fn(),
        loading: jest.fn(),
        destroy: jest.fn(),
      },
    });

    const Harness = () => {
      current = useKnowledgePageActions({
        activeKnowledgeBase: null,
        runtimeNavigationSelector: { workspaceId: 'ws-1' },
        buildRuntimeScopeUrl: (path) => path,
        pushRoute: jest.fn(async () => undefined),
        isKnowledgeMutationDisabled: true,
        isSnapshotReadonlyKnowledgeBase: false,
        snapshotReadonlyHint: '历史版本只读',
        openModalSafely: (action) => action(),
        setAssetModalOpen,
        setAssetWizardStep: jest.fn(),
        resetAssetDraft: jest.fn(),
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));
    current.openAssetWizard();

    expect(setAssetModalOpen).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(KNOWLEDGE_BASE_REQUIRED_MUTATION_HINT);
  });
});

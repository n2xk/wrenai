import {
  clearRuntimeSelectorStateCache,
  peekRuntimeSelectorStatePayload,
  primeRuntimeSelectorStatePayload,
} from '@/hooks/runtimeSelectorStateRequest';
import { refreshWorkspaceMutationState } from './workspaceMutationRefresh';

describe('refreshWorkspaceMutationState', () => {
  const requestUrl = '/api/v1/runtime/scope/current?workspaceId=ws-1';

  beforeEach(() => {
    clearRuntimeSelectorStateCache();
  });

  afterEach(() => {
    clearRuntimeSelectorStateCache();
  });

  it('clears selector/session caches and runs local plus shell refreshers', async () => {
    const refreshLocalData = jest.fn(async () => undefined);
    const refetchRuntimeSelectorState = jest.fn(async () => undefined);
    const refreshAuthSession = jest.fn(async () => undefined);
    const selectorPayload = {
      currentWorkspace: {
        id: 'ws-1',
        slug: 'ws-1',
        name: 'Workspace 1',
      },
      workspaces: [],
      currentKnowledgeBase: null,
      currentKbSnapshot: null,
      knowledgeBases: [],
      kbSnapshots: [],
    };

    primeRuntimeSelectorStatePayload({
      requestUrl,
      payload: selectorPayload,
    });
    await refreshWorkspaceMutationState({
      refreshLocalData,
      refetchRuntimeSelectorState,
      refreshAuthSession,
    });

    expect(peekRuntimeSelectorStatePayload({ requestUrl })).toBeNull();
    expect(refreshLocalData).toHaveBeenCalledTimes(1);
    expect(refetchRuntimeSelectorState).toHaveBeenCalledTimes(1);
    expect(refreshAuthSession).toHaveBeenCalledTimes(1);
  });

  it('does not fail the original mutation when refreshers reject', async () => {
    await expect(
      refreshWorkspaceMutationState({
        refreshLocalData: jest.fn(async () => {
          throw new Error('local refresh failed');
        }),
        refetchRuntimeSelectorState: jest.fn(async () => {
          throw new Error('selector refresh failed');
        }),
        refreshAuthSession: jest.fn(async () => {
          throw new Error('auth refresh failed');
        }),
      }),
    ).resolves.toBeUndefined();
  });
});

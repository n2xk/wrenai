import { clearAuthSessionCache } from '@/hooks/useAuthSession';
import { clearRuntimeSelectorStateCache } from '@/hooks/runtimeSelectorStateRequest';

type MaybePromise<T = unknown> = T | Promise<T>;

type WorkspaceMutationRefreshArgs = {
  refreshLocalData?: () => MaybePromise;
  refetchRuntimeSelectorState?: () => MaybePromise;
  refreshAuthSession?: () => MaybePromise;
};

const runRefreshSafely = async (refresh?: () => MaybePromise) => {
  if (!refresh) {
    return;
  }

  try {
    await refresh();
  } catch (_error) {
    // Local mutation already succeeded; stale-cache refresh failures should not
    // turn the original action into a user-facing create/update failure.
  }
};

export const refreshWorkspaceMutationState = async ({
  refreshLocalData,
  refetchRuntimeSelectorState,
  refreshAuthSession,
}: WorkspaceMutationRefreshArgs) => {
  clearRuntimeSelectorStateCache();
  clearAuthSessionCache();

  await Promise.all([
    runRefreshSafely(refreshLocalData),
    runRefreshSafely(refetchRuntimeSelectorState),
    runRefreshSafely(refreshAuthSession),
  ]);
};

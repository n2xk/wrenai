import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { appMessage as message } from '@/utils/antdAppBridge';
import { type ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import { Path } from '@/utils/enum';
import useRuntimeScopeNavigation from './useRuntimeScopeNavigation';
import useRuntimeSelectorState from './useRuntimeSelectorState';
import useRestRequest from './useRestRequest';
import {
  deleteHomeSidebarThread,
  loadHomeSidebarThreadsPayload,
  renameHomeSidebarThread,
} from './homeSidebarRequests';
import {
  EMPTY_SIDEBAR_THREADS,
  HOME_SIDEBAR_PAGE_SIZE,
  buildHomeSidebarThreadsRequestKey,
  cacheHomeSidebarPageInfo,
  cacheHomeSidebarQueryEnabled,
  cacheHomeSidebarThreads,
  getCachedHomeSidebarPageInfo,
  getCachedHomeSidebarQueryEnabled,
  getCachedHomeSidebarThreads,
  resolveHomeSidebarHeaderSelector,
  resolveHomeSidebarRuntimeScopeReady,
  resolveHomeSidebarScopeKey,
  resolveHomeSidebarThreadSelector,
  shouldEagerLoadHomeSidebarOnIntent,
  shouldEnableSidebarQueryOnIntent,
  shouldFetchHomeSidebarThreads,
  shouldLoadMoreHomeSidebarThreads,
  shouldScheduleDeferredSidebarLoad,
  type HomeSidebarThreadsPagePayload,
  type HomeSidebarThreadRecord,
  type SidebarThread,
} from './homeSidebarHelpers';

export {
  buildHomeSidebarThreadDetailUrl,
  buildHomeSidebarThreadsRequestKey,
  buildHomeSidebarThreadsUrl,
  getCachedHomeSidebarQueryEnabled,
  getCachedHomeSidebarThreads,
  normalizeHomeSidebarThreads,
  normalizeHomeSidebarThreadsPage,
  resolveHomeSidebarHeaderSelector,
  resolveHomeSidebarRuntimeScopeReady,
  resolveHomeSidebarScopeKey,
  resolveHomeSidebarThreadSelector,
  shouldEagerLoadHomeSidebarOnIntent,
  shouldEnableSidebarQueryOnIntent,
  shouldFetchHomeSidebarThreads,
  shouldLoadMoreHomeSidebarThreads,
  shouldScheduleDeferredSidebarLoad,
} from './homeSidebarHelpers';

type UseHomeSidebarOptions = {
  deferInitialLoad?: boolean;
  loadOnIntent?: boolean;
  disabled?: boolean;
};

export default function useHomeSidebar(options?: UseHomeSidebarOptions) {
  // Intentional partial exception:
  // sessionStorage warm cache + intent/deferred enablement stay local here,
  // while the primary threads GET path now reuses `useRestRequest`.
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const runtimeSelectorState = useRuntimeSelectorState();
  const { hasRuntimeScope } = runtimeScopeNavigation;
  const runtimeScopeReady = resolveHomeSidebarRuntimeScopeReady({
    hasRuntimeScope,
    initialLoading: runtimeSelectorState.initialLoading,
    workspaceId: runtimeScopeNavigation.selector.workspaceId,
    runtimeScopeId: runtimeScopeNavigation.selector.runtimeScopeId,
  });
  const deferInitialLoad = Boolean(options?.deferInitialLoad);
  const loadOnIntent = Boolean(options?.loadOnIntent);
  const disabled = Boolean(options?.disabled);
  const scopeKey = resolveHomeSidebarScopeKey({
    workspaceId: runtimeScopeNavigation.selector.workspaceId,
    runtimeScopeId: runtimeScopeNavigation.selector.runtimeScopeId,
  });
  const [searchKeyword, setSearchKeyword] = useState('');
  const [committedSearchKeyword, setCommittedSearchKeyword] = useState('');
  const normalizedSearchKeyword = committedSearchKeyword.trim();
  const sidebarCacheKey = normalizedSearchKeyword
    ? `${scopeKey}:search:${normalizedSearchKeyword.toLowerCase()}`
    : scopeKey;
  const sidebarHeaderSelector = useMemo(
    () =>
      resolveHomeSidebarHeaderSelector({
        workspaceId: runtimeScopeNavigation.selector.workspaceId,
        runtimeScopeId: runtimeScopeNavigation.selector.runtimeScopeId,
      }),
    [
      runtimeScopeNavigation.selector.runtimeScopeId,
      runtimeScopeNavigation.selector.workspaceId,
    ],
  );
  const [queryEnabled, setQueryEnabled] = useState(
    () =>
      !disabled &&
      (!deferInitialLoad || getCachedHomeSidebarQueryEnabled(scopeKey)),
  );
  const [threads, setThreads] = useState(() =>
    getCachedHomeSidebarThreads(sidebarCacheKey),
  );
  const [pageInfo, setPageInfo] = useState(() =>
    getCachedHomeSidebarPageInfo(sidebarCacheKey),
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const [initialized, setInitialized] = useState(
    () => getCachedHomeSidebarThreads(sidebarCacheKey).length > 0,
  );
  const requestCacheModeRef = useRef<RequestCache>('default');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setCommittedSearchKeyword(searchKeyword.trim());
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [searchKeyword]);

  useEffect(() => {
    if (disabled) {
      setQueryEnabled(false);
      return;
    }

    setQueryEnabled(
      !deferInitialLoad || getCachedHomeSidebarQueryEnabled(scopeKey),
    );
  }, [deferInitialLoad, disabled, scopeKey]);

  useEffect(() => {
    if (disabled) {
      return;
    }

    if (!hasRuntimeScope) {
      setQueryEnabled(!deferInitialLoad);
      return;
    }

    if (
      !shouldScheduleDeferredSidebarLoad({
        deferInitialLoad,
        hasRuntimeScope: hasRuntimeScope && runtimeScopeReady,
        loadOnIntent,
        queryEnabled,
      })
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      setQueryEnabled(true);
    }, 420);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    deferInitialLoad,
    disabled,
    hasRuntimeScope,
    loadOnIntent,
    queryEnabled,
    runtimeScopeReady,
  ]);

  useEffect(() => {
    if (disabled || !hasRuntimeScope || !queryEnabled) {
      return;
    }

    cacheHomeSidebarQueryEnabled(scopeKey);
  }, [disabled, hasRuntimeScope, queryEnabled, scopeKey]);

  const cachedThreads = useMemo(
    () => getCachedHomeSidebarThreads(sidebarCacheKey),
    [sidebarCacheKey],
  );
  const cachedPageInfo = useMemo(
    () => getCachedHomeSidebarPageInfo(sidebarCacheKey),
    [sidebarCacheKey],
  );

  const normalizeSidebarThreads = useCallback(
    (nextThreads?: HomeSidebarThreadRecord[]): SidebarThread[] =>
      (nextThreads || []).map((thread) => ({
        id: thread.id.toString(),
        name: thread.summary || '未命名对话',
        selector: resolveHomeSidebarThreadSelector(thread),
      })),
    [],
  );

  const syncThreadsPage = useCallback(
    (payload: HomeSidebarThreadsPagePayload, append = false) => {
      const normalizedThreads = normalizeSidebarThreads(payload.threads);
      const nextThreads = append
        ? Array.from(
            new Map(
              [
                ...getCachedHomeSidebarThreads(sidebarCacheKey),
                ...normalizedThreads,
              ].map((thread) => [thread.id, thread]),
            ).values(),
          )
        : normalizedThreads;
      const nextPageInfo = {
        nextCursor: payload.nextCursor,
        hasMore: payload.hasMore,
      };

      cacheHomeSidebarThreads(sidebarCacheKey, nextThreads);
      cacheHomeSidebarPageInfo(sidebarCacheKey, nextPageInfo);
      const cachedNormalizedThreads =
        getCachedHomeSidebarThreads(sidebarCacheKey);
      setThreads(cachedNormalizedThreads);
      setPageInfo(nextPageInfo);
      return cachedNormalizedThreads;
    },
    [normalizeSidebarThreads, sidebarCacheKey],
  );

  const syncThreads = useCallback(
    (payload: HomeSidebarThreadsPagePayload) => syncThreadsPage(payload, false),
    [syncThreadsPage],
  );

  useEffect(() => {
    if (disabled) {
      setThreads(EMPTY_SIDEBAR_THREADS);
      setPageInfo({
        nextCursor: null,
        hasMore: false,
      });
      setInitialized(true);
      return;
    }

    setThreads(cachedThreads);
    setPageInfo(cachedPageInfo);
    setInitialized(cachedThreads.length > 0);
  }, [cachedPageInfo, cachedThreads, disabled, sidebarCacheKey]);

  const requestUrl = useMemo(
    () =>
      buildHomeSidebarThreadsRequestKey(sidebarHeaderSelector, {
        limit: HOME_SIDEBAR_PAGE_SIZE,
        keyword: normalizedSearchKeyword,
      }),
    [normalizedSearchKeyword, sidebarHeaderSelector],
  );
  const {
    loading,
    refetch: refetchThreads,
    cancel: cancelThreadsRequest,
  } = useRestRequest<SidebarThread[], HomeSidebarThreadsPagePayload>({
    enabled: !disabled && hasRuntimeScope && runtimeScopeReady && queryEnabled,
    auto: false,
    initialData: EMPTY_SIDEBAR_THREADS,
    requestKey: requestUrl,
    request: ({ signal }) =>
      loadHomeSidebarThreadsPayload({
        requestUrl,
        cacheMode: requestCacheModeRef.current,
        signal,
      }),
    mapResult: syncThreads,
    onSuccess: () => {
      setInitialized(true);
    },
    onError: (error) => {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '加载历史对话失败，请稍后重试',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
      setInitialized(true);
    },
    resetDataOnDisable: false,
  });

  useEffect(() => cancelThreadsRequest, [cancelThreadsRequest]);

  const loadThreads = useCallback(
    async ({
      networkOnly = false,
    }: {
      networkOnly?: boolean;
    } = {}) => {
      if (disabled || !hasRuntimeScope) {
        setThreads(EMPTY_SIDEBAR_THREADS);
        setPageInfo({
          nextCursor: null,
          hasMore: false,
        });
        setInitialized(true);
        return EMPTY_SIDEBAR_THREADS;
      }

      if (!runtimeScopeReady) {
        return getCachedHomeSidebarThreads(sidebarCacheKey);
      }

      requestCacheModeRef.current = networkOnly ? 'no-store' : 'default';

      try {
        return await refetchThreads();
      } catch (_error) {
        const cachedFallback = getCachedHomeSidebarThreads(sidebarCacheKey);
        setThreads(cachedFallback);
        return cachedFallback;
      } finally {
        requestCacheModeRef.current = 'default';
      }
    },
    [
      disabled,
      hasRuntimeScope,
      refetchThreads,
      runtimeScopeReady,
      sidebarCacheKey,
    ],
  );

  useEffect(() => {
    if (
      !shouldFetchHomeSidebarThreads({
        disabled,
        hasRuntimeScope: hasRuntimeScope && runtimeScopeReady,
        queryEnabled,
        cachedThreadCount: cachedThreads.length,
      })
    ) {
      return;
    }

    void loadThreads();
  }, [
    cachedThreads.length,
    disabled,
    hasRuntimeScope,
    loadThreads,
    queryEnabled,
    runtimeScopeReady,
  ]);

  const safeRefetch = useCallback(async () => {
    if (disabled || !hasRuntimeScope) {
      return EMPTY_SIDEBAR_THREADS;
    }

    if (!runtimeScopeReady) {
      return getCachedHomeSidebarThreads(sidebarCacheKey);
    }

    cacheHomeSidebarQueryEnabled(scopeKey);
    if (!queryEnabled) {
      setQueryEnabled(true);
      return getCachedHomeSidebarThreads(sidebarCacheKey);
    }

    return loadThreads({ networkOnly: true });
  }, [
    disabled,
    hasRuntimeScope,
    loadThreads,
    queryEnabled,
    runtimeScopeReady,
    sidebarCacheKey,
    scopeKey,
  ]);

  const loadMore = useCallback(async () => {
    if (
      !shouldLoadMoreHomeSidebarThreads({
        disabled,
        hasRuntimeScope,
        loading: loading || loadingMoreRef.current,
        hasMore: pageInfo.hasMore,
        nextCursor: pageInfo.nextCursor,
      })
    ) {
      return threads;
    }

    if (!runtimeScopeReady) {
      return threads;
    }

    const nextPageUrl = buildHomeSidebarThreadsRequestKey(
      sidebarHeaderSelector,
      {
        limit: HOME_SIDEBAR_PAGE_SIZE,
        cursor: pageInfo.nextCursor,
        keyword: normalizedSearchKeyword,
      },
    );

    loadingMoreRef.current = true;
    setLoadingMore(true);

    try {
      const nextPage = await loadHomeSidebarThreadsPayload({
        requestUrl: nextPageUrl,
        cacheMode: 'default',
      });
      setInitialized(true);
      return syncThreadsPage(nextPage, true);
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '加载更多历史对话失败，请稍后重试',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
      return threads;
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [
    disabled,
    hasRuntimeScope,
    loading,
    normalizedSearchKeyword,
    pageInfo.hasMore,
    pageInfo.nextCursor,
    runtimeScopeReady,
    sidebarHeaderSelector,
    syncThreadsPage,
    threads,
  ]);

  const onSelect = useCallback(
    (selectKeys: string[], selectorOverride?: ClientRuntimeScopeSelector) => {
      runtimeScopeNavigation.push(
        `${Path.Home}/${selectKeys[0]}`,
        {},
        selectorOverride || runtimeScopeNavigation.workspaceSelector,
      );
    },
    [runtimeScopeNavigation.push, runtimeScopeNavigation.workspaceSelector],
  );

  const onRename = useCallback(
    async (id: string, newName: string) => {
      try {
        await renameHomeSidebarThread({
          id,
          summary: newName,
          selector: sidebarHeaderSelector,
        });
        await safeRefetch();
      } catch (error: any) {
        const errorMessage = resolveAbortSafeErrorMessage(
          error,
          '更新对话失败，请稍后重试',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
      }
    },
    [safeRefetch, sidebarHeaderSelector],
  );

  const onDelete = useCallback(
    async (id: string) => {
      try {
        await deleteHomeSidebarThread({
          id,
          selector: sidebarHeaderSelector,
        });
        await safeRefetch();
      } catch (error: any) {
        const errorMessage = resolveAbortSafeErrorMessage(
          error,
          '删除对话失败，请稍后重试',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
      }
    },
    [safeRefetch, sidebarHeaderSelector],
  );

  const ensureLoaded = useCallback(() => {
    if (disabled || !hasRuntimeScope) {
      return;
    }

    const canEnableQuery = shouldEnableSidebarQueryOnIntent({
      disabled,
      hasRuntimeScope,
      queryEnabled,
    });
    if (canEnableQuery) {
      cacheHomeSidebarQueryEnabled(scopeKey);
      setQueryEnabled(true);
    }

    if (
      canEnableQuery ||
      !shouldEagerLoadHomeSidebarOnIntent({
        disabled,
        hasRuntimeScope,
        cachedThreadCount: getCachedHomeSidebarThreads(sidebarCacheKey).length,
      })
    ) {
      return;
    }

    void loadThreads();
  }, [
    disabled,
    hasRuntimeScope,
    loadThreads,
    queryEnabled,
    scopeKey,
    sidebarCacheKey,
  ]);

  return useMemo(
    () => ({
      data: { threads },
      loading,
      initialized,
      hasMore: pageInfo.hasMore,
      loadingMore,
      searchKeyword,
      setSearchKeyword,
      onSelect,
      onRename,
      onDelete,
      refetch: safeRefetch,
      loadMore,
      ensureLoaded,
    }),
    [
      ensureLoaded,
      loadMore,
      pageInfo.hasMore,
      initialized,
      loading,
      loadingMore,
      onDelete,
      onRename,
      onSelect,
      safeRefetch,
      searchKeyword,
      threads,
    ],
  );
}

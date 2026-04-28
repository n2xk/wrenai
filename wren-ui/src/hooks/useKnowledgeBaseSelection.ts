import { useCallback, useEffect, useState } from 'react';
import { invalidateKnowledgeBaseList } from '@/utils/runtimePagePrefetch';

type KnowledgeBaseSwitchable = {
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

export const areKnowledgeBaseListsEquivalent = <
  TKnowledgeBase extends KnowledgeBaseSwitchable,
>(
  previous: TKnowledgeBase[],
  next: TKnowledgeBase[],
) => {
  if (previous === next) {
    return true;
  }

  if (previous.length !== next.length) {
    return false;
  }

  for (let index = 0; index < previous.length; index += 1) {
    const prevKnowledgeBase = previous[index];
    const nextKnowledgeBase = next[index];

    if (
      prevKnowledgeBase.id !== nextKnowledgeBase.id ||
      prevKnowledgeBase.workspaceId !== nextKnowledgeBase.workspaceId ||
      prevKnowledgeBase.slug !== nextKnowledgeBase.slug ||
      prevKnowledgeBase.name !== nextKnowledgeBase.name ||
      prevKnowledgeBase.defaultKbSnapshotId !==
        nextKnowledgeBase.defaultKbSnapshotId ||
      prevKnowledgeBase.assetCount !== nextKnowledgeBase.assetCount ||
      prevKnowledgeBase.kind !== nextKnowledgeBase.kind ||
      prevKnowledgeBase.sampleDataset !== nextKnowledgeBase.sampleDataset ||
      prevKnowledgeBase.snapshotCount !== nextKnowledgeBase.snapshotCount ||
      prevKnowledgeBase.defaultKbSnapshot?.id !==
        nextKnowledgeBase.defaultKbSnapshot?.id ||
      prevKnowledgeBase.defaultKbSnapshot?.deployHash !==
        nextKnowledgeBase.defaultKbSnapshot?.deployHash
    ) {
      return false;
    }
  }

  return true;
};

export const resolveStableKnowledgeBaseList = <
  TKnowledgeBase extends KnowledgeBaseSwitchable,
>(
  currentKnowledgeBases: TKnowledgeBase[],
  nextKnowledgeBases: TKnowledgeBase[],
  { preserveCurrentWhenNextEmpty = false } = {},
) => {
  if (preserveCurrentWhenNextEmpty && nextKnowledgeBases.length === 0) {
    return currentKnowledgeBases;
  }

  return areKnowledgeBaseListsEquivalent(
    currentKnowledgeBases,
    nextKnowledgeBases,
  )
    ? currentKnowledgeBases
    : nextKnowledgeBases;
};

export default function useKnowledgeBaseSelection<
  TKnowledgeBase extends KnowledgeBaseSwitchable,
>({
  hasRuntimeScope,
  knowledgeBasesUrl,
  cachedKnowledgeBases,
  routeKnowledgeBaseId,
  currentKnowledgeBaseId,
  currentPath,
  fetchKnowledgeBases,
  transitionTo,
  shouldRouteSwitchKnowledgeBase,
  onLoadError,
}: {
  hasRuntimeScope: boolean;
  knowledgeBasesUrl?: string | null;
  cachedKnowledgeBases?: TKnowledgeBase[] | null;
  routeKnowledgeBaseId?: string | null;
  currentKnowledgeBaseId?: string | null;
  currentPath: string;
  fetchKnowledgeBases: (url: string) => Promise<TKnowledgeBase[]>;
  transitionTo: (url: string) => Promise<unknown>;
  shouldRouteSwitchKnowledgeBase: (
    knowledgeBase: TKnowledgeBase,
    currentKnowledgeBaseId?: string | null,
  ) => boolean;
  onLoadError?: (error: unknown) => void;
}) {
  const [knowledgeBases, setKnowledgeBases] = useState<TKnowledgeBase[]>(
    cachedKnowledgeBases || [],
  );
  const [selectedKnowledgeBaseId, setSelectedKnowledgeBaseId] = useState<
    string | null
  >(null);
  const [pendingKnowledgeBaseId, setPendingKnowledgeBaseId] = useState<
    string | null
  >(null);

  const loadKnowledgeBases = useCallback(
    async (forceFresh = false): Promise<TKnowledgeBase[]> => {
      if (!hasRuntimeScope || !knowledgeBasesUrl) {
        setKnowledgeBases((currentKnowledgeBases) => currentKnowledgeBases);
        return [];
      }

      try {
        if (forceFresh) {
          invalidateKnowledgeBaseList(knowledgeBasesUrl);
        }
        const payload = await fetchKnowledgeBases(knowledgeBasesUrl);
        const nextKnowledgeBases = Array.isArray(payload) ? payload : [];
        setKnowledgeBases((currentKnowledgeBases) =>
          resolveStableKnowledgeBaseList(
            currentKnowledgeBases,
            nextKnowledgeBases,
          ),
        );
        return nextKnowledgeBases;
      } catch (error) {
        onLoadError?.(error);
        setKnowledgeBases((currentKnowledgeBases) => currentKnowledgeBases);
        return [];
      }
    },
    [fetchKnowledgeBases, hasRuntimeScope, knowledgeBasesUrl, onLoadError],
  );

  useEffect(() => {
    if (!cachedKnowledgeBases) {
      return;
    }

    setKnowledgeBases((currentKnowledgeBases) =>
      resolveStableKnowledgeBaseList(
        currentKnowledgeBases,
        cachedKnowledgeBases,
        {
          preserveCurrentWhenNextEmpty: currentKnowledgeBases.length > 0,
        },
      ),
    );
  }, [cachedKnowledgeBases]);

  useEffect(() => {
    if (!hasRuntimeScope || !knowledgeBasesUrl) {
      return;
    }

    let cancelled = false;
    let timeoutId: number | null = null;
    let idleCallbackId: number | null = null;
    const hasHydratedKnowledgeBases =
      Array.isArray(cachedKnowledgeBases) && cachedKnowledgeBases.length > 0;

    const runLoad = () => {
      if (cancelled) {
        return;
      }

      void loadKnowledgeBases(false).catch(() => null);
    };

    if (hasHydratedKnowledgeBases) {
      if (
        typeof window !== 'undefined' &&
        typeof window.requestIdleCallback === 'function'
      ) {
        idleCallbackId = window.requestIdleCallback(runLoad, {
          timeout: 1500,
        });
      } else if (typeof window !== 'undefined') {
        timeoutId = window.setTimeout(runLoad, 900);
      } else {
        runLoad();
      }
    } else {
      runLoad();
    }

    return () => {
      cancelled = true;
      if (timeoutId != null && typeof window !== 'undefined') {
        window.clearTimeout(timeoutId);
      }
      if (
        idleCallbackId != null &&
        typeof window !== 'undefined' &&
        typeof window.cancelIdleCallback === 'function'
      ) {
        window.cancelIdleCallback(idleCallbackId);
      }
    };
  }, [
    cachedKnowledgeBases,
    hasRuntimeScope,
    knowledgeBasesUrl,
    loadKnowledgeBases,
  ]);

  useEffect(() => {
    if (selectedKnowledgeBaseId) {
      const hasSelectedKnowledgeBase = knowledgeBases.some(
        (knowledgeBase) => knowledgeBase.id === selectedKnowledgeBaseId,
      );
      if (hasSelectedKnowledgeBase) {
        return;
      }
    }

    if (routeKnowledgeBaseId) {
      setSelectedKnowledgeBaseId(routeKnowledgeBaseId);
      return;
    }

    if (knowledgeBases[0]?.id) {
      setSelectedKnowledgeBaseId(knowledgeBases[0].id);
    }
  }, [knowledgeBases, routeKnowledgeBaseId, selectedKnowledgeBaseId]);

  const switchKnowledgeBase = useCallback(
    async (knowledgeBase: TKnowledgeBase, buildSwitchUrl: string) => {
      if (knowledgeBase.id === currentKnowledgeBaseId) {
        setPendingKnowledgeBaseId(null);
        setSelectedKnowledgeBaseId(knowledgeBase.id);
        return;
      }

      if (
        !shouldRouteSwitchKnowledgeBase(knowledgeBase, currentKnowledgeBaseId)
      ) {
        setPendingKnowledgeBaseId(null);
        setSelectedKnowledgeBaseId(knowledgeBase.id);
        return;
      }

      setSelectedKnowledgeBaseId(knowledgeBase.id);
      setPendingKnowledgeBaseId(knowledgeBase.id);
      if (buildSwitchUrl === currentPath) {
        setPendingKnowledgeBaseId(null);
        return;
      }

      try {
        await transitionTo(buildSwitchUrl);
      } catch (_error) {
        setPendingKnowledgeBaseId(null);
      }
    },
    [
      currentKnowledgeBaseId,
      currentPath,
      shouldRouteSwitchKnowledgeBase,
      transitionTo,
    ],
  );

  return {
    knowledgeBases,
    selectedKnowledgeBaseId,
    pendingKnowledgeBaseId,
    setKnowledgeBases,
    setSelectedKnowledgeBaseId,
    setPendingKnowledgeBaseId,
    loadKnowledgeBases,
    switchKnowledgeBase,
  };
}

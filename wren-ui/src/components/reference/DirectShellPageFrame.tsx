import type { ReactNode } from 'react';
import { useMemo } from 'react';
import useHomeSidebar from '@/hooks/useHomeSidebar';
import { getReferenceDisplayThreadTitle } from '@/utils/referenceDemoKnowledge';
import {
  buildNovaShellNavItems,
  type NovaShellNavKey,
} from './novaShellNavigation';
import DolaAppShell from './DolaAppShell';
import type { DolaShellHistoryItem } from './dolaShellUtils';
import { usePersistentShellEmbedded } from './PersistentShellContext';

type Props = {
  activeNav: NovaShellNavKey;
  flushBottomPadding?: boolean;
  mainPaddingTop?: string;
  stretchContent?: boolean;
  children: ReactNode;
};

export default function DirectShellPageFrame({
  activeNav,
  flushBottomPadding = false,
  mainPaddingTop,
  stretchContent = false,
  children,
}: Props) {
  const embedded = usePersistentShellEmbedded();
  const homeSidebar = useHomeSidebar({
    deferInitialLoad: false,
    loadOnIntent: false,
    disabled: embedded,
  });

  const navItems = useMemo(
    () =>
      buildNovaShellNavItems({
        activeKey: activeNav,
      }),
    [activeNav],
  );
  const historyItems = useMemo(
    () =>
      (homeSidebar.data?.threads || []).map((thread) => ({
        id: thread.id,
        title: getReferenceDisplayThreadTitle(thread.name),
        active: false,
        selector: thread.selector,
      })),
    [homeSidebar.data?.threads],
  );
  const handleHistoryRename = useMemo(
    () =>
      homeSidebar.onRename
        ? (item: DolaShellHistoryItem, nextTitle: string) =>
            homeSidebar.onRename(item.id, nextTitle)
        : undefined,
    [homeSidebar.onRename],
  );
  const handleHistoryDelete = useMemo(
    () =>
      homeSidebar.onDelete
        ? (item: DolaShellHistoryItem) => homeSidebar.onDelete(item.id)
        : undefined,
    [homeSidebar.onDelete],
  );

  if (embedded) {
    return <>{children}</>;
  }

  return (
    <DolaAppShell
      navItems={navItems}
      historyItems={historyItems}
      historyLoading={homeSidebar.loading && historyItems.length === 0}
      historyHasMore={homeSidebar.hasMore}
      historyLoadingMore={homeSidebar.loadingMore}
      onHistoryIntent={homeSidebar.ensureLoaded}
      onHistoryLoadMore={homeSidebar.loadMore}
      onHistoryRename={handleHistoryRename}
      onHistoryDelete={handleHistoryDelete}
      onHistorySearchChange={homeSidebar.setSearchKeyword}
      flushBottomPadding={flushBottomPadding}
      mainPaddingTop={mainPaddingTop}
      stretchContent={stretchContent}
    >
      {children}
    </DolaAppShell>
  );
}

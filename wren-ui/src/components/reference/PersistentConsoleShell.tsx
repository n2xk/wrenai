import { ReactNode, useMemo } from 'react';
import { useRouter } from 'next/router';
import useHomeSidebar from '@/hooks/useHomeSidebar';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { Path } from '@/utils/enum';
import { getReferenceDisplayThreadTitle } from '@/utils/referenceDemoKnowledge';
import DolaAppShell from './DolaAppShell';
import type { DolaShellHistoryItem } from './dolaShellUtils';
import {
  PersistentShellProvider,
  usePersistentShellEmbedded,
} from './PersistentShellContext';
import { buildNovaShellNavItems, NovaShellNavKey } from './novaShellNavigation';

const PERSISTENT_CONSOLE_SHELL_PATHS = new Set<string>([
  Path.Home,
  Path.HomeDashboard,
  Path.HomeSpreadsheets,
  Path.HomeSpreadsheet,
  Path.Thread,
  Path.Knowledge,
]);

export const shouldUsePersistentConsoleShell = (pathname?: string | null) =>
  Boolean(pathname && PERSISTENT_CONSOLE_SHELL_PATHS.has(pathname));

export const shouldKeyRuntimeScopePage = (pathname?: string | null) =>
  !shouldUsePersistentConsoleShell(pathname);

export const resolvePersistentShellActiveNav = (
  pathname?: string | null,
): NovaShellNavKey | undefined => {
  switch (pathname) {
    case Path.Home:
      return 'home';
    case Path.Knowledge:
      return 'knowledge';
    case Path.HomeDashboard:
      return 'dashboard';
    case Path.HomeSpreadsheets:
    case Path.HomeSpreadsheet:
      return 'spreadsheet';
    default:
      return undefined;
  }
};

export const resolvePersistentShellActiveHistoryId = ({
  pathname,
  queryId,
}: {
  pathname?: string | null;
  queryId?: string | string[] | null;
}) => {
  if (pathname !== Path.Thread) {
    return null;
  }

  if (Array.isArray(queryId)) {
    return queryId[0] || null;
  }

  return queryId || null;
};

export const resolvePersistentShellLayoutProps = (pathname?: string | null) => {
  switch (pathname) {
    case Path.Thread:
      return {
        flushMainPadding: true,
        stretchContent: true,
      };
    case Path.Knowledge:
      return {
        flushBottomPadding: true,
        mainPaddingTop: '8px',
        stretchContent: true,
      };
    case Path.HomeDashboard:
    case Path.HomeSpreadsheets:
    case Path.HomeSpreadsheet:
      return {
        mainPaddingTop: '8px',
        stretchContent: true,
      };
    default:
      return {};
  }
};

interface Props {
  children: ReactNode;
}

export default function PersistentConsoleShell({ children }: Props) {
  const router = useRouter();
  const embedded = usePersistentShellEmbedded();
  const enabled = !embedded && shouldUsePersistentConsoleShell(router.pathname);
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const homeSidebar = useHomeSidebar({
    deferInitialLoad: false,
    loadOnIntent: false,
  });

  const activeNav = useMemo(
    () => resolvePersistentShellActiveNav(router.pathname),
    [router.pathname],
  );
  const activeHistoryId = useMemo(
    () =>
      resolvePersistentShellActiveHistoryId({
        pathname: router.pathname,
        queryId: router.query.id as string | string[] | undefined,
      }),
    [router.pathname, router.query.id],
  );
  const layoutProps = useMemo(
    () => resolvePersistentShellLayoutProps(router.pathname),
    [router.pathname],
  );
  const navItems = useMemo(
    () =>
      buildNovaShellNavItems({
        activeKey: activeNav,
        onNavigate: runtimeScopeNavigation.pushWorkspace,
      }),
    [activeNav, runtimeScopeNavigation.pushWorkspace],
  );
  const historyItems = useMemo(() => {
    return (homeSidebar.data?.threads || []).map((thread) => ({
      id: thread.id,
      title: getReferenceDisplayThreadTitle(thread.name),
      active: activeHistoryId ? thread.id === activeHistoryId : false,
      selector: thread.selector,
    }));
  }, [activeHistoryId, homeSidebar.data?.threads]);
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
        ? async (item: DolaShellHistoryItem) => {
            await homeSidebar.onDelete(item.id);
            if (activeHistoryId === item.id) {
              void runtimeScopeNavigation.pushWorkspace(Path.Home);
            }
          }
        : undefined,
    [
      activeHistoryId,
      homeSidebar.onDelete,
      runtimeScopeNavigation.pushWorkspace,
    ],
  );
  const contextValue = useMemo(
    () => ({
      embedded: true,
      refetchHistory: () => homeSidebar.refetch(),
    }),
    [homeSidebar],
  );

  if (!enabled) {
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
      {...layoutProps}
    >
      <PersistentShellProvider value={contextValue}>
        {children}
      </PersistentShellProvider>
    </DolaAppShell>
  );
}

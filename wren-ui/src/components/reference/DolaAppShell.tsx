import { ReactNode, memo, useEffect, useState } from 'react';
import { Divider } from 'antd';
import styled from 'styled-components';
import DolaShellFooterPanel from './DolaShellFooterPanel';
import DolaShellHistoryPane from './DolaShellHistoryPane';
import DolaShellNavPane, { DolaShellBackAction } from './DolaShellNavPane';
import {
  areShellHistoryItemsEqual,
  areShellNavItemsEqual,
  DolaShellHistoryItem,
  DolaShellNavItem,
  shouldShowStableHistoryDuringRefresh,
} from './dolaShellUtils';
import { Main, MainInner, MainTopbar, Shell, Sidebar } from './dolaShellStyles';
import useDolaAppShellSidebarState from './useDolaAppShellSidebarState';

export type { DolaShellBackAction } from './DolaShellNavPane';
export type { DolaShellHistoryItem, DolaShellNavItem } from './dolaShellUtils';
export {
  getCachedShellUiState,
  resolveBackgroundHistoryPrefetchIds,
  resolveBackgroundNavPrefetchKeys,
  resolveHistoryThreadHref,
  resolveHistoryThreadNavigationSelector,
  resolveShellPrefetchUrls,
  resolveShellUiScopeKey,
  shouldPrefetchShellIntent,
  shouldShowStableHistoryDuringRefresh,
} from './dolaShellUtils';

interface Props {
  navItems: DolaShellNavItem[];
  historyItems?: DolaShellHistoryItem[];
  historyLoading?: boolean;
  historyHasMore?: boolean;
  historyLoadingMore?: boolean;
  onHistoryIntent?: () => void;
  onHistoryLoadMore?: () => void;
  onHistoryRename?: (
    item: DolaShellHistoryItem,
    nextTitle: string,
  ) => Promise<void> | void;
  onHistoryDelete?: (item: DolaShellHistoryItem) => Promise<void> | void;
  onHistorySearchChange?: (keyword: string) => void;
  onPrimaryAction?: () => void;
  primaryActionLabel?: string;
  primaryActionIcon?: ReactNode;
  sidebarMeta?: ReactNode;
  historyTitle?: string;
  historySecondaryTitle?: string;
  historyEmptyText?: string;
  searchPlaceholder?: string;
  topbarExtra?: ReactNode;
  onSettingsClick?: () => void;
  hideHistorySection?: boolean;
  sidebarBackAction?: DolaShellBackAction;
  hideSidebarBranding?: boolean;
  hideSidebarFooterPanel?: boolean;
  hideSidebarCollapseToggle?: boolean;
  flushMainPadding?: boolean;
  flushBottomPadding?: boolean;
  mainPaddingTop?: string;
  stretchContent?: boolean;
  children: ReactNode;
}

type SidebarProps = Omit<Props, 'children' | 'topbarExtra'>;

const EMPTY_HISTORY_ITEMS: DolaShellHistoryItem[] = [];

const areDolaAppShellSidebarPropsEqual = (
  previous: SidebarProps,
  next: SidebarProps,
) =>
  previous.historyLoading === next.historyLoading &&
  previous.historyHasMore === next.historyHasMore &&
  previous.historyLoadingMore === next.historyLoadingMore &&
  previous.onHistoryIntent === next.onHistoryIntent &&
  previous.onHistoryLoadMore === next.onHistoryLoadMore &&
  previous.onHistoryRename === next.onHistoryRename &&
  previous.onHistoryDelete === next.onHistoryDelete &&
  previous.onHistorySearchChange === next.onHistorySearchChange &&
  previous.onPrimaryAction === next.onPrimaryAction &&
  previous.primaryActionLabel === next.primaryActionLabel &&
  previous.primaryActionIcon === next.primaryActionIcon &&
  previous.sidebarMeta === next.sidebarMeta &&
  previous.historyTitle === next.historyTitle &&
  previous.historySecondaryTitle === next.historySecondaryTitle &&
  previous.historyEmptyText === next.historyEmptyText &&
  previous.searchPlaceholder === next.searchPlaceholder &&
  previous.onSettingsClick === next.onSettingsClick &&
  previous.hideHistorySection === next.hideHistorySection &&
  previous.hideSidebarBranding === next.hideSidebarBranding &&
  previous.hideSidebarFooterPanel === next.hideSidebarFooterPanel &&
  previous.hideSidebarCollapseToggle === next.hideSidebarCollapseToggle &&
  previous.sidebarBackAction?.label === next.sidebarBackAction?.label &&
  previous.sidebarBackAction?.onClick === next.sidebarBackAction?.onClick &&
  areShellNavItemsEqual(previous.navItems, next.navItems) &&
  areShellHistoryItemsEqual(
    previous.historyItems || [],
    next.historyItems || [],
  );

const DolaAppShellSidebar = memo(function DolaAppShellSidebar({
  navItems,
  historyItems = EMPTY_HISTORY_ITEMS,
  historyLoading = false,
  historyHasMore = false,
  historyLoadingMore = false,
  onHistoryIntent,
  onHistoryLoadMore,
  onHistoryRename,
  onHistoryDelete,
  onHistorySearchChange,
  onPrimaryAction,
  primaryActionLabel = '新对话',
  primaryActionIcon,
  historyTitle = '历史对话',
  historyEmptyText = '暂无历史对话',
  searchPlaceholder = '搜索历史对话',
  onSettingsClick,
  hideHistorySection = false,
  sidebarBackAction,
  hideSidebarBranding = false,
  hideSidebarFooterPanel = false,
  hideSidebarCollapseToggle = false,
}: SidebarProps) {
  const [stableHistoryItems, setStableHistoryItems] = useState(historyItems);
  const showingStableHistoryDuringRefresh =
    shouldShowStableHistoryDuringRefresh({
      historyItems,
      historyLoading,
      stableHistoryItems,
    });
  const displayedHistoryItems = showingStableHistoryDuringRefresh
    ? stableHistoryItems
    : historyItems;

  useEffect(() => {
    if (historyItems.length > 0 || !historyLoading) {
      setStableHistoryItems(historyItems);
    }
  }, [historyItems, historyLoading]);

  const {
    router,
    authSession,
    runtimeScopeNavigation,
    collapsed,
    setCollapsed,
    keyword,
    setKeyword,
    loggingOut,
    historyScrollerRef,
    filteredHistory,
    visibleHistoryItems,
    shouldVirtualizeHistory,
    topSpacerHeight,
    bottomSpacerHeight,
    handleHistoryIntent,
    handleHistoryItemSelect,
    accountDisplayName,
    accountAvatar,
    selectedKeys,
    menuItems,
    footerMenuItems,
    onAccountMenuClick,
    prefetchHistoryRoute,
  } = useDolaAppShellSidebarState({
    navItems,
    historyItems: displayedHistoryItems,
    historyHasMore,
    historyLoading: historyLoading || historyLoadingMore,
    onHistoryIntent,
    onHistoryLoadMore,
    onHistorySearchChange,
    onSettingsClick,
  });

  return (
    <Sidebar
      width={196}
      collapsed={collapsed}
      collapsedWidth={60}
      breakpoint="lg"
      trigger={null}
    >
      <DolaShellNavPane
        collapsed={collapsed}
        isHomeActive={router.pathname === '/home'}
        sidebarBackAction={sidebarBackAction}
        hideBranding={hideSidebarBranding}
        hideCollapseToggle={hideSidebarCollapseToggle}
        hasRuntimeScope={
          runtimeScopeNavigation.hasRuntimeScope && !hideSidebarFooterPanel
        }
        onPrimaryAction={onPrimaryAction}
        primaryActionLabel={primaryActionLabel}
        primaryActionIcon={primaryActionIcon}
        selectedKeys={selectedKeys}
        menuItems={menuItems}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
      />

      <Divider style={{ margin: 0, borderColor: '#f1f5f9' }} />

      {hideHistorySection ? (
        <div style={{ flex: 1 }} />
      ) : (
        <>
          <DolaShellHistoryPane
            collapsed={collapsed}
            historyLoading={
              historyLoading && !showingStableHistoryDuringRefresh
            }
            historyLoadingMore={historyLoadingMore}
            historyStale={showingStableHistoryDuringRefresh}
            historyTitle={historyTitle}
            historyEmptyText={historyEmptyText}
            searchPlaceholder={searchPlaceholder}
            keyword={keyword}
            onHistoryIntent={handleHistoryIntent}
            onKeywordChange={setKeyword}
            historyScrollerRef={historyScrollerRef}
            filteredHistory={filteredHistory}
            visibleHistoryItems={visibleHistoryItems}
            shouldVirtualizeHistory={shouldVirtualizeHistory}
            topSpacerHeight={topSpacerHeight}
            bottomSpacerHeight={bottomSpacerHeight}
            onHistoryPrefetch={prefetchHistoryRoute}
            onHistorySelect={handleHistoryItemSelect}
            onHistoryRename={onHistoryRename}
            onHistoryDelete={onHistoryDelete}
          />
          <Divider style={{ margin: 0, borderColor: '#f1f5f9' }} />
        </>
      )}

      {hideSidebarFooterPanel ? null : (
        <DolaShellFooterPanel
          collapsed={collapsed}
          selectedKeys={selectedKeys}
          footerMenuItems={footerMenuItems}
          onAccountMenuClick={onAccountMenuClick}
          loggingOut={loggingOut}
          authLoading={authSession.loading}
          accountAvatar={accountAvatar}
          accountDisplayName={accountDisplayName}
        />
      )}
    </Sidebar>
  );
}, areDolaAppShellSidebarPropsEqual);

const ContentSlot = styled.div<{ $stretch?: boolean }>`
  display: flex;
  flex-direction: column;
  width: 100%;
  flex: 1 1 auto;
  min-height: 0;
  height: ${(props) => (props.$stretch ? '100%' : 'auto')};
  overflow: ${(props) => (props.$stretch ? 'hidden' : 'visible')};
`;

function DolaAppShellFrame({
  children,
  topbarExtra,
  flushMainPadding = false,
  flushBottomPadding = false,
  mainPaddingTop,
  stretchContent = false,
  ...sidebarProps
}: Props) {
  return (
    <Shell>
      <DolaAppShellSidebar {...sidebarProps} />
      <Main
        $flush={flushMainPadding}
        $flushBottom={flushBottomPadding}
        $paddingTop={mainPaddingTop}
        $stretchContent={stretchContent}
      >
        <MainInner>
          {topbarExtra ? <MainTopbar>{topbarExtra}</MainTopbar> : null}
          <ContentSlot $stretch={stretchContent}>{children}</ContentSlot>
        </MainInner>
      </Main>
    </Shell>
  );
}

export default function DolaAppShell(props: Props) {
  return <DolaAppShellFrame {...props} />;
}

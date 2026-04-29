import { ReactNode, useEffect, useMemo, useRef } from 'react';
import { Card, Layout, Segmented, Skeleton, Typography } from 'antd';
import useHomeSidebar from '@/hooks/useHomeSidebar';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { Path } from '@/utils/enum';
import { getReferenceDisplayThreadTitle } from '@/utils/referenceDemoKnowledge';
import DolaAppShell, {
  DolaShellBackAction,
  DolaShellNavItem,
} from './DolaAppShell';
import type { DolaShellHistoryItem } from './dolaShellUtils';
import { usePersistentShellEmbedded } from './PersistentShellContext';
import { buildNovaShellNavItems, NovaShellNavKey } from './novaShellNavigation';

const { Paragraph, Text, Title } = Typography;

export interface ConsoleSectionItem {
  key: string;
  label: string;
  onClick: () => void;
}

interface Props {
  activeNav?: NovaShellNavKey;
  title: ReactNode;
  description?: ReactNode;
  titleExtra?: ReactNode;
  eyebrow?: ReactNode;
  hideHeader?: boolean;
  contentBorderless?: boolean;
  flushMainPadding?: boolean;
  mainPaddingTop?: string;
  stretchContent?: boolean;
  loading?: boolean;
  children?: ReactNode;
  sections?: ConsoleSectionItem[];
  activeSectionKey?: string;
  navItems?: DolaShellNavItem[];
  activeHistoryId?: string | null;
  hideHistorySection?: boolean;
  sidebarBackAction?: DolaShellBackAction;
  hideSidebarBranding?: boolean;
  hideSidebarFooterPanel?: boolean;
  hideSidebarCollapseToggle?: boolean;
}

export const shouldRefetchConsoleHistory = ({
  activeHistoryId,
  embedded,
  threadIds,
  attemptedHistoryId,
}: {
  activeHistoryId?: string | null;
  embedded: boolean;
  threadIds: string[];
  attemptedHistoryId?: string | null;
}) => {
  if (!activeHistoryId || embedded) {
    return false;
  }

  if (threadIds.includes(activeHistoryId)) {
    return false;
  }

  if (attemptedHistoryId === activeHistoryId) {
    return false;
  }

  return true;
};

const consoleLayoutStyles = `
  .console-table.ant-table-wrapper {
    margin-top: 4px;
  }

  .console-table .ant-table-container {
    border-radius: var(--nova-radius-card) !important;
    overflow: hidden;
    border: 1px solid #e5e7eb;
  }

  .console-table .ant-table,
  .console-table .ant-table-content {
    border-radius: var(--nova-radius-card) !important;
  }

  .console-table .ant-table-content table {
    border-radius: var(--nova-radius-card) var(--nova-radius-card) 0 0 !important;
    overflow: hidden;
  }

  .console-table .ant-table-thead > tr:first-child > th {
    border-radius: 0 !important;
  }

  .console-table .ant-table-thead > tr:first-child > th:first-child {
    border-top-left-radius: var(--nova-radius-card) !important;
    border-start-start-radius: var(--nova-radius-card) !important;
  }

  .console-table .ant-table-thead > tr:first-child > th:last-child {
    border-top-right-radius: var(--nova-radius-card) !important;
    border-start-end-radius: var(--nova-radius-card) !important;
  }

  .console-table .ant-table-thead > tr:first-child > th:only-child {
    border-radius: var(--nova-radius-card) var(--nova-radius-card) 0 0 !important;
  }

  .console-table .ant-table-thead > tr > th {
    background: #f8fafc;
    color: #475467;
    font-weight: 600;
    border-bottom: 1px solid #e5e7eb;
  }

  .console-table .ant-table-tbody > tr > td {
    background: #ffffff;
    border-bottom: 1px solid #eef2f6;
  }

  .console-table .ant-table-tbody > tr:hover > td {
    background: #fcfdff;
  }

  .console-alert.ant-alert {
    border-radius: var(--nova-radius-panel);
  }
`;

const contentWrapperStyle = (stretchContent?: boolean) => ({
  display: stretchContent ? 'flex' : 'block',
  flex: stretchContent ? '1 1 auto' : undefined,
  minHeight: stretchContent ? 0 : undefined,
  height: stretchContent ? '100%' : undefined,
  flexDirection: stretchContent ? ('column' as const) : undefined,
  width: '100%',
});

export default function ConsoleShellLayout({
  activeNav = 'knowledge',
  title,
  description,
  titleExtra,
  eyebrow = '工作台',
  hideHeader,
  contentBorderless,
  flushMainPadding,
  mainPaddingTop,
  stretchContent,
  loading,
  children,
  sections,
  activeSectionKey,
  navItems,
  activeHistoryId,
  hideHistorySection,
  sidebarBackAction,
  hideSidebarBranding,
  hideSidebarFooterPanel,
  hideSidebarCollapseToggle,
}: Props) {
  const embedded = usePersistentShellEmbedded();
  const homeSidebar = useHomeSidebar({
    deferInitialLoad: false,
    loadOnIntent: false,
    disabled: embedded,
  });
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const attemptedActiveHistoryRefetchRef = useRef<string | null>(null);

  const historyItems = useMemo(
    () =>
      (homeSidebar.data?.threads || []).map((thread) => ({
        id: thread.id,
        title: getReferenceDisplayThreadTitle(thread.name),
        active: activeHistoryId ? thread.id === activeHistoryId : false,
        selector: thread.selector,
      })),
    [activeHistoryId, homeSidebar.data?.threads],
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

  useEffect(() => {
    const threadIds = (homeSidebar.data?.threads || []).map(
      (thread) => thread.id,
    );

    if (!activeHistoryId || embedded || threadIds.includes(activeHistoryId)) {
      attemptedActiveHistoryRefetchRef.current = activeHistoryId || null;
      return;
    }

    if (
      !shouldRefetchConsoleHistory({
        activeHistoryId,
        embedded,
        threadIds,
        attemptedHistoryId: attemptedActiveHistoryRefetchRef.current,
      })
    ) {
      return;
    }

    attemptedActiveHistoryRefetchRef.current = activeHistoryId;
    void homeSidebar.refetch();
  }, [activeHistoryId, embedded, homeSidebar]);

  const resolvedNavItems = useMemo<DolaShellNavItem[]>(
    () =>
      navItems ||
      buildNovaShellNavItems({
        activeKey: activeNav,
      }),
    [activeNav, navItems],
  );

  const renderedContent = loading ? (
    <Skeleton active paragraph={{ rows: 8 }} />
  ) : (
    children
  );

  const contentStage = contentBorderless ? (
    <div style={contentWrapperStyle(stretchContent)}>{renderedContent}</div>
  ) : (
    <Card
      variant="borderless"
      style={{
        ...contentWrapperStyle(stretchContent),
        border: '1px solid #e5e7eb',
        borderRadius: 'var(--nova-radius-panel)',
        boxShadow: '0 1px 2px rgba(16, 24, 40, 0.04)',
      }}
      styles={{
        body: {
          display: stretchContent ? 'flex' : 'block',
          flex: stretchContent ? '1 1 auto' : undefined,
          minHeight: stretchContent ? 0 : undefined,
          flexDirection: stretchContent ? 'column' : undefined,
          padding: 24,
        },
      }}
    >
      {renderedContent}
    </Card>
  );

  const selectedSectionKey =
    activeSectionKey || (sections && sections.length ? sections[0].key : null);

  const pageContent = (
    <>
      <style jsx global>
        {consoleLayoutStyles}
      </style>
      <Layout
        style={{
          background: 'transparent',
          minHeight: flushMainPadding ? '100dvh' : 'calc(100vh - 48px)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Layout.Content
          style={{
            background: 'transparent',
            display: 'flex',
            flexDirection: 'column',
            flex: '1 1 auto',
            minHeight: 0,
          }}
        >
          <div
            style={{
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 18,
              flex: stretchContent ? '1 1 auto' : undefined,
              minHeight: flushMainPadding
                ? '100dvh'
                : stretchContent
                  ? 0
                  : undefined,
            }}
          >
            {sections?.length ? (
              <Segmented
                options={sections.map((section) => ({
                  label: section.label,
                  value: section.key,
                }))}
                value={selectedSectionKey || undefined}
                onChange={(nextValue) => {
                  sections
                    .find((section) => section.key === nextValue)
                    ?.onClick();
                }}
                style={{ alignSelf: 'flex-start' }}
              />
            ) : null}

            {!hideHeader ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 24,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ minWidth: 0, maxWidth: 880 }}>
                  {eyebrow ? (
                    <Text
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '4px 10px',
                        borderRadius: 'var(--nova-radius-chip)',
                        background: '#f3f4ff',
                        color: '#6d4aff',
                        fontSize: 12,
                        fontWeight: 600,
                        lineHeight: '20px',
                      }}
                    >
                      {eyebrow}
                    </Text>
                  ) : null}
                  <Title
                    level={2}
                    style={{
                      margin: `${eyebrow ? 16 : 0}px 0 8px`,
                      fontSize: 30,
                      lineHeight: 1.2,
                    }}
                  >
                    {title}
                  </Title>
                  {description ? (
                    <Paragraph
                      style={{
                        marginBottom: 0,
                        maxWidth: 760,
                        fontSize: 15,
                        color: '#667085',
                      }}
                    >
                      {description}
                    </Paragraph>
                  ) : null}
                </div>
                {titleExtra ? (
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    {titleExtra}
                  </div>
                ) : null}
              </div>
            ) : null}

            {contentStage}
          </div>
        </Layout.Content>
      </Layout>
    </>
  );

  if (embedded) {
    return pageContent;
  }

  return (
    <DolaAppShell
      navItems={resolvedNavItems}
      historyItems={historyItems}
      historyLoading={homeSidebar.loading && historyItems.length === 0}
      historyHasMore={homeSidebar.hasMore}
      historyLoadingMore={homeSidebar.loadingMore}
      onHistoryIntent={homeSidebar.ensureLoaded}
      onHistoryLoadMore={homeSidebar.loadMore}
      onHistoryRename={handleHistoryRename}
      onHistoryDelete={handleHistoryDelete}
      onHistorySearchChange={homeSidebar.setSearchKeyword}
      hideHistorySection={hideHistorySection}
      sidebarBackAction={sidebarBackAction}
      hideSidebarBranding={hideSidebarBranding}
      hideSidebarFooterPanel={hideSidebarFooterPanel}
      hideSidebarCollapseToggle={hideSidebarCollapseToggle}
      flushMainPadding={flushMainPadding}
      mainPaddingTop={mainPaddingTop}
      stretchContent={stretchContent}
    >
      {pageContent}
    </DolaAppShell>
  );
}

import { appMessage as message } from '@/utils/antdAppBridge';
import EmptyDashboard from '@/components/pages/home/dashboardGrid/EmptyDashboard';
import DashboardGrid from '@/components/pages/home/dashboardGrid';
import DashboardHeader from '@/components/pages/home/dashboardGrid/DashboardHeader';
import type {
  DashboardGridHandle,
  DashboardGridItem,
} from '@/components/pages/home/dashboardGrid';
import CacheSettingsDrawer from '@/components/pages/home/dashboardGrid/CacheSettingsDrawer';
import type { Schedule } from '@/components/pages/home/dashboardGrid/CacheSettingsDrawer';
import type { DrawerAction } from '@/hooks/useDrawerAction';
import { HISTORICAL_SNAPSHOT_READONLY_HINT } from '@/utils/runtimeSnapshot';

import {
  DashboardStage,
  DashboardStageCanvas,
} from './manageDashboardPageStyles';

export const DashboardWorkbenchStage = (props: {
  cacheSettingsDrawerProps: DrawerAction<any> & { loading?: boolean };
  dashboardName?: string;
  dashboardGridRef: React.RefObject<DashboardGridHandle | null>;
  dashboardItems: DashboardGridItem[];
  dashboardSummaryItems: Array<{
    id: number;
    title: string;
    meta: string;
  }>;
  isDashboardReadonly: boolean;
  isSupportCached: boolean;
  nextScheduleTime?: string | null;
  onCacheSettings: () => void;
  onDeleteItem: (id: number) => Promise<void>;
  onGoToThread: (
    threadId?: number | null,
    responseId?: number | null,
  ) => Promise<void>;
  onItemUpdated: (item: DashboardGridItem) => void;
  onRenameItem: (id: number) => void;
  onRefreshAll: () => void;
  onSelectItem: (id: number) => void;
  onSubmitCacheSettings: (values: any) => Promise<void>;
  onUpdateChange: (layouts: any[]) => Promise<void>;
  readOnlySchedule?: Schedule;
  runtimeScopeSelector: any;
  selectedDashboardItemId?: number | null;
}) => {
  const {
    cacheSettingsDrawerProps,
    dashboardName,
    dashboardGridRef,
    dashboardItems,
    dashboardSummaryItems,
    isDashboardReadonly,
    isSupportCached,
    nextScheduleTime,
    onCacheSettings,
    onDeleteItem,
    onGoToThread,
    onItemUpdated,
    onRenameItem,
    onRefreshAll,
    onSelectItem,
    onSubmitCacheSettings,
    onUpdateChange,
    readOnlySchedule,
    runtimeScopeSelector,
    selectedDashboardItemId,
  } = props;

  return (
    <DashboardStage>
      <DashboardStageCanvas $empty={dashboardItems.length === 0}>
        <EmptyDashboard show={dashboardItems.length === 0}>
          <DashboardHeader
            dashboardName={dashboardName}
            isSupportCached={isSupportCached}
            readOnly={isDashboardReadonly}
            schedule={readOnlySchedule}
            nextScheduleTime={nextScheduleTime ?? undefined}
            outlineItems={dashboardSummaryItems}
            selectedOutlineItemId={selectedDashboardItemId}
            onCacheSettings={() => {
              void onCacheSettings();
            }}
            onDeleteOutlineItem={(itemId) => {
              void onDeleteItem(itemId);
            }}
            onRenameOutlineItem={onRenameItem}
            onSelectOutlineItem={onSelectItem}
            onRefreshAll={() => {
              onRefreshAll();
            }}
          />
          <DashboardGrid
            ref={dashboardGridRef}
            items={dashboardItems}
            isSupportCached={isSupportCached}
            readOnly={isDashboardReadonly}
            runtimeScopeSelector={runtimeScopeSelector}
            onUpdateChange={onUpdateChange}
            onDelete={onDeleteItem}
            onItemUpdated={onItemUpdated}
            onNavigateToThread={onGoToThread}
          />
        </EmptyDashboard>
      </DashboardStageCanvas>
      {isSupportCached ? (
        <CacheSettingsDrawer
          {...cacheSettingsDrawerProps}
          onSubmit={async (values) => {
            if (isDashboardReadonly) {
              message.info(HISTORICAL_SNAPSHOT_READONLY_HINT);
              return;
            }
            await onSubmitCacheSettings(values);
          }}
        />
      ) : null}
    </DashboardStage>
  );
};

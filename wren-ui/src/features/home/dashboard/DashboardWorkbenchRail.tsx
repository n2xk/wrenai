import {
  ClockCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  StarOutlined,
} from '@ant-design/icons';
import type { KeyboardEvent } from 'react';
import {
  Button,
  Dropdown,
  Empty,
  Tag,
  Tooltip,
  Typography,
  type MenuProps,
} from 'antd';
import styled from 'styled-components';

import { resolveDashboardDisplayName } from '@/utils/dashboardRest';

import {
  DashboardRail,
  DashboardRailCard,
  DashboardRailCreateButton,
  DashboardRailItem,
  DashboardRailItemBody,
  DashboardRailItemMenuButton,
  DashboardRailList,
  DashboardRailSection,
  DashboardRailSectionCount,
  DashboardRailSectionHeader,
  DashboardRailSectionTitle,
  DashboardRailTitle,
} from './manageDashboardPageStyles';

const DashboardRailCollapseButton = styled(Button)`
  &.ant-btn {
    width: 26px;
    height: 26px;
    min-width: 26px;
    padding: 0;
    border: none;
    box-shadow: none;
    color: var(--nova-text-secondary);
  }
`;

const DashboardRailHeaderActions = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 4px;
`;

const CollapsedDashboardRailCard = styled(DashboardRailCard)`
  .ant-card-body {
    align-items: center;
    padding: 8px 6px;
  }
`;

const CollapsedDashboardRailLabel = styled.div`
  writing-mode: vertical-rl;
  letter-spacing: 0.08em;
  color: var(--nova-text-secondary);
  font-size: 11px;
  font-weight: 600;
  margin-top: 6px;
`;

export const DashboardWorkbenchRail = (props: {
  activeDashboardId: number | null;
  canShowCacheSettings: boolean;
  collapsed?: boolean;
  dashboards: Array<{
    id: number;
    isDefault?: boolean | null;
    name: string;
    cacheEnabled?: boolean | null;
    scheduleFrequency?: string | null;
  }>;
  dashboardMutationTargetId: number | null;
  isDashboardReadonly: boolean;
  onCacheSettings: (dashboardId?: number) => void;
  onCreateDashboard: () => void;
  onDeleteDashboard: (dashboardId: number) => void;
  onRefreshDashboard: (dashboardId?: number) => void;
  onRenameDashboard: (dashboardId: number) => void;
  onSelectDashboard: (dashboardId: number) => void;
  onSetDefaultDashboard: (dashboardId: number) => void;
  onToggleCollapsed: () => void;
}) => {
  const {
    activeDashboardId,
    canShowCacheSettings,
    collapsed = false,
    dashboards,
    dashboardMutationTargetId,
    isDashboardReadonly,
    onCacheSettings,
    onCreateDashboard,
    onDeleteDashboard,
    onRefreshDashboard,
    onRenameDashboard,
    onSelectDashboard,
    onSetDefaultDashboard,
    onToggleCollapsed,
  } = props;

  const handleRailItemKeyDown =
    (onActivate: () => void) => (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }

      event.preventDefault();
      onActivate();
    };

  if (collapsed) {
    return (
      <DashboardRail>
        <CollapsedDashboardRailCard variant="borderless">
          <Tooltip title="展开看板列表" placement="right">
            <DashboardRailCollapseButton
              type="text"
              icon={<MenuUnfoldOutlined />}
              onClick={onToggleCollapsed}
            />
          </Tooltip>
          <DashboardRailSectionCount>
            {dashboards.length}
          </DashboardRailSectionCount>
          <CollapsedDashboardRailLabel>看板</CollapsedDashboardRailLabel>
        </CollapsedDashboardRailCard>
      </DashboardRail>
    );
  }

  return (
    <DashboardRail>
      <DashboardRailCard variant="borderless">
        <DashboardRailSection>
          <DashboardRailSectionHeader>
            <DashboardRailSectionTitle>看板</DashboardRailSectionTitle>
            <DashboardRailHeaderActions>
              <DashboardRailSectionCount>
                {dashboards.length}
              </DashboardRailSectionCount>
              <Tooltip title="收起列表，扩大看板区域">
                <DashboardRailCollapseButton
                  type="text"
                  icon={<MenuFoldOutlined />}
                  onClick={onToggleCollapsed}
                />
              </Tooltip>
            </DashboardRailHeaderActions>
          </DashboardRailSectionHeader>
          <DashboardRailList>
            {dashboards.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="没有匹配的看板"
              />
            ) : (
              dashboards.map((dashboard) => {
                const isMutating = dashboardMutationTargetId === dashboard.id;
                const isActiveDashboard = activeDashboardId === dashboard.id;
                const menuItems: NonNullable<MenuProps['items']> = [
                  {
                    key: 'refresh',
                    icon: <ReloadOutlined />,
                    label: '刷新看板',
                    disabled: isDashboardReadonly || isMutating,
                    onClick: () => onRefreshDashboard(dashboard.id),
                  },
                  ...(canShowCacheSettings
                    ? [
                        {
                          key: 'cache-settings',
                          icon: <ClockCircleOutlined />,
                          label: '缓存与调度',
                          disabled: isDashboardReadonly || isMutating,
                          onClick: () => onCacheSettings(dashboard.id),
                        },
                      ]
                    : []),
                  {
                    key: 'rename',
                    icon: <EditOutlined />,
                    label: '重命名',
                    disabled: isDashboardReadonly || isMutating,
                    onClick: () => onRenameDashboard(dashboard.id),
                  },
                  ...(!dashboard.isDefault
                    ? [
                        {
                          key: 'default',
                          icon: <StarOutlined />,
                          label: '设为默认',
                          disabled: isDashboardReadonly || isMutating,
                          onClick: () => onSetDefaultDashboard(dashboard.id),
                        },
                      ]
                    : []),
                  {
                    key: 'delete',
                    icon: <DeleteOutlined />,
                    label: '删除看板',
                    danger: true,
                    disabled: isDashboardReadonly || isMutating,
                    onClick: () => onDeleteDashboard(dashboard.id),
                  },
                ];

                return (
                  <DashboardRailItem
                    key={dashboard.id}
                    $active={isActiveDashboard}
                    aria-pressed={isActiveDashboard}
                    onClick={() => onSelectDashboard(dashboard.id)}
                    onKeyDown={handleRailItemKeyDown(() =>
                      onSelectDashboard(dashboard.id),
                    )}
                  >
                    <DashboardRailItemBody>
                      <DashboardRailTitle>
                        <Typography.Text ellipsis style={{ marginBottom: 0 }}>
                          {resolveDashboardDisplayName(dashboard.name)}
                        </Typography.Text>
                        {dashboard.isDefault ? (
                          <Tag color="purple">默认</Tag>
                        ) : null}
                      </DashboardRailTitle>
                    </DashboardRailItemBody>
                    <Dropdown
                      menu={{
                        items: menuItems,
                        onClick: ({ domEvent }) => domEvent.stopPropagation(),
                      }}
                      placement="bottomRight"
                      trigger={['click']}
                    >
                      <DashboardRailItemMenuButton
                        type="text"
                        loading={isMutating}
                        icon={<MoreOutlined />}
                        onClick={(event) => event.stopPropagation()}
                      />
                    </Dropdown>
                  </DashboardRailItem>
                );
              })
            )}
          </DashboardRailList>
          <DashboardRailCreateButton
            block
            disabled={isDashboardReadonly}
            icon={<PlusOutlined />}
            onClick={onCreateDashboard}
          >
            新建看板
          </DashboardRailCreateButton>
        </DashboardRailSection>
      </DashboardRailCard>
    </DashboardRail>
  );
};

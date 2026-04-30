import {
  Button,
  Drawer,
  Dropdown,
  Empty,
  List,
  Tooltip,
  Typography,
  type MenuProps,
} from 'antd';
import { useState } from 'react';
import styled from 'styled-components';
import DeleteOutlined from '@ant-design/icons/DeleteOutlined';
import EditOutlined from '@ant-design/icons/EditOutlined';
import MoreOutlined from '@ant-design/icons/MoreOutlined';
import UnorderedListOutlined from '@ant-design/icons/UnorderedListOutlined';
import { MoreIcon } from '@/utils/icons';
import { MORE_ACTION } from '@/utils/enum';
import { getCompactTime } from '@/utils/time';
import { DashboardDropdown } from '@/components/diagram/CustomDropdown';
import { getScheduleText } from '@/components/pages/home/dashboardGrid/CacheSettingsDrawer';
import type { Schedule } from '@/components/pages/home/dashboardGrid/CacheSettingsDrawer';

interface Props {
  dashboardName?: string;
  isSupportCached: boolean;
  readOnly?: boolean;
  nextScheduleTime?: string;
  schedule?: Schedule;
  outlineItems?: Array<{
    id: number;
    title: string;
    meta?: string;
  }>;
  selectedOutlineItemId?: number | null;
  onCacheSettings?: () => void;
  onDeleteOutlineItem?: (itemId: number) => void;
  onRenameOutlineItem?: (itemId: number) => void;
  onSelectOutlineItem?: (itemId: number) => void;
  onRefreshAll?: () => void;
}

const StyledHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 46px;
  padding: 7px 14px;
  background: linear-gradient(180deg, #fcfcff 0%, #f7f8fe 100%);
  border-bottom: 1px solid var(--nova-outline-soft);
`;

const HeaderMeta = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--nova-text-secondary);
  font-size: 12px;
  line-height: 1.4;

  .cursor-pointer {
    color: var(--nova-text-secondary);
  }
`;

const HeaderHint = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  color: #252b3a;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const HeaderActions = styled.div`
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
`;

const OutlineButton = styled(Button)`
  &.ant-btn {
    height: 30px;
    border-radius: var(--nova-radius-control);
    box-shadow: none;
    font-size: 12px;
  }
`;

const OutlineItem = styled.div<{ $active?: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  padding: 7px 6px 7px 8px;
  border-radius: var(--nova-radius-control);
  background: ${(props) =>
    props.$active ? 'rgba(111, 71, 255, 0.07)' : 'transparent'};
  cursor: pointer;
  transition: background 0.18s ease;

  &:hover {
    background: ${(props) =>
      props.$active ? 'rgba(111, 71, 255, 0.09)' : '#f7f8fb'};
  }
`;

const OutlineItemBody = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

export default function DashboardHeader(props: Props) {
  const {
    dashboardName,
    isSupportCached,
    readOnly = false,
    nextScheduleTime,
    outlineItems = [],
    schedule,
    selectedOutlineItemId,
    onCacheSettings,
    onDeleteOutlineItem,
    onRenameOutlineItem,
    onSelectOutlineItem,
    onRefreshAll,
  } = props;
  const [outlineOpen, setOutlineOpen] = useState(false);

  const scheduleTime = schedule ? getScheduleText(schedule) : '';

  const onMoreClick = (action: MORE_ACTION | { type: MORE_ACTION }) => {
    const actionType =
      typeof action === 'object' && action !== null ? action.type : action;
    if (actionType === MORE_ACTION.CACHE_SETTINGS) {
      onCacheSettings?.();
    } else if (actionType === MORE_ACTION.REFRESH) {
      onRefreshAll?.();
    }
  };

  return (
    <StyledHeader>
      <HeaderHint title={dashboardName || '数据看板'}>
        {dashboardName || '数据看板'}
      </HeaderHint>
      <HeaderActions>
        <OutlineButton
          icon={<UnorderedListOutlined />}
          disabled={outlineItems.length === 0}
          onClick={() => setOutlineOpen(true)}
        >
          图表目录 {outlineItems.length}
        </OutlineButton>
        {schedule && (
          <HeaderMeta>
            {isSupportCached && (
              <>
                {nextScheduleTime ? (
                  <Tooltip
                    placement="bottom"
                    title={
                      <>
                        <div>
                          <span className="gray-6">下次刷新：</span>{' '}
                          {getCompactTime(nextScheduleTime)}
                        </div>
                        {schedule.cron && (
                          <div>
                            <span className="gray-6">Cron 表达式：</span>{' '}
                            {schedule.cron}
                          </div>
                        )}
                      </>
                    }
                  >
                    <span className="cursor-pointer">{scheduleTime}</span>
                  </Tooltip>
                ) : (
                  scheduleTime
                )}
              </>
            )}
            <DashboardDropdown
              onMoreClick={onMoreClick}
              isSupportCached={isSupportCached}
              disableCacheSettings={readOnly}
              disableRefresh={readOnly}
            >
              <Button type="text" icon={<MoreIcon className="gray-8" />} />
            </DashboardDropdown>
          </HeaderMeta>
        )}
      </HeaderActions>
      <Drawer
        title="图表目录"
        placement="right"
        width={360}
        open={outlineOpen}
        onClose={() => setOutlineOpen(false)}
      >
        {outlineItems.length === 0 ? (
          <Empty description="当前看板暂无固定图表" />
        ) : (
          <List
            dataSource={outlineItems}
            renderItem={(item) => {
              const menuItems: NonNullable<MenuProps['items']> = [
                {
                  key: 'rename',
                  icon: <EditOutlined />,
                  label: '重命名',
                  disabled: readOnly,
                  onClick: () => onRenameOutlineItem?.(item.id),
                },
                {
                  key: 'delete',
                  icon: <DeleteOutlined />,
                  label: '删除图表',
                  danger: true,
                  disabled: readOnly,
                  onClick: () => onDeleteOutlineItem?.(item.id),
                },
              ];

              return (
                <List.Item style={{ padding: '3px 0', borderBlockEnd: 0 }}>
                  <OutlineItem
                    $active={selectedOutlineItemId === item.id}
                    onClick={() => {
                      onSelectOutlineItem?.(item.id);
                      setOutlineOpen(false);
                    }}
                  >
                    <OutlineItemBody>
                      <Typography.Text ellipsis style={{ marginBottom: 0 }}>
                        {item.title}
                      </Typography.Text>
                      {item.meta ? (
                        <Typography.Text type="secondary">
                          {item.meta}
                        </Typography.Text>
                      ) : null}
                    </OutlineItemBody>
                    <Dropdown
                      menu={{
                        items: menuItems,
                        onClick: ({ domEvent }) => domEvent.stopPropagation(),
                      }}
                      placement="bottomRight"
                      trigger={['click']}
                    >
                      <Button
                        type="text"
                        size="small"
                        icon={<MoreOutlined />}
                        onClick={(event) => event.stopPropagation()}
                      />
                    </Dropdown>
                  </OutlineItem>
                </List.Item>
              );
            }}
          />
        )}
      </Drawer>
    </StyledHeader>
  );
}

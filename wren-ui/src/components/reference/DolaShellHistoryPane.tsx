import { type RefObject, useState } from 'react';
import {
  Button,
  Dropdown,
  Input,
  Modal,
  Typography,
  type MenuProps,
} from 'antd';
import DeleteOutlined from '@ant-design/icons/DeleteOutlined';
import EditOutlined from '@ant-design/icons/EditOutlined';
import MoreOutlined from '@ant-design/icons/MoreOutlined';
import SearchOutlined from '@ant-design/icons/SearchOutlined';
import styled from 'styled-components';
import { appModal } from '@/utils/antdAppBridge';
import {
  DolaShellHistoryItem,
  hasShellHistoryIntent,
  shouldPrefetchShellIntent,
} from './dolaShellUtils';

const { Text } = Typography;

export const normalizeHistoryDisplayTitle = (title: string) => {
  const normalizedTitle = title.replace(/(?:\s*(?:\.{2,}|…|⋯|。{2,}))+$/u, '');
  return normalizedTitle.trimEnd() || title;
};

type Props = {
  collapsed: boolean;
  historyLoading: boolean;
  historyLoadingMore: boolean;
  historyStale?: boolean;
  historyTitle: string;
  historyEmptyText: string;
  searchPlaceholder: string;
  keyword: string;
  onHistoryIntent: () => void;
  onKeywordChange: (keyword: string) => void;
  historyScrollerRef: RefObject<HTMLDivElement | null>;
  filteredHistory: DolaShellHistoryItem[];
  visibleHistoryItems: DolaShellHistoryItem[];
  shouldVirtualizeHistory: boolean;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  onHistoryPrefetch: (item: DolaShellHistoryItem) => void;
  onHistorySelect: (item: DolaShellHistoryItem) => void;
  onHistoryRename?: (
    item: DolaShellHistoryItem,
    nextTitle: string,
  ) => Promise<void> | void;
  onHistoryDelete?: (item: DolaShellHistoryItem) => Promise<void> | void;
};

const SearchInput = styled(Input)`
  &&& {
    --ant-color-bg-container: #f8fafc;
    --ant-color-border: transparent;
    --ant-input-hover-bg: #ffffff;
    --ant-input-hover-border-color: #dce3ee;
    --ant-input-active-bg: #ffffff;
    --ant-input-active-border-color: #dce3ee;
    --ant-input-active-shadow: 0 0 0 2px rgba(99, 102, 241, 0.08);

    height: 30px;
    border-radius: var(--nova-radius-control);
    border-color: transparent !important;
    background: #f8fafc !important;
    padding-inline: 10px;
    box-shadow: none;

    &:hover,
    &:focus,
    &.ant-input-affix-wrapper-focused {
      background: #ffffff !important;
      border-color: #dce3ee !important;
      box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.08);
    }

    .ant-input-prefix {
      margin-inline-end: 7px;
      color: #b5bfcc;
      font-size: 13px;
    }

    .ant-input {
      font-size: 12.5px;
      color: #475569;
      background: transparent;
    }

    .ant-input::placeholder {
      color: #c3cbd6;
    }
  }
`;

const HistorySection = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 var(--dola-shell-sidebar-inline-pad);
`;

const HistoryTitle = styled.div`
  color: #334155;
  font-size: 12.5px;
  line-height: 1.35;
  font-weight: 600;
`;

const HistoryScroller = styled.div<{ $stale?: boolean }>`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0;
  margin-right: calc(0px - var(--dola-shell-sidebar-inline-pad) - 8px);
  padding-right: calc(var(--dola-shell-sidebar-inline-pad) + 5px);
  opacity: ${(props) => (props.$stale ? 0.62 : 1)};
  transition: opacity 0.16s ease;
  scrollbar-width: thin;
  scrollbar-color: rgba(148, 163, 184, 0.34) transparent;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-thumb {
    border-radius: var(--nova-radius-chip);
    background: rgba(148, 163, 184, 0.28);
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }
`;

const HistoryItem = styled.div<{ $active?: boolean; $disabled?: boolean }>`
  min-height: 29px;
  border: 0;
  border-radius: var(--nova-radius-control);
  padding: 4px 1px 4px 8px;
  display: flex;
  align-items: center;
  gap: 1px;
  text-align: left;
  background: ${(props) =>
    props.$active ? 'rgba(123, 87, 232, 0.07)' : 'transparent'};
  color: ${(props) =>
    props.$disabled ? '#a7b0bd' : props.$active ? '#5b45c8' : '#718096'};
  cursor: ${(props) => (props.$disabled ? 'not-allowed' : 'pointer')};
  user-select: none;
  transition:
    background 0.16s ease,
    color 0.16s ease;

  &:hover,
  &:focus-within {
    background: ${(props) =>
      props.$active ? 'rgba(123, 87, 232, 0.1)' : 'rgba(241, 245, 249, 0.72)'};
    color: ${(props) =>
      props.$disabled ? '#a7b0bd' : props.$active ? '#4f35b5' : '#334155'};
  }

  &:focus-within {
    outline: none;
    box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.1);
  }
`;

const HistoryItemSelectButton = styled.button.attrs({ type: 'button' })`
  flex: 1 1 auto;
  min-width: 0;
  min-height: 22px;
  border: 0;
  padding: 0;
  display: flex;
  align-items: center;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: inherit;

  &:focus {
    outline: none;
  }

  &:disabled {
    cursor: not-allowed;
  }
`;

const HistoryMoreButton = styled(Button)<{ $active?: boolean }>`
  && {
    flex: 0 0 auto;
    width: 18px;
    height: 22px;
    min-width: 18px;
    padding: 0;
    border: none;
    box-shadow: none;
    border-radius: var(--nova-radius-control);
    background: ${(props) =>
      props.$active ? 'rgba(123, 87, 232, 0.08)' : 'transparent'};
    color: ${(props) => (props.$active ? '#6d4aff' : '#9aa6b5')};
    opacity: ${(props) => (props.$active ? 0.82 : 0.34)};
    transition:
      opacity 0.16s ease,
      color 0.16s ease,
      background 0.16s ease;
  }

  ${HistoryItem}:hover &&,
  ${HistoryItem}:focus-within &&,
  &&.ant-dropdown-open {
    opacity: 1;
    background: ${(props) =>
      props.$active ? 'rgba(123, 87, 232, 0.1)' : 'rgba(148, 163, 184, 0.1)'};
  }

  &&:hover,
  &&:focus-visible {
    background: rgba(99, 102, 241, 0.1);
    color: #5b45c8;
  }
`;

const RenameInput = styled(Input)`
  && {
    margin-top: 12px;
  }
`;

const HistoryTextStack = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
`;

const HistoryPrimaryText = styled.div`
  font-size: 12.5px;
  line-height: 1.32;
  font-weight: 400;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const HistorySecondaryText = styled.div`
  font-size: 11.5px;
  line-height: 1.35;
  color: #6b7280;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export default function DolaShellHistoryPane({
  collapsed,
  historyLoading,
  historyLoadingMore,
  historyStale = false,
  historyTitle,
  historyEmptyText,
  searchPlaceholder,
  keyword,
  onHistoryIntent,
  onKeywordChange,
  historyScrollerRef,
  filteredHistory,
  visibleHistoryItems,
  shouldVirtualizeHistory,
  topSpacerHeight,
  bottomSpacerHeight,
  onHistoryPrefetch,
  onHistorySelect,
  onHistoryRename,
  onHistoryDelete,
}: Props) {
  const [renameTarget, setRenameTarget] = useState<DolaShellHistoryItem | null>(
    null,
  );
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const hasHistoryActions = Boolean(onHistoryRename || onHistoryDelete);

  if (collapsed) {
    return <div style={{ flex: 1 }} />;
  }

  const activateHistoryItem = (item: DolaShellHistoryItem) => {
    if (historyStale) {
      return;
    }
    if (
      shouldPrefetchShellIntent({
        active: item.active,
        hasAction: hasShellHistoryIntent(item),
      })
    ) {
      void onHistoryPrefetch(item);
    }
    onHistorySelect(item);
  };

  const openRename = (item: DolaShellHistoryItem) => {
    setRenameTarget(item);
    setRenameValue(item.title);
  };

  const closeRename = () => {
    if (renaming) {
      return;
    }
    setRenameTarget(null);
    setRenameValue('');
  };

  const submitRename = async () => {
    if (!renameTarget || !onHistoryRename) {
      return;
    }

    const nextTitle = renameValue.trim();
    if (!nextTitle) {
      return;
    }

    if (nextTitle === renameTarget.title.trim()) {
      closeRename();
      return;
    }

    setRenaming(true);
    try {
      await onHistoryRename(renameTarget, nextTitle);
      setRenameTarget(null);
      setRenameValue('');
    } finally {
      setRenaming(false);
    }
  };

  const confirmDelete = (item: DolaShellHistoryItem) => {
    if (!onHistoryDelete) {
      return;
    }

    appModal.confirm({
      title: '删除这个对话？',
      content: `删除「${item.title}」后无法恢复。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await onHistoryDelete(item);
      },
    });
  };

  const buildHistoryMenuItems = (
    item: DolaShellHistoryItem,
  ): NonNullable<MenuProps['items']> => [
    ...(onHistoryRename
      ? [
          {
            key: 'rename',
            icon: <EditOutlined />,
            label: '重命名',
            onClick: () => openRename(item),
          },
        ]
      : []),
    ...(onHistoryDelete
      ? [
          {
            key: 'delete',
            icon: <DeleteOutlined />,
            label: '删除',
            danger: true,
            onClick: () => confirmDelete(item),
          },
        ]
      : []),
  ];

  return (
    <>
      <HistorySection onPointerDown={onHistoryIntent}>
        <HistoryTitle>{historyTitle}</HistoryTitle>

        <SearchInput
          prefix={<SearchOutlined aria-hidden />}
          placeholder={searchPlaceholder}
          value={keyword}
          onFocus={onHistoryIntent}
          onChange={(event) => {
            onHistoryIntent();
            onKeywordChange(event.target.value);
          }}
        />

        <HistoryScroller
          ref={historyScrollerRef}
          data-testid="shell-history-scroller"
          $stale={historyStale}
        >
          {historyStale ? (
            <Text type="secondary" style={{ fontSize: 12, padding: '2px 4px' }}>
              正在加载最新历史列表，保留上次结果…
            </Text>
          ) : null}
          {filteredHistory.length === 0 && historyLoading ? (
            <Text type="secondary" style={{ fontSize: 13, padding: '8px 4px' }}>
              加载历史对话中...
            </Text>
          ) : filteredHistory.length === 0 ? (
            <Text type="secondary" style={{ fontSize: 13, padding: '8px 4px' }}>
              {historyEmptyText}
            </Text>
          ) : (
            <>
              {shouldVirtualizeHistory && topSpacerHeight > 0 ? (
                <div style={{ height: topSpacerHeight }} aria-hidden />
              ) : null}
              {visibleHistoryItems.map((item) => {
                const displayTitle = normalizeHistoryDisplayTitle(item.title);

                return (
                  <HistoryItem
                    key={item.id}
                    $active={item.active}
                    $disabled={historyStale}
                    onMouseEnter={() => {
                      if (!historyStale) {
                        onHistoryPrefetch(item);
                      }
                    }}
                    onFocus={() => {
                      if (!historyStale) {
                        onHistoryPrefetch(item);
                      }
                    }}
                  >
                    <HistoryItemSelectButton
                      disabled={historyStale}
                      aria-current={item.active ? 'page' : undefined}
                      onClick={() => activateHistoryItem(item)}
                    >
                      <HistoryTextStack>
                        <HistoryPrimaryText title={item.title}>
                          {displayTitle}
                        </HistoryPrimaryText>
                        {item.subtitle ? (
                          <HistorySecondaryText title={item.subtitle}>
                            {item.subtitle}
                          </HistorySecondaryText>
                        ) : null}
                      </HistoryTextStack>
                    </HistoryItemSelectButton>
                    {hasHistoryActions ? (
                      <Dropdown
                        menu={{
                          items: buildHistoryMenuItems(item),
                          onClick: ({ domEvent }) => domEvent.stopPropagation(),
                        }}
                        placement="bottomRight"
                        trigger={['click']}
                        disabled={historyStale}
                      >
                        <HistoryMoreButton
                          type="text"
                          aria-label={`更多操作：${item.title}`}
                          $active={item.active}
                          icon={<MoreOutlined />}
                          onClick={(event) => {
                            event.stopPropagation();
                          }}
                        />
                      </Dropdown>
                    ) : null}
                  </HistoryItem>
                );
              })}
              {shouldVirtualizeHistory && bottomSpacerHeight > 0 ? (
                <div style={{ height: bottomSpacerHeight }} aria-hidden />
              ) : null}
              {historyLoadingMore ? (
                <Text
                  type="secondary"
                  style={{
                    display: 'block',
                    fontSize: 12,
                    padding: '8px 10px',
                    textAlign: 'center',
                  }}
                >
                  加载更多历史对话中...
                </Text>
              ) : null}
            </>
          )}
        </HistoryScroller>
      </HistorySection>

      <Modal
        title="重命名对话"
        open={Boolean(renameTarget)}
        confirmLoading={renaming}
        okText="保存"
        cancelText="取消"
        okButtonProps={{ disabled: renameValue.trim().length === 0 }}
        onCancel={closeRename}
        onOk={submitRename}
        destroyOnHidden
      >
        <RenameInput
          autoFocus
          placeholder="输入新的对话名称"
          value={renameValue}
          maxLength={80}
          onChange={(event) => setRenameValue(event.target.value)}
          onPressEnter={() => {
            void submitRename();
          }}
        />
      </Modal>
    </>
  );
}

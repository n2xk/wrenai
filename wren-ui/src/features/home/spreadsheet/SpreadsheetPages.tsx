import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Dropdown,
  Drawer,
  Empty,
  Input,
  List,
  Modal,
  Pagination,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  type MenuProps,
} from 'antd';
import ArrowDownOutlined from '@ant-design/icons/ArrowDownOutlined';
import ArrowUpOutlined from '@ant-design/icons/ArrowUpOutlined';
import CodeOutlined from '@ant-design/icons/CodeOutlined';
import DeleteOutlined from '@ant-design/icons/DeleteOutlined';
import EditOutlined from '@ant-design/icons/EditOutlined';
import HistoryOutlined from '@ant-design/icons/HistoryOutlined';
import FolderOutlined from '@ant-design/icons/FolderOutlined';
import MoreOutlined from '@ant-design/icons/MoreOutlined';
import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import RobotOutlined from '@ant-design/icons/RobotOutlined';
import SaveOutlined from '@ant-design/icons/SaveOutlined';
import SettingOutlined from '@ant-design/icons/SettingOutlined';
import ShareAltOutlined from '@ant-design/icons/ShareAltOutlined';
import TableOutlined from '@ant-design/icons/TableOutlined';
import styled from 'styled-components';
import PreviewData from '@/components/dataPreview/PreviewData';
import DirectShellPageFrame from '@/components/reference/DirectShellPageFrame';
import useHomeSpreadsheets from '@/hooks/useHomeSpreadsheets';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import {
  loadSpreadsheetDetailPayload,
  previewSpreadsheet,
  runSpreadsheetAiOperation,
  saveSpreadsheetVersion,
  deleteSpreadsheet,
  updateSpreadsheet,
  updateSpreadsheetSetting,
  type SpreadsheetAiOperationType,
  type SpreadsheetDetailData,
  type SpreadsheetListItem,
  type SpreadsheetPreviewData,
} from '@/utils/spreadsheetRest';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import { appMessage, appModal } from '@/utils/antdAppBridge';
import {
  DashboardRail,
  DashboardRailCard,
  DashboardRailCreateButton,
  DashboardRailItem,
  DashboardRailItemBody,
  DashboardRailItemMenuButton,
  DashboardRailItemRow,
  DashboardRailList,
  DashboardRailSection,
  DashboardRailSectionCount,
  DashboardRailSectionHeader,
  DashboardRailSectionTitle,
  DashboardRailTitle,
  DashboardWorkbench,
} from '../dashboard/manageDashboardPageStyles';

const SQLCodeBlock = dynamic(() => import('@/components/code/SQLCodeBlock'), {
  ssr: false,
});

const { Text, Title } = Typography;

const HeaderCard = styled(Card)`
  border-radius: 14px;
  border-color: rgba(15, 23, 42, 0.06);
  box-shadow: none;

  .ant-card-body {
    padding: 12px 14px;
  }
`;

const HeaderRow = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
`;

const TitleBlock = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
`;

const MetaLine = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  color: #7a8294;
  font-size: 11px;
  line-height: 1.4;

  .ant-tag {
    margin-inline-end: 0;
    border-radius: 999px;
    font-size: 10px;
    line-height: 17px;
    padding-inline: 7px;
  }
`;

const ContentCard = styled(Card)`
  flex: 0 1 auto;
  min-height: 0;
  overflow: hidden;
  border-radius: 14px;
  border-color: rgba(15, 23, 42, 0.06);
  box-shadow: none;

  .ant-card-body {
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 8px 10px 6px;
  }
`;

const ToolbarCard = styled(Card)`
  border-radius: 14px;
  border-color: rgba(15, 23, 42, 0.06);
  box-shadow: none;

  .ant-card-body {
    padding: 10px 12px;
  }
`;

const Toolbelt = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
`;

const ToolGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
`;

const ToolGroupLabel = styled.span<{ $accent?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: ${(props) => (props.$accent ? '0 8px' : '0')};
  border-radius: 8px;
  background: ${(props) =>
    props.$accent ? 'rgba(111, 71, 255, 0.1)' : 'transparent'};
  color: ${(props) => (props.$accent ? '#5d3ce0' : '#8a93a5')};
  font-size: ${(props) => (props.$accent ? '12px' : '11px')};
  line-height: 1;
  font-weight: 600;

  .anticon {
    font-size: 12px;
  }
`;

const HeaderActions = styled.div`
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 7px;

  .ant-btn {
    height: 30px;
    border-radius: 9px;
    font-size: 12px;
  }
`;

const SpreadsheetTitleLine = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;

  .anticon {
    flex: 0 0 auto;
    color: #4b5565;
  }

  .ant-typography {
    flex: 1 1 auto;
    min-width: 0;
    max-width: none;
    font-size: 20px;
    line-height: 1.25;
    font-weight: 650;
    letter-spacing: -0.02em;
    color: #202635;
  }
`;

const SourceQuestion = styled.span`
  display: inline-block;
  max-width: min(720px, 54vw);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
`;

const ToolbarHint = styled.span`
  color: #8a93a5;
  font-size: 11px;
`;

const SpreadsheetPreviewShell = styled.div`
  min-height: 0;

  .spreadsheet-preview {
    min-height: 0;

    > div:first-child {
      margin-bottom: 6px;
    }
  }

  .ant-table-wrapper {
    min-height: 0;
  }

  .ant-table {
    font-size: 13px;
    color: #283044;
    font-variant-numeric: tabular-nums;
  }

  .ant-table-thead > tr > th {
    height: 34px;
    padding: 7px 10px;
    background: #f6f7fb;
    color: #687083;
    font-size: 12px;
    font-weight: 600;
    border-color: rgba(15, 23, 42, 0.08);
  }

  .ant-table-tbody > tr > td {
    height: 36px;
    padding: 7px 10px;
    border-color: rgba(15, 23, 42, 0.06);
    font-size: 13px;
    font-weight: 400;
  }

  .ant-table-tbody > tr:hover > td {
    background: #fafbff;
  }

  .ant-table-cell {
    border-inline-end: 1px solid rgba(15, 23, 42, 0.06);
  }

  .preview-row-index-cell {
    text-align: center;
    color: #8a93a5;
    background: #fbfcff;
    font-weight: 500;
  }

  .ant-table-thead .preview-row-index-cell {
    background: #f6f7fb;
  }

  .ant-table-pagination {
    margin: 8px 0 0;
  }
`;

const RailCard = styled(DashboardRailCard)`
  &.ant-card {
    border-radius: 14px;
    box-shadow: none;
  }

  .ant-card-body {
    padding: 10px;
    gap: 8px;
  }
`;

const RailItem = styled(DashboardRailItem)`
  padding: 7px 8px;
  border-radius: 9px;
  border-color: ${(props) =>
    props.$active ? 'rgba(111, 71, 255, 0.14)' : 'transparent'};
  background: ${(props) =>
    props.$active ? 'rgba(111, 71, 255, 0.055)' : 'transparent'};

  &:hover {
    background: ${(props) =>
      props.$active ? 'rgba(111, 71, 255, 0.07)' : '#f7f8fb'};
  }
`;

const RailRefreshButton = styled(DashboardRailCreateButton)`
  &.ant-btn {
    height: 30px;
    border-style: solid;
    border-color: rgba(111, 71, 255, 0.18);
    background: transparent;
    color: #6f58d8;
    justify-content: center;
  }
`;

const PreviewScroll = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  overflow: visible;
`;

const PaginationBar = styled.div`
  display: flex;
  justify-content: flex-end;
  padding-top: 8px;
`;

const SpreadsheetStage = styled.div`
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const SpreadsheetEmptyStage = styled.div`
  flex: 1;
  width: 100%;
  min-height: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const SpreadsheetRailTagRow = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;

  .ant-tag {
    margin-inline-end: 0;
    border-radius: 999px;
    font-size: 9px;
    line-height: 15px;
    padding-inline: 5px;
  }
`;

const ColumnSettingRow = styled.div`
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  align-items: center;
  min-height: 34px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.06);

  &:last-child {
    border-bottom: 0;
  }
`;

const OPERATION_OPTIONS: Array<{
  value: SpreadsheetAiOperationType;
  label: string;
  description: string;
}> = [
  {
    value: 'FILTER',
    label: '筛选条件',
    description: '按自然语言补充筛选条件',
  },
  {
    value: 'CLEANING',
    label: '数据清洗',
    description: '清洗空值、格式或异常值',
  },
  {
    value: 'GROUPING',
    label: '分组汇总',
    description: '调整统计粒度和分组口径',
  },
  {
    value: 'ENRICHMENT',
    label: '字段补充',
    description: '补充派生字段、标签或比例',
  },
];

const getRouterId = (value: string | string[] | undefined) => {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number.parseInt(String(raw || ''), 10);
  return Number.isFinite(id) && id > 0 ? id : null;
};

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return '未知时间';
  }

  try {
    return new Date(value).toLocaleString();
  } catch (_error) {
    return value;
  }
};

const moveItem = (items: string[], from: number, to: number) => {
  const nextItems = [...items];
  const [item] = nextItems.splice(from, 1);
  nextItems.splice(to, 0, item);
  return nextItems;
};

const resolvePreviewColumnOrder = (
  previewData?: SpreadsheetPreviewData | null,
  setting?: SpreadsheetDetailData['setting'],
) => {
  const columnNames = previewData?.columns?.map((column) => column.name) || [];
  const persistedOrder = [
    ...(setting?.pinnedColumns || []),
    ...(setting?.unpinnedColumns || []),
  ].filter((columnName) => columnNames.includes(columnName));
  const missingColumns = columnNames.filter(
    (columnName) => !persistedOrder.includes(columnName),
  );
  return [...persistedOrder, ...missingColumns];
};

const applyColumnSetting = (
  previewData?: SpreadsheetPreviewData | null,
  setting?: SpreadsheetDetailData['setting'],
) => {
  if (!previewData) {
    return null;
  }

  const hiddenColumns = new Set(setting?.hiddenColumns || []);
  const order = resolvePreviewColumnOrder(previewData, setting);
  const sourceColumnIndex = new Map(
    previewData.columns.map((column, index) => [column.name, index]),
  );
  const visibleColumnNames = order.filter(
    (columnName) => !hiddenColumns.has(columnName),
  );
  const columns = visibleColumnNames
    .map((columnName) =>
      previewData.columns.find((column) => column.name === columnName),
    )
    .filter((column): column is SpreadsheetPreviewData['columns'][number] =>
      Boolean(column),
    );
  const data = previewData.data.map((row) =>
    visibleColumnNames.map((columnName) => {
      const sourceIndex = sourceColumnIndex.get(columnName);
      return sourceIndex == null ? null : row[sourceIndex];
    }),
  );

  return {
    columns,
    data,
  };
};

const SPREADSHEET_TABLE_SCROLL_ROW_THRESHOLD = 12;
const SPREADSHEET_TABLE_SCROLL_Y = 'calc(100vh - 430px)';

const resolveSpreadsheetTableScrollY = (
  previewData?: { data?: Array<Array<any>> } | null,
) =>
  (previewData?.data?.length || 0) > SPREADSHEET_TABLE_SCROLL_ROW_THRESHOLD
    ? SPREADSHEET_TABLE_SCROLL_Y
    : false;

const useSpreadsheetRailActions = ({
  activeSpreadsheetId,
  spreadsheets,
  refetch,
  onUpdated,
}: {
  activeSpreadsheetId?: number | null;
  spreadsheets: SpreadsheetListItem[];
  refetch: () => Promise<SpreadsheetListItem[]>;
  onUpdated?: (spreadsheet: SpreadsheetDetailData) => void;
}) => {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const [renamingSpreadsheetId, setRenamingSpreadsheetId] = useState<
    number | null
  >(null);
  const [renameSpreadsheetName, setRenameSpreadsheetName] = useState('');
  const [mutatingSpreadsheetId, setMutatingSpreadsheetId] = useState<
    number | null
  >(null);

  const closeRenameSpreadsheet = useCallback(() => {
    setRenamingSpreadsheetId(null);
    setRenameSpreadsheetName('');
  }, []);

  const openRenameSpreadsheet = useCallback(
    (spreadsheetId: number) => {
      const targetSpreadsheet = spreadsheets.find(
        (spreadsheet) => spreadsheet.id === spreadsheetId,
      );
      if (!targetSpreadsheet) {
        return;
      }
      setRenamingSpreadsheetId(spreadsheetId);
      setRenameSpreadsheetName(targetSpreadsheet.name || '未命名数据表');
    },
    [spreadsheets],
  );

  const submitRenameSpreadsheet = useCallback(async () => {
    if (renamingSpreadsheetId == null) {
      return;
    }

    const normalizedName = renameSpreadsheetName.trim();
    if (!normalizedName) {
      appMessage.warning('请输入数据表名称。');
      return;
    }

    setMutatingSpreadsheetId(renamingSpreadsheetId);
    try {
      const updated = await updateSpreadsheet(
        runtimeScopeNavigation.workspaceSelector,
        renamingSpreadsheetId,
        {
          name: normalizedName,
        },
      );
      onUpdated?.(updated);
      await refetch();
      appMessage.success('数据表名称已更新。');
      closeRenameSpreadsheet();
    } catch (error) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '重命名数据表失败，请稍后重试。',
      );
      if (errorMessage) {
        appMessage.error(errorMessage);
      }
    } finally {
      setMutatingSpreadsheetId(null);
    }
  }, [
    closeRenameSpreadsheet,
    onUpdated,
    refetch,
    renameSpreadsheetName,
    renamingSpreadsheetId,
    runtimeScopeNavigation.workspaceSelector,
  ]);

  const deleteSpreadsheetById = useCallback(
    (spreadsheetId: number) => {
      const targetSpreadsheet = spreadsheets.find(
        (spreadsheet) => spreadsheet.id === spreadsheetId,
      );
      appModal.confirm({
        title: '确认删除这个数据表吗？',
        content: `删除后将移除「${
          targetSpreadsheet?.name || '未命名数据表'
        }」及其历史版本。`,
        okText: '删除数据表',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: async () => {
          setMutatingSpreadsheetId(spreadsheetId);
          try {
            await deleteSpreadsheet(
              runtimeScopeNavigation.workspaceSelector,
              spreadsheetId,
            );
            const nextSpreadsheets = await refetch();
            appMessage.success('数据表已删除。');

            if (activeSpreadsheetId === spreadsheetId) {
              const nextSpreadsheet = nextSpreadsheets.find(
                (spreadsheet) => spreadsheet.id !== spreadsheetId,
              );
              if (nextSpreadsheet) {
                await runtimeScopeNavigation.replace(
                  `/home/spreadsheets/${nextSpreadsheet.id}`,
                  {},
                  runtimeScopeNavigation.workspaceSelector,
                );
              } else {
                await runtimeScopeNavigation.replace(
                  '/home/spreadsheets',
                  {},
                  runtimeScopeNavigation.workspaceSelector,
                );
              }
            }
          } catch (error) {
            const errorMessage = resolveAbortSafeErrorMessage(
              error,
              '删除数据表失败，请稍后重试。',
            );
            if (errorMessage) {
              appMessage.error(errorMessage);
            }
          } finally {
            setMutatingSpreadsheetId(null);
          }
        },
      });
    },
    [activeSpreadsheetId, refetch, runtimeScopeNavigation, spreadsheets],
  );

  const renameModal = (
    <Modal
      title="重命名数据表"
      open={renamingSpreadsheetId != null}
      okText="保存名称"
      cancelText="取消"
      confirmLoading={mutatingSpreadsheetId === renamingSpreadsheetId}
      onCancel={closeRenameSpreadsheet}
      onOk={() => void submitRenameSpreadsheet()}
    >
      <Text type="secondary">
        更新数据表资产名称，不会改动 SQL 内容和历史版本。
      </Text>
      <Input
        autoFocus
        value={renameSpreadsheetName}
        placeholder="请输入新的数据表名称"
        style={{ marginTop: 12 }}
        onChange={(event) => setRenameSpreadsheetName(event.target.value)}
        onPressEnter={() => void submitRenameSpreadsheet()}
      />
    </Modal>
  );

  return {
    deleteSpreadsheetById,
    mutatingSpreadsheetId,
    openRenameSpreadsheet,
    renameModal,
  };
};

function SpreadsheetWorkbenchRail({
  activeSpreadsheetId,
  loading,
  mutatingSpreadsheetId,
  spreadsheets,
  onDeleteSpreadsheet,
  onRefresh,
  onRenameSpreadsheet,
  onSelectSpreadsheet,
}: {
  activeSpreadsheetId?: number | null;
  loading?: boolean;
  mutatingSpreadsheetId?: number | null;
  spreadsheets: SpreadsheetListItem[];
  onDeleteSpreadsheet: (spreadsheetId: number) => void;
  onRefresh: () => void;
  onRenameSpreadsheet: (spreadsheetId: number) => void;
  onSelectSpreadsheet: (spreadsheetId: number) => void;
}) {
  return (
    <DashboardRail>
      <RailCard variant="borderless">
        <DashboardRailSection>
          <DashboardRailSectionHeader>
            <DashboardRailSectionTitle>数据表</DashboardRailSectionTitle>
            <DashboardRailSectionCount>
              {spreadsheets.length}
            </DashboardRailSectionCount>
          </DashboardRailSectionHeader>
          <DashboardRailList>
            {loading && spreadsheets.length === 0 ? (
              <div className="d-flex justify-center align-center p-4">
                <Spin size="small" />
              </div>
            ) : spreadsheets.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="暂无数据表"
              />
            ) : (
              spreadsheets.map((spreadsheet) => {
                const isActive = activeSpreadsheetId === spreadsheet.id;
                const isMutating = mutatingSpreadsheetId === spreadsheet.id;
                const menuItems: NonNullable<MenuProps['items']> = [
                  {
                    key: 'rename',
                    icon: <EditOutlined />,
                    label: '重命名',
                    disabled: isMutating,
                    onClick: () => onRenameSpreadsheet(spreadsheet.id),
                  },
                  {
                    key: 'delete',
                    icon: <DeleteOutlined />,
                    label: '删除数据表',
                    danger: true,
                    disabled: isMutating,
                    onClick: () => onDeleteSpreadsheet(spreadsheet.id),
                  },
                ];

                return (
                  <RailItem
                    key={spreadsheet.id}
                    $active={isActive}
                    aria-pressed={isActive}
                    onClick={() => onSelectSpreadsheet(spreadsheet.id)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') {
                        return;
                      }
                      event.preventDefault();
                      onSelectSpreadsheet(spreadsheet.id);
                    }}
                  >
                    <DashboardRailItemBody>
                      <DashboardRailItemRow>
                        <DashboardRailTitle>
                          <Typography.Text ellipsis style={{ marginBottom: 0 }}>
                            {spreadsheet.name || '未命名数据表'}
                          </Typography.Text>
                        </DashboardRailTitle>
                      </DashboardRailItemRow>
                      {spreadsheet.folderId || spreadsheet.isShared ? (
                        <SpreadsheetRailTagRow>
                          {spreadsheet.folderId ? (
                            <Tag icon={<FolderOutlined />}>
                              {spreadsheet.folderId}
                            </Tag>
                          ) : null}
                          {spreadsheet.isShared ? (
                            <Tag icon={<ShareAltOutlined />} color="blue">
                              共享
                            </Tag>
                          ) : null}
                        </SpreadsheetRailTagRow>
                      ) : null}
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
                  </RailItem>
                );
              })
            )}
          </DashboardRailList>
          <RailRefreshButton
            block
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={onRefresh}
          >
            刷新
          </RailRefreshButton>
        </DashboardRailSection>
      </RailCard>
    </DashboardRail>
  );
}

export function SpreadsheetListPage() {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const spreadsheets = useHomeSpreadsheets();
  const spreadsheetRailActions = useSpreadsheetRailActions({
    activeSpreadsheetId: null,
    spreadsheets: spreadsheets.data.spreadsheets,
    refetch: spreadsheets.refetch,
  });

  useEffect(() => {
    if (
      spreadsheets.loading ||
      !spreadsheets.initialized ||
      spreadsheets.data.spreadsheets.length === 0
    ) {
      return;
    }

    const firstSpreadsheet = spreadsheets.data.spreadsheets[0];
    void runtimeScopeNavigation.replace(
      `/home/spreadsheets/${firstSpreadsheet.id}`,
      {},
      runtimeScopeNavigation.workspaceSelector,
    );
  }, [
    runtimeScopeNavigation,
    spreadsheets.data.spreadsheets,
    spreadsheets.initialized,
    spreadsheets.loading,
  ]);

  return (
    <DirectShellPageFrame
      activeNav="spreadsheet"
      flushBottomPadding
      mainPaddingTop="8px"
      stretchContent
    >
      <DashboardWorkbench>
        <SpreadsheetWorkbenchRail
          activeSpreadsheetId={null}
          loading={spreadsheets.loading}
          mutatingSpreadsheetId={spreadsheetRailActions.mutatingSpreadsheetId}
          spreadsheets={spreadsheets.data.spreadsheets}
          onDeleteSpreadsheet={spreadsheetRailActions.deleteSpreadsheetById}
          onRefresh={() => void spreadsheets.refetch()}
          onRenameSpreadsheet={spreadsheetRailActions.openRenameSpreadsheet}
          onSelectSpreadsheet={(spreadsheetId) =>
            void runtimeScopeNavigation.push(
              `/home/spreadsheets/${spreadsheetId}`,
              {},
              runtimeScopeNavigation.workspaceSelector,
            )
          }
        />

        <SpreadsheetStage>
          <HeaderCard>
            <HeaderRow>
              <TitleBlock>
                <Space>
                  <TableOutlined />
                  <Title level={4} style={{ margin: 0 }}>
                    数据表
                  </Title>
                </Space>
                <Text type="secondary">
                  保存问数结果 SQL，作为可分页预览、可持续加工的数据分析资产。
                </Text>
              </TitleBlock>
            </HeaderRow>
          </HeaderCard>

          <ContentCard>
            <Empty
              description={
                spreadsheets.data.spreadsheets.length === 0
                  ? '暂无数据表，请先在问数结果中点击“保存为数据表”。'
                  : '请从数据表列表选择一张数据表查看。'
              }
            />
          </ContentCard>
        </SpreadsheetStage>
      </DashboardWorkbench>
      {spreadsheetRailActions.renameModal}
    </DirectShellPageFrame>
  );
}

export function SpreadsheetDetailPage() {
  const router = useRouter();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const spreadsheets = useHomeSpreadsheets();
  const spreadsheetId = getRouterId(router.query.id);
  const [spreadsheet, setSpreadsheet] = useState<SpreadsheetDetailData | null>(
    null,
  );
  const [previewData, setPreviewData] = useState<SpreadsheetPreviewData | null>(
    null,
  );
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [savingSetting, setSavingSetting] = useState(false);
  const [savingVersion, setSavingVersion] = useState(false);
  const [runningOperation, setRunningOperation] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [sqlModalOpen, setSqlModalOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [columnModalOpen, setColumnModalOpen] = useState(false);
  const [operationModalOpen, setOperationModalOpen] = useState(false);
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);
  const [operationType, setOperationType] =
    useState<SpreadsheetAiOperationType>('FILTER');
  const [operationInstruction, setOperationInstruction] = useState('');
  const detailRequestIdRef = useRef(0);
  const previewRequestIdRef = useRef(0);
  const spreadsheetRailActions = useSpreadsheetRailActions({
    activeSpreadsheetId: spreadsheetId,
    spreadsheets: spreadsheets.data.spreadsheets,
    refetch: spreadsheets.refetch,
    onUpdated: setSpreadsheet,
  });

  const loadDetail = useCallback(async () => {
    if (!spreadsheetId) {
      return null;
    }

    const requestId = detailRequestIdRef.current + 1;
    detailRequestIdRef.current = requestId;
    setLoadingDetail(true);
    try {
      const payload = await loadSpreadsheetDetailPayload({
        spreadsheetId,
        selector: runtimeScopeNavigation.workspaceSelector,
      });
      if (detailRequestIdRef.current === requestId) {
        setSpreadsheet(payload);
      }
      return payload;
    } catch (error) {
      if (detailRequestIdRef.current === requestId) {
        const errorMessage = resolveAbortSafeErrorMessage(
          error,
          '加载数据表失败，请稍后重试。',
        );
        if (errorMessage) {
          appMessage.error(errorMessage);
        }
      }
      return null;
    } finally {
      if (detailRequestIdRef.current === requestId) {
        setLoadingDetail(false);
      }
    }
  }, [runtimeScopeNavigation.workspaceSelector, spreadsheetId]);

  const loadPreview = useCallback(
    async ({
      nextPage,
      nextPageSize,
      refresh = false,
    }: {
      nextPage: number;
      nextPageSize: number;
      refresh?: boolean;
    }) => {
      if (!spreadsheetId) {
        return null;
      }

      const requestId = previewRequestIdRef.current + 1;
      previewRequestIdRef.current = requestId;
      setLoadingPreview(true);
      try {
        const payload = await previewSpreadsheet(
          runtimeScopeNavigation.workspaceSelector,
          spreadsheetId,
          {
            page: nextPage,
            pageSize: nextPageSize,
            refresh,
          },
        );
        if (previewRequestIdRef.current === requestId) {
          setPreviewData(payload);
        }
        return payload;
      } catch (error) {
        if (previewRequestIdRef.current === requestId) {
          const errorMessage = resolveAbortSafeErrorMessage(
            error,
            '加载数据表预览失败，请稍后重试。',
          );
          if (errorMessage) {
            appMessage.error(errorMessage);
          }
        }
        return null;
      } finally {
        if (previewRequestIdRef.current === requestId) {
          setLoadingPreview(false);
        }
      }
    },
    [runtimeScopeNavigation.workspaceSelector, spreadsheetId],
  );

  useEffect(
    () => () => {
      detailRequestIdRef.current += 1;
      previewRequestIdRef.current += 1;
    },
    [],
  );

  useEffect(() => {
    detailRequestIdRef.current += 1;
    previewRequestIdRef.current += 1;
    setSpreadsheet(null);
    setPreviewData(null);
    setPage(0);
  }, [
    runtimeScopeNavigation.workspaceSelector.runtimeScopeId,
    runtimeScopeNavigation.workspaceSelector.workspaceId,
    spreadsheetId,
  ]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    if (!spreadsheetId) {
      return;
    }

    void loadPreview({ nextPage: 0, nextPageSize: pageSize });
  }, [loadPreview, pageSize, spreadsheetId]);

  useEffect(() => {
    const nextOrder = resolvePreviewColumnOrder(
      previewData,
      spreadsheet?.setting,
    );
    setColumnOrder(nextOrder);
    setVisibleColumns(
      nextOrder.filter(
        (columnName) =>
          !spreadsheet?.setting?.hiddenColumns?.includes(columnName),
      ),
    );
  }, [previewData, spreadsheet?.setting]);

  const visiblePreviewData = useMemo(
    () => applyColumnSetting(previewData, spreadsheet?.setting),
    [previewData, spreadsheet?.setting],
  );

  const saveColumns = async () => {
    if (!spreadsheetId || !previewData) {
      return;
    }

    setSavingSetting(true);
    try {
      const hiddenColumns = columnOrder.filter(
        (columnName) => !visibleColumns.includes(columnName),
      );
      const updated = await updateSpreadsheetSetting(
        runtimeScopeNavigation.workspaceSelector,
        spreadsheetId,
        {
          hiddenColumns,
          pinnedColumns: [],
          unpinnedColumns: columnOrder,
        },
      );
      setSpreadsheet(updated);
      setColumnModalOpen(false);
      void spreadsheets.refetch();
      appMessage.success('列设置已保存');
    } catch (error) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '保存列设置失败。',
      );
      if (errorMessage) {
        appMessage.error(errorMessage);
      }
    } finally {
      setSavingSetting(false);
    }
  };

  const saveVersion = async () => {
    if (!spreadsheetId || !spreadsheet?.sql) {
      return;
    }

    setSavingVersion(true);
    try {
      const updated = await saveSpreadsheetVersion(
        runtimeScopeNavigation.workspaceSelector,
        spreadsheetId,
        {
          sql: spreadsheet.sql,
          type: 'SAVE',
          payload: {
            reason: 'manual_save_from_spreadsheet_page',
          },
        },
      );
      setSpreadsheet(updated);
      void spreadsheets.refetch();
      appMessage.success(`已保存版本 v${updated.currentVersion}`);
    } catch (error) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '保存版本失败。',
      );
      if (errorMessage) {
        appMessage.error(errorMessage);
      }
    } finally {
      setSavingVersion(false);
    }
  };

  const openOperationModal = (
    nextOperationType: SpreadsheetAiOperationType,
  ) => {
    setOperationType(nextOperationType);
    setOperationInstruction('');
    setOperationModalOpen(true);
  };

  const runAiOperation = async () => {
    if (!spreadsheetId || !operationInstruction.trim()) {
      appMessage.warning('请先输入要执行的 AI 操作说明。');
      return;
    }

    setRunningOperation(true);
    try {
      const result = await runSpreadsheetAiOperation(
        runtimeScopeNavigation.workspaceSelector,
        spreadsheetId,
        {
          operationType,
          instruction: operationInstruction,
        },
      );
      setSpreadsheet(result.spreadsheet);
      setPreviewData(result.preview);
      setPage(result.preview.page);
      setPageSize(result.preview.pageSize);
      setOperationModalOpen(false);
      void spreadsheets.refetch();
      appMessage.success(
        `AI 操作已保存为 v${result.spreadsheet.currentVersion}`,
      );
    } catch (error) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '执行 AI 操作失败。',
      );
      if (errorMessage) {
        appMessage.error(errorMessage);
      }
    } finally {
      setRunningOperation(false);
    }
  };

  const onPaginationChange = (nextPage: number, nextPageSize: number) => {
    const zeroBasedPage = Math.max(0, nextPage - 1);
    const pageSizeChanged = nextPageSize !== pageSize;
    const resolvedPage = pageSizeChanged ? 0 : zeroBasedPage;
    setPage(resolvedPage);
    setPageSize(nextPageSize);
    void loadPreview({
      nextPage: resolvedPage,
      nextPageSize,
      refresh: false,
    });
  };

  if (!spreadsheetId) {
    return (
      <DirectShellPageFrame
        activeNav="spreadsheet"
        flushBottomPadding
        mainPaddingTop="8px"
        stretchContent
      >
        <SpreadsheetEmptyStage>
          <Empty description="数据表地址无效" />
        </SpreadsheetEmptyStage>
        {spreadsheetRailActions.renameModal}
      </DirectShellPageFrame>
    );
  }

  return (
    <DirectShellPageFrame
      activeNav="spreadsheet"
      flushBottomPadding
      mainPaddingTop="8px"
      stretchContent
    >
      <DashboardWorkbench>
        <SpreadsheetWorkbenchRail
          activeSpreadsheetId={spreadsheetId}
          loading={spreadsheets.loading}
          mutatingSpreadsheetId={spreadsheetRailActions.mutatingSpreadsheetId}
          spreadsheets={spreadsheets.data.spreadsheets}
          onDeleteSpreadsheet={spreadsheetRailActions.deleteSpreadsheetById}
          onRefresh={() => void spreadsheets.refetch()}
          onRenameSpreadsheet={spreadsheetRailActions.openRenameSpreadsheet}
          onSelectSpreadsheet={(nextSpreadsheetId) =>
            void runtimeScopeNavigation.push(
              `/home/spreadsheets/${nextSpreadsheetId}`,
              {},
              runtimeScopeNavigation.workspaceSelector,
            )
          }
        />

        <SpreadsheetStage>
          <HeaderCard loading={loadingDetail && !spreadsheet}>
            <HeaderRow>
              <TitleBlock>
                <SpreadsheetTitleLine>
                  <TableOutlined />
                  <Title
                    level={4}
                    ellipsis={{
                      tooltip: spreadsheet?.name || '数据表',
                    }}
                    style={{ margin: 0 }}
                  >
                    {spreadsheet?.name || '数据表'}
                  </Title>
                  {spreadsheet ? (
                    <Tag color="purple">v{spreadsheet.currentVersion}</Tag>
                  ) : null}
                </SpreadsheetTitleLine>
                <MetaLine>
                  <span>更新于 {formatDateTime(spreadsheet?.updatedAt)}</span>
                  {spreadsheet?.folderId ? (
                    <Tag icon={<FolderOutlined />} color="default">
                      {spreadsheet.folderId}
                    </Tag>
                  ) : null}
                  {spreadsheet?.isShared ? (
                    <Tag icon={<ShareAltOutlined />} color="blue">
                      已共享
                    </Tag>
                  ) : null}
                  {spreadsheet?.matchedQuestion ? (
                    <Tooltip title={spreadsheet.matchedQuestion}>
                      <SourceQuestion>
                        来源问题：{spreadsheet.matchedQuestion}
                      </SourceQuestion>
                    </Tooltip>
                  ) : null}
                </MetaLine>
              </TitleBlock>
              <HeaderActions>
                <Button
                  icon={<ReloadOutlined />}
                  loading={loadingPreview}
                  onClick={() =>
                    void loadPreview({
                      nextPage: page,
                      nextPageSize: pageSize,
                      refresh: true,
                    })
                  }
                >
                  刷新
                </Button>
              </HeaderActions>
            </HeaderRow>
          </HeaderCard>

          <ToolbarCard>
            <Toolbelt>
              <ToolGroup>
                <ToolGroupLabel $accent>
                  <RobotOutlined />
                  AI Assistant
                </ToolGroupLabel>
                <ToolbarHint>用自然语言加工当前 SQL</ToolbarHint>
                {OPERATION_OPTIONS.map((option) => (
                  <Tooltip key={option.value} title={option.description}>
                    <Button onClick={() => openOperationModal(option.value)}>
                      {option.label}
                    </Button>
                  </Tooltip>
                ))}
              </ToolGroup>
              <ToolGroup>
                <ToolGroupLabel>变更</ToolGroupLabel>
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  loading={savingVersion}
                  onClick={saveVersion}
                >
                  保存
                </Button>
                <Button
                  icon={<HistoryOutlined />}
                  onClick={() => setHistoryOpen(true)}
                >
                  历史
                </Button>
              </ToolGroup>
              <ToolGroup>
                <ToolGroupLabel>数据</ToolGroupLabel>
                <Button
                  icon={<CodeOutlined />}
                  onClick={() => setSqlModalOpen(true)}
                >
                  查看 SQL
                </Button>
                <Button
                  icon={<SettingOutlined />}
                  disabled={!previewData?.columns?.length}
                  onClick={() => setColumnModalOpen(true)}
                >
                  配置列
                </Button>
              </ToolGroup>
            </Toolbelt>
          </ToolbarCard>

          <ContentCard>
            <PreviewScroll>
              <SpreadsheetPreviewShell>
                <PreviewData
                  className="spreadsheet-preview"
                  loading={loadingPreview}
                  previewData={visiblePreviewData || undefined}
                  exportFileName={
                    spreadsheet
                      ? `spreadsheet-${spreadsheet.id}-${spreadsheet.name}`
                      : `spreadsheet-${spreadsheetId}`
                  }
                  showRowIndex
                  rowIndexOffset={
                    (previewData?.page ?? page) *
                    (previewData?.pageSize ?? pageSize)
                  }
                  tableScrollY={resolveSpreadsheetTableScrollY(
                    visiblePreviewData,
                  )}
                />
              </SpreadsheetPreviewShell>
            </PreviewScroll>
            <PaginationBar>
              <Pagination
                current={(previewData?.page ?? page) + 1}
                pageSize={previewData?.pageSize ?? pageSize}
                total={previewData?.rowCount ?? 0}
                showSizeChanger
                showTotal={(total) => `共 ${total} 行`}
                onChange={onPaginationChange}
              />
            </PaginationBar>
          </ContentCard>

          <Modal
            title="查看 SQL"
            open={sqlModalOpen}
            width={1040}
            footer={null}
            bodyStyle={{ maxHeight: '76vh', overflow: 'auto' }}
            onCancel={() => setSqlModalOpen(false)}
          >
            <SQLCodeBlock
              code={spreadsheet?.sql || ''}
              showLineNumbers
              maxHeight="70vh"
              copyable
            />
          </Modal>

          <Modal
            title="配置列"
            open={columnModalOpen}
            okText="保存列设置"
            confirmLoading={savingSetting}
            onOk={saveColumns}
            onCancel={() => setColumnModalOpen(false)}
          >
            <Space direction="vertical" style={{ width: '100%' }} size={0}>
              {columnOrder.map((columnName, index) => (
                <ColumnSettingRow key={columnName}>
                  <Checkbox
                    checked={visibleColumns.includes(columnName)}
                    onChange={(event) => {
                      setVisibleColumns((current) =>
                        event.target.checked
                          ? Array.from(new Set([...current, columnName]))
                          : current.filter((item) => item !== columnName),
                      );
                    }}
                  >
                    {columnName}
                  </Checkbox>
                  <Space size={4}>
                    <Button
                      size="small"
                      type="text"
                      icon={<ArrowUpOutlined />}
                      disabled={index === 0}
                      onClick={() =>
                        setColumnOrder((current) =>
                          moveItem(current, index, Math.max(0, index - 1)),
                        )
                      }
                    />
                    <Button
                      size="small"
                      type="text"
                      icon={<ArrowDownOutlined />}
                      disabled={index === columnOrder.length - 1}
                      onClick={() =>
                        setColumnOrder((current) =>
                          moveItem(
                            current,
                            index,
                            Math.min(current.length - 1, index + 1),
                          ),
                        )
                      }
                    />
                  </Space>
                </ColumnSettingRow>
              ))}
            </Space>
          </Modal>

          <Modal
            title="AI 数据操作"
            open={operationModalOpen}
            okText="生成并保存为新版本"
            confirmLoading={runningOperation}
            onOk={runAiOperation}
            onCancel={() => setOperationModalOpen(false)}
          >
            <Space direction="vertical" style={{ width: '100%' }} size={12}>
              <div>
                <Text type="secondary">操作类型</Text>
                <Select
                  value={operationType}
                  style={{ width: '100%', marginTop: 6 }}
                  options={OPERATION_OPTIONS.map((option) => ({
                    value: option.value,
                    label: `${option.label} · ${option.description}`,
                  }))}
                  onChange={setOperationType}
                />
              </div>
              <div>
                <Text type="secondary">操作说明</Text>
                <Input.TextArea
                  value={operationInstruction}
                  rows={5}
                  placeholder="例如：只保留充值金额大于 1000 的日期；按渠道汇总投注金额；增加一列充值提现差额等级。"
                  style={{ marginTop: 6 }}
                  onChange={(event) =>
                    setOperationInstruction(event.target.value)
                  }
                />
              </div>
              <Alert
                type="info"
                showIcon
                message="AI 操作会基于当前 SQL 生成新的 SQL，并自动保存到历史版本。"
              />
            </Space>
          </Modal>

          <Drawer
            title="历史版本"
            placement="right"
            width={420}
            open={historyOpen}
            onClose={() => setHistoryOpen(false)}
          >
            <List
              dataSource={spreadsheet?.history || []}
              locale={{ emptyText: '暂无保存历史' }}
              renderItem={(item) => (
                <List.Item>
                  <List.Item.Meta
                    title={
                      <Space>
                        <Tag
                          color={item.type === 'INITIALIZE' ? 'blue' : 'green'}
                        >
                          {item.type}
                        </Tag>
                        <span>Version {item.version}</span>
                      </Space>
                    }
                    description={formatDateTime(item.createdAt)}
                  />
                </List.Item>
              )}
            />
          </Drawer>
        </SpreadsheetStage>
      </DashboardWorkbench>
      {spreadsheetRailActions.renameModal}
    </DirectShellPageFrame>
  );
}

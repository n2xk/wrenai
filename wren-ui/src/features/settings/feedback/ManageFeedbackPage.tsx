import { useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { TableColumnsType } from 'antd';
import EyeOutlined from '@ant-design/icons/EyeOutlined';

import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
import useAuthSession from '@/hooks/useAuthSession';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import useThreadResponseFeedbackList from '@/hooks/useThreadResponseFeedbackList';
import {
  buildRuntimeScopeUrl,
  readRuntimeScopeSelectorFromObject,
} from '@/runtime/client/runtimeScope';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import { getAbsoluteTime } from '@/utils/time';
import {
  THREAD_RESPONSE_FEEDBACK_RATING_OPTIONS,
  THREAD_RESPONSE_FEEDBACK_REASON_OPTIONS,
  THREAD_RESPONSE_FEEDBACK_SOURCE_OPTIONS,
  type ThreadResponseFeedbackData,
  type ThreadResponseFeedbackListFilter,
  type ThreadResponseFeedbackRating,
  type ThreadResponseFeedbackReason,
} from '@/utils/threadResponseFeedbackRest';
import { resolvePlatformManagementFromAuthSession } from '@/features/settings/settingsPageCapabilities';
import { buildSettingsConsoleShellProps } from '@/features/settings/settingsShell';

const PAGE_SIZE = 20;

const textMutedStyle = {
  color: 'var(--ant-color-text-secondary)',
} as const;

const codeBlockStyle = {
  marginBottom: 0,
  padding: 12,
  borderRadius: 'var(--nova-radius-card)',
  background: 'var(--ant-color-fill-quaternary)',
  fontFamily:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
} as const;

const feedbackPageStyles = `
  .feedback-list-section {
    width: 100%;
  }

  .feedback-filter-bar {
    margin-bottom: 18px;
  }

  .feedback-filter-bar .ant-select-selector,
  .feedback-filter-bar .ant-input,
  .feedback-filter-bar .ant-input-search-button {
    min-height: 36px;
    border-color: #d9e2ec !important;
  }

  .feedback-filter-bar .ant-select-selection-placeholder,
  .feedback-filter-bar .ant-input::placeholder {
    color: #98a2b3;
  }

  .feedback-table.console-table.ant-table-wrapper {
    margin-top: 0;
  }

  .feedback-table.console-table .ant-table-container {
    border-color: #edf1f5;
  }

  .feedback-table.console-table .ant-table-thead > tr > th {
    padding: 15px 18px;
    background: #f7f9fc;
    color: #475467;
    font-size: 13px;
  }

  .feedback-table.console-table .ant-table-tbody > tr > td {
    padding: 18px;
    vertical-align: top;
  }

  .feedback-table.console-table .ant-table-tbody > tr:hover > td {
    background: #fbfcff;
  }

  .feedback-table .ant-pagination {
    margin: 18px 0 0;
  }

  .feedback-view-button.ant-btn-link {
    color: #7c5cff;
    font-weight: 500;
  }

`;

const getRatingLabel = (rating?: string | null) =>
  THREAD_RESPONSE_FEEDBACK_RATING_OPTIONS.find((item) => item.value === rating)
    ?.label ||
  rating ||
  '-';

const getReasonLabel = (reason?: string | null) =>
  THREAD_RESPONSE_FEEDBACK_REASON_OPTIONS.find((item) => item.value === reason)
    ?.label ||
  reason ||
  '-';

const getSourceLabel = (source?: string | null) =>
  THREAD_RESPONSE_FEEDBACK_SOURCE_OPTIONS.find((item) => item.value === source)
    ?.label ||
  source ||
  '-';

const getQuestion = (record: ThreadResponseFeedbackData) =>
  String(record.metadata?.question || '').trim();

const getSql = (record: ThreadResponseFeedbackData) =>
  String(record.metadata?.sql || '').trim();

const getTemplateDecision = (record: ThreadResponseFeedbackData) =>
  record.metadata?.templateDecision &&
  typeof record.metadata.templateDecision === 'object'
    ? (record.metadata.templateDecision as Record<string, any>)
    : null;

const getThreadPath = (record: ThreadResponseFeedbackData) =>
  `/home/${record.threadId}`;

const getWorkspaceLabel = (record: ThreadResponseFeedbackData) =>
  record.workspace?.name || record.workspaceId || '-';

const getKnowledgeBaseLabel = (record: ThreadResponseFeedbackData) =>
  record.knowledgeBase?.name || record.knowledgeBaseId || '-';

const templateDecisionTagLabelMap: Record<string, string> = {
  reference: '参考生成',
  generated: '系统生成',
  sql_pair: 'SQL 模板',
  hard_template: '口径模板',
  business_knowledge: '业务知识',
  instruction: '分析规则',
  llm: '模型生成',
};

const getTemplateDecisionTagLabel = (value?: unknown) =>
  templateDecisionTagLabelMap[String(value || '')] || String(value || '');

const isFeedbackAccessDeniedError = (error: Error | null) =>
  /feedback\.read|permission required|not authorized|forbidden|unauthorized/i.test(
    error?.message || '',
  );

function FeedbackRatingTag({
  rating,
}: {
  rating: ThreadResponseFeedbackRating;
}) {
  return (
    <Tag color={rating === 'positive' ? 'green' : 'red'}>
      {getRatingLabel(rating)}
    </Tag>
  );
}

function FeedbackReasonTags({
  reasons,
}: {
  reasons?: ThreadResponseFeedbackReason[];
}) {
  if (!reasons?.length) {
    return <Typography.Text style={textMutedStyle}>-</Typography.Text>;
  }

  return (
    <Space size={[4, 4]} wrap>
      {reasons.map((reason) => (
        <Tag key={reason}>{getReasonLabel(reason)}</Tag>
      ))}
    </Space>
  );
}

function FeedbackQuestionCell({
  record,
}: {
  record: ThreadResponseFeedbackData;
}) {
  const question = getQuestion(record);
  const sql = getSql(record);

  return (
    <Space direction="vertical" size={4} style={{ width: '100%' }}>
      <Typography.Paragraph
        ellipsis={{ rows: 2, tooltip: question || '暂无问题上下文' }}
        style={{ marginBottom: 0, color: '#182230', fontWeight: 500 }}
      >
        {question || (
          <Typography.Text style={textMutedStyle}>
            暂无问题上下文
          </Typography.Text>
        )}
      </Typography.Paragraph>
      {sql ? (
        <Typography.Text
          code
          ellipsis={{ tooltip: sql }}
          style={{
            maxWidth: 520,
            color: '#475467',
            fontSize: 12,
            fontWeight: 400,
          }}
        >
          {sql}
        </Typography.Text>
      ) : null}
    </Space>
  );
}

function FeedbackTemplateCell({
  record,
}: {
  record: ThreadResponseFeedbackData;
}) {
  const decision = getTemplateDecision(record);
  if (!decision) {
    return <Typography.Text style={textMutedStyle}>未记录</Typography.Text>;
  }

  return (
    <Space direction="vertical" size={4}>
      {decision.templateTitle || decision.templateId ? (
        <Typography.Text ellipsis={{ tooltip: true }}>
          {decision.templateTitle || decision.templateId}
        </Typography.Text>
      ) : (
        <Typography.Text style={textMutedStyle}>无命名模板</Typography.Text>
      )}
      <Space size={4} wrap>
        {decision.mode ? (
          <Tag bordered={false} color="purple">
            {getTemplateDecisionTagLabel(decision.mode)}
          </Tag>
        ) : null}
        {decision.sqlSource ? (
          <Tag bordered={false} color="geekblue">
            {getTemplateDecisionTagLabel(decision.sqlSource)}
          </Tag>
        ) : null}
        {decision.fallbackReason ? (
          <Tag bordered={false} color="orange">
            {getTemplateDecisionTagLabel(decision.fallbackReason)}
          </Tag>
        ) : null}
      </Space>
    </Space>
  );
}

function FeedbackScopeCell({ record }: { record: ThreadResponseFeedbackData }) {
  const workspaceLabel = getWorkspaceLabel(record);
  const knowledgeBaseLabel = getKnowledgeBaseLabel(record);

  return (
    <Space direction="vertical" size={2} style={{ width: '100%' }}>
      <Typography.Text
        ellipsis={{ tooltip: workspaceLabel }}
        style={{ color: '#344054', maxWidth: 220 }}
      >
        {workspaceLabel}
      </Typography.Text>
      <Typography.Text
        ellipsis={{ tooltip: knowledgeBaseLabel }}
        style={{ ...textMutedStyle, maxWidth: 220, fontSize: 12 }}
      >
        {knowledgeBaseLabel}
      </Typography.Text>
    </Space>
  );
}

function FeedbackDetailsDrawer({
  feedback,
  open,
  onClose,
  onOpenThread,
}: {
  feedback: ThreadResponseFeedbackData | null;
  open: boolean;
  onClose: () => void;
  onOpenThread: (feedback: ThreadResponseFeedbackData) => void;
}) {
  const question = feedback ? getQuestion(feedback) : '';
  const sql = feedback ? getSql(feedback) : '';
  const decision = feedback ? getTemplateDecision(feedback) : null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={720}
      title="反馈详情"
      extra={
        feedback ? (
          <Button type="primary" onClick={() => onOpenThread(feedback)}>
            打开原对话
          </Button>
        ) : null
      }
    >
      {feedback ? (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label="反馈">
              <FeedbackRatingTag rating={feedback.rating} />
            </Descriptions.Item>
            <Descriptions.Item label="来源">
              {getSourceLabel(feedback.source)}
            </Descriptions.Item>
            <Descriptions.Item label="更新时间">
              {feedback.updatedAt ? getAbsoluteTime(feedback.updatedAt) : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="提交人">
              {feedback.actorUserId || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="工作空间">
              {getWorkspaceLabel(feedback)}
            </Descriptions.Item>
            <Descriptions.Item label="知识库">
              {getKnowledgeBaseLabel(feedback)}
            </Descriptions.Item>
            <Descriptions.Item label="线程 ID">
              {feedback.threadId}
            </Descriptions.Item>
            <Descriptions.Item label="回答 ID">
              {feedback.threadResponseId}
            </Descriptions.Item>
            <Descriptions.Item label="快照">
              {feedback.kbSnapshotId || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="原因" span={2}>
              <FeedbackReasonTags reasons={feedback.reasonCodes} />
            </Descriptions.Item>
            <Descriptions.Item label="备注" span={2}>
              {feedback.comment || (
                <Typography.Text style={textMutedStyle}>无备注</Typography.Text>
              )}
            </Descriptions.Item>
          </Descriptions>

          <Card size="small" title="用户问题">
            <Typography.Paragraph
              style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}
            >
              {question || (
                <Typography.Text style={textMutedStyle}>
                  暂无问题上下文
                </Typography.Text>
              )}
            </Typography.Paragraph>
          </Card>

          <Card size="small" title="生成 SQL">
            {sql ? (
              <Typography.Paragraph style={codeBlockStyle}>
                {sql}
              </Typography.Paragraph>
            ) : (
              <Typography.Text style={textMutedStyle}>
                暂无 SQL 记录
              </Typography.Text>
            )}
          </Card>

          <Card size="small" title="模板 / 业务知识命中">
            {decision ? (
              <Descriptions size="small" column={1}>
                <Descriptions.Item label="模式">
                  {decision.mode || '-'}
                </Descriptions.Item>
                <Descriptions.Item label="模板">
                  {decision.templateTitle || decision.templateId || '-'}
                </Descriptions.Item>
                <Descriptions.Item label="SQL 来源">
                  {decision.sqlSource || '-'}
                </Descriptions.Item>
                <Descriptions.Item label="降级原因">
                  {decision.fallbackReason || '-'}
                </Descriptions.Item>
                <Descriptions.Item label="得分">
                  {decision.score ?? '-'}
                </Descriptions.Item>
              </Descriptions>
            ) : (
              <Typography.Text style={textMutedStyle}>
                当前反馈没有记录模板决策信息。
              </Typography.Text>
            )}
          </Card>
        </Space>
      ) : null}
    </Drawer>
  );
}

export default function ManageFeedbackPage() {
  const router = useRouter();
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const authSession = useAuthSession();
  const showPlatformManagement = resolvePlatformManagementFromAuthSession(
    authSession.data,
  );
  const runtimeScopeSelector = useMemo(
    () => readRuntimeScopeSelectorFromObject(router.query),
    [router.query],
  );
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<ThreadResponseFeedbackListFilter>({});
  const [selectedFeedback, setSelectedFeedback] =
    useState<ThreadResponseFeedbackData | null>(null);
  const feedbackRequest = useThreadResponseFeedbackList({
    enabled: runtimeScopePage.hasRuntimeScope && authSession.authenticated,
    selector: runtimeScopeSelector,
    offset: (page - 1) * PAGE_SIZE,
    limit: PAGE_SIZE,
    filter: filters,
    onError: (error) => {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '加载问数反馈失败，请稍后重试。',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    },
  });
  const shellProps = buildSettingsConsoleShellProps({
    activeKey: 'settingsFeedback',
    onNavigate: runtimeScopeNavigation.pushWorkspace,
    showPlatformAdmin: showPlatformManagement,
  });
  const items = feedbackRequest.data?.items || [];
  const workspaceOptions = useMemo(
    () =>
      (feedbackRequest.data?.workspaces || []).map((workspace) => ({
        value: workspace.id,
        label: workspace.name || workspace.id,
      })),
    [feedbackRequest.data?.workspaces],
  );
  const knowledgeBaseOptions = useMemo(
    () =>
      (feedbackRequest.data?.knowledgeBases || [])
        .filter(
          (knowledgeBase) =>
            !filters.workspaceId ||
            knowledgeBase.workspaceId === filters.workspaceId,
        )
        .map((knowledgeBase) => ({
          value: knowledgeBase.id,
          label: knowledgeBase.name || knowledgeBase.id,
        })),
    [feedbackRequest.data?.knowledgeBases, filters.workspaceId],
  );
  const feedbackAccessDenied = isFeedbackAccessDeniedError(
    feedbackRequest.error,
  );

  const setFilterValue = <TKey extends keyof ThreadResponseFeedbackListFilter>(
    key: TKey,
    value: ThreadResponseFeedbackListFilter[TKey],
  ) => {
    setPage(1);
    setFilters((previous) => ({
      ...previous,
      [key]: value || undefined,
    }));
  };

  const setWorkspaceFilter = (workspaceId?: string | null) => {
    setPage(1);
    setFilters((previous) => ({
      ...previous,
      workspaceId: workspaceId || undefined,
      knowledgeBaseId: undefined,
    }));
  };

  const openThread = (feedback: ThreadResponseFeedbackData) => {
    void router.push(
      buildRuntimeScopeUrl(
        getThreadPath(feedback),
        {},
        {
          workspaceId: feedback.workspaceId || runtimeScopeSelector.workspaceId,
          knowledgeBaseId:
            feedback.knowledgeBaseId || runtimeScopeSelector.knowledgeBaseId,
          kbSnapshotId:
            feedback.kbSnapshotId || runtimeScopeSelector.kbSnapshotId,
          deployHash: feedback.deployHash || runtimeScopeSelector.deployHash,
          runtimeScopeId: runtimeScopeSelector.runtimeScopeId,
        },
      ),
    );
  };

  const columns: TableColumnsType<ThreadResponseFeedbackData> = [
    {
      title: '时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 170,
      render: (value: string | null | undefined) => (
        <Typography.Text style={textMutedStyle}>
          {value ? getAbsoluteTime(value) : '-'}
        </Typography.Text>
      ),
    },
    {
      title: '反馈',
      dataIndex: 'rating',
      key: 'rating',
      width: 110,
      render: (rating: ThreadResponseFeedbackRating) => (
        <FeedbackRatingTag rating={rating} />
      ),
    },
    {
      title: '范围',
      key: 'scope',
      width: 230,
      render: (_value, record) => <FeedbackScopeCell record={record} />,
    },
    {
      title: '问题 / SQL',
      key: 'question',
      width: 420,
      render: (_value, record) => <FeedbackQuestionCell record={record} />,
    },
    {
      title: '原因',
      dataIndex: 'reasonCodes',
      key: 'reasonCodes',
      width: 220,
      render: (reasons: ThreadResponseFeedbackReason[]) => (
        <FeedbackReasonTags reasons={reasons} />
      ),
    },
    {
      title: '模板决策',
      key: 'templateDecision',
      width: 220,
      render: (_value, record) => <FeedbackTemplateCell record={record} />,
    },
    {
      title: '来源',
      dataIndex: 'source',
      key: 'source',
      width: 120,
      render: (source: string | null | undefined) => getSourceLabel(source),
    },
    {
      title: '操作',
      key: 'actions',
      width: 96,
      fixed: 'right',
      align: 'center',
      render: (_value, record) => (
        <Button
          className="feedback-view-button"
          type="link"
          size="small"
          icon={<EyeOutlined />}
          onClick={() => setSelectedFeedback(record)}
        >
          查看
        </Button>
      ),
    },
  ];

  return (
    <ConsoleShellLayout
      title="问数反馈"
      description="查看你拥有 feedback.read 权限的所有工作空间问数反馈，定位需要优化的 SQL、图表与业务知识。"
      eyebrow="Answer Feedback"
      loading={runtimeScopePage.guarding || authSession.loading}
      {...shellProps}
    >
      {!authSession.authenticated ? (
        <Alert
          className="console-alert"
          type="warning"
          showIcon
          title="当前未登录"
          description="请先登录后再查看问数反馈。"
        />
      ) : feedbackAccessDenied ? (
        <Alert
          type="info"
          showIcon
          title="暂无查看权限"
          description="需要 feedback.read 权限才能查看问数结果反馈。请联系工作空间所有者或管理员调整角色。"
        />
      ) : (
        <section className="feedback-list-section">
          <Space className="feedback-filter-bar" wrap size={12}>
            <Select
              className="feedback-filter-control"
              allowClear
              placeholder="工作空间"
              style={{ width: 200 }}
              value={filters.workspaceId || undefined}
              options={workspaceOptions}
              onChange={(value) => setWorkspaceFilter(value || undefined)}
            />
            <Select
              className="feedback-filter-control"
              allowClear
              placeholder="知识库"
              style={{ width: 200 }}
              value={filters.knowledgeBaseId || undefined}
              options={knowledgeBaseOptions}
              onChange={(value) =>
                setFilterValue('knowledgeBaseId', value || undefined)
              }
            />
            <Select
              className="feedback-filter-control"
              allowClear
              placeholder="反馈类型"
              style={{ width: 140 }}
              value={filters.rating || undefined}
              options={THREAD_RESPONSE_FEEDBACK_RATING_OPTIONS}
              onChange={(value) => setFilterValue('rating', value || undefined)}
            />
            <Select
              className="feedback-filter-control"
              allowClear
              placeholder="负反馈原因"
              style={{ width: 220 }}
              value={filters.reasonCode || undefined}
              options={THREAD_RESPONSE_FEEDBACK_REASON_OPTIONS}
              onChange={(value) =>
                setFilterValue('reasonCode', value || undefined)
              }
            />
            <Select
              className="feedback-filter-control"
              allowClear
              placeholder="来源"
              style={{ width: 150 }}
              value={filters.source || undefined}
              options={[...THREAD_RESPONSE_FEEDBACK_SOURCE_OPTIONS]}
              onChange={(value) => setFilterValue('source', value || undefined)}
            />
            <Input.Search
              className="feedback-filter-search"
              allowClear
              placeholder="搜索问题、SQL、备注、模板或 ID"
              style={{ width: 360 }}
              onSearch={(value) => setFilterValue('keyword', value)}
              onChange={(event) => {
                if (!event.target.value) {
                  setFilterValue('keyword', undefined);
                }
              }}
            />
          </Space>

          <Table
            className="console-table feedback-table"
            rowKey="id"
            size="middle"
            tableLayout="fixed"
            loading={feedbackRequest.loading}
            columns={columns}
            dataSource={items}
            locale={{ emptyText: '暂无问数反馈' }}
            pagination={{
              current: page,
              pageSize: PAGE_SIZE,
              total: feedbackRequest.data?.total || 0,
              showSizeChanger: false,
              hideOnSinglePage: false,
              position: ['bottomRight'],
              showTotal: (total) => `共 ${total} 条`,
            }}
            scroll={{ x: 1420 }}
            onChange={(pagination) => setPage(pagination.current || 1)}
          />
        </section>
      )}

      <FeedbackDetailsDrawer
        open={Boolean(selectedFeedback)}
        feedback={selectedFeedback}
        onClose={() => setSelectedFeedback(null)}
        onOpenThread={openThread}
      />
      <style jsx global>
        {feedbackPageStyles}
      </style>
    </ConsoleShellLayout>
  );
}

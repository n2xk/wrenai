import { useMemo, useState } from 'react';
import { Button, Tag, Typography } from 'antd';
import {
  BulbOutlined,
  DownOutlined,
  RightOutlined,
  CheckCircleFilled,
  ClockCircleFilled,
} from '@ant-design/icons';
import styled from 'styled-components';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { Path } from '@/utils/enum';
import type { ModelingAssistantTaskSummary } from './modelingAssistantStatus';

const { Paragraph, Text } = Typography;

const LauncherCard = styled.div`
  border: 1px solid var(--nova-outline-soft);
  border-radius: 18px;
  background: linear-gradient(180deg, #ffffff 0%, #faf8ff 100%);
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.04);
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const LauncherHeaderButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 16px;
  border: 0;
  background: transparent;
  padding: 0;
  cursor: pointer;
`;

const LauncherActions = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const LauncherStatusText = styled.div<{ $tone: 'todo' | 'done' }>`
  font-size: 12px;
  font-weight: 700;
  color: ${(props) => (props.$tone === 'done' ? '#15803d' : '#6d4aff')};
`;

const LauncherSummaryRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;

const LauncherSummaryPill = styled.div<{
  $tone?: 'default' | 'success' | 'warning';
}>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 700;
  color: ${(props) => {
    if (props.$tone === 'success') return '#166534';
    if (props.$tone === 'warning') return '#b45309';
    return '#475467';
  }};
  background: ${(props) => {
    if (props.$tone === 'success') return 'rgba(22, 101, 52, 0.1)';
    if (props.$tone === 'warning') return 'rgba(180, 83, 9, 0.12)';
    return '#f4f4f5';
  }};
`;

const LauncherActionButton = styled(Button)`
  &.ant-btn {
    height: auto;
    min-height: 82px;
    padding: 14px 16px;
    border-radius: 14px;
    border: 1px solid rgba(109, 74, 255, 0.12);
    background: #fff;
    box-shadow: 0 8px 20px rgba(111, 71, 255, 0.08);
  }
`;

const ActionRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
`;

const ActionMeta = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-width: 0;
`;

const ActionDetailText = styled.div`
  color: #667085;
  font-size: 12px;
  line-height: 1.5;
  text-align: right;
  max-width: 210px;
`;

const items = [
  {
    summaryKey: 'semantics',
    key: Path.RecommendSemantics,
    title: '推荐语义描述',
    description: '使用 AI 为模型和字段生成描述。',
  },
  {
    summaryKey: 'relationships',
    key: Path.RecommendRelationships,
    title: '推荐关联关系',
    description: '生成关联关系建议，并在保存前进行审核。',
  },
] as const;

export default function ModelingAssistantLauncher({
  disabled = false,
  summaries = [],
}: {
  disabled?: boolean;
  summaries?: ModelingAssistantTaskSummary[];
}) {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const [expanded, setExpanded] = useState(false);
  const hasTodo =
    summaries.length === 0 ||
    summaries.some((summary) => summary.state === 'todo');
  const completedCount = summaries.filter(
    (summary) => summary.state === 'done',
  ).length;
  const pendingCount = summaries.length - completedCount;
  const summaryByKey = useMemo(
    () =>
      Object.fromEntries(summaries.map((summary) => [summary.key, summary])),
    [summaries],
  );

  const actionButtons = useMemo(
    () =>
      items.map((item) => (
        <LauncherActionButton
          key={item.key}
          block
          disabled={disabled}
          onClick={() => runtimeScopeNavigation.pushWorkspace(item.key)}
        >
          <ActionRow>
            <ActionMeta>
              <Text strong>{item.title}</Text>
              <Text type="secondary">{item.description}</Text>
            </ActionMeta>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <LauncherStatusText
                $tone={summaryByKey[item.summaryKey]?.state || 'todo'}
              >
                {summaryByKey[item.summaryKey]?.countLabel || '1'}{' '}
                {summaryByKey[item.summaryKey]?.state === 'done'
                  ? '已完成'
                  : '待处理'}
              </LauncherStatusText>
              <Tag
                color={
                  summaryByKey[item.summaryKey]?.state === 'done'
                    ? 'success'
                    : 'processing'
                }
                style={{ marginInlineEnd: 0 }}
              >
                AI
              </Tag>
              <ActionDetailText>
                {summaryByKey[item.summaryKey]?.detailLabel}
              </ActionDetailText>
            </div>
          </ActionRow>
        </LauncherActionButton>
      )),
    [disabled, runtimeScopeNavigation, summaryByKey],
  );

  return (
    <LauncherCard data-guideid="modeling-copilot">
      <LauncherHeaderButton
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(109, 74, 255, 0.12)',
              color: '#6d4aff',
              flex: '0 0 auto',
            }}
          >
            <BulbOutlined />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Tag
              color={hasTodo ? 'gold' : 'success'}
              style={{ width: 'fit-content' }}
            >
              {hasTodo ? '待设置' : '已完成'}
            </Tag>
            <Text strong style={{ fontSize: 16 }}>
              建模 AI 助手
            </Text>
            <Paragraph
              style={{ marginBottom: 0, color: '#667085', maxWidth: 720 }}
            >
              通过 AI 引导的语义与关联关系设置，提升建模准确度。
            </Paragraph>
            <LauncherSummaryRow>
              <LauncherSummaryPill>
                {summaries.length || items.length} 个流程
              </LauncherSummaryPill>
              <LauncherSummaryPill $tone={hasTodo ? 'warning' : 'success'}>
                {hasTodo ? <ClockCircleFilled /> : <CheckCircleFilled />}
                {hasTodo
                  ? `${pendingCount} 个待完成`
                  : `${completedCount} 个已完成`}
              </LauncherSummaryPill>
            </LauncherSummaryRow>
          </div>
        </div>
        {expanded ? <DownOutlined /> : <RightOutlined />}
      </LauncherHeaderButton>
      {expanded ? <LauncherActions>{actionButtons}</LauncherActions> : null}
    </LauncherCard>
  );
}

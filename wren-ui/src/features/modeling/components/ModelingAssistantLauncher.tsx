import { useEffect, useMemo, useState } from 'react';
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
import type { ModelingAssistantIntent } from '../assistant/modelingAssistantRoutes';

const { Text } = Typography;

const LauncherCard = styled.div`
  border: 1px solid var(--nova-outline-soft);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.035);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
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
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 8px;
`;

const LauncherHeaderMain = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
`;

const LauncherIcon = styled.div`
  width: 28px;
  height: 28px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(109, 74, 255, 0.1);
  color: #6d4aff;
  flex: 0 0 auto;
`;

const LauncherTitleStack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
`;

const LauncherTitleRow = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
`;

const LauncherStatusText = styled.div<{ $tone: 'todo' | 'done' }>`
  font-size: 12px;
  font-weight: 700;
  color: ${(props) => (props.$tone === 'done' ? '#15803d' : '#6d4aff')};
`;

const LauncherSummaryRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
`;

const LauncherSummaryPill = styled.div<{
  $tone?: 'default' | 'success' | 'warning';
}>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 21px;
  border-radius: 999px;
  padding: 0 8px;
  font-size: 11px;
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
    min-height: 52px;
    padding: 8px 10px;
    border-radius: 12px;
    border: 1px solid rgba(109, 74, 255, 0.12);
    background: #fff;
    box-shadow: none;

    &:hover {
      border-color: rgba(109, 74, 255, 0.22);
      box-shadow: 0 8px 18px rgba(15, 23, 42, 0.05);
    }
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
  gap: 2px;
  min-width: 0;

  .ant-typography {
    line-height: 1.35;
  }
`;

const ActionDetailText = styled.div`
  color: #667085;
  font-size: 11px;
  line-height: 1.35;
  text-align: right;
  max-width: 210px;
`;

const ActionStatusColumn = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  min-width: 108px;
`;

const items = [
  {
    summaryKey: 'semantics',
    intent: 'semantics',
    key: Path.RecommendSemantics,
    title: '推荐语义描述',
    description: '使用 AI 为模型和字段生成描述。',
  },
  {
    summaryKey: 'relationships',
    intent: 'relationships',
    key: Path.RecommendRelationships,
    title: '推荐关联关系',
    description: '生成关联关系建议，并在保存前进行审核。',
  },
] as const satisfies readonly {
  summaryKey: ModelingAssistantIntent;
  intent: ModelingAssistantIntent;
  key: Path;
  title: string;
  description: string;
}[];

export default function ModelingAssistantLauncher({
  disabled = false,
  summaries = [],
  onOpenAssistant,
}: {
  disabled?: boolean;
  summaries?: ModelingAssistantTaskSummary[];
  onOpenAssistant?: (intent: ModelingAssistantIntent) => void;
}) {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const hasTodo =
    summaries.length === 0 ||
    summaries.some((summary) => summary.state === 'todo');
  const completedCount = summaries.filter(
    (summary) => summary.state === 'done',
  ).length;
  const flowCount = summaries.length || items.length;
  const pendingCount = summaries.length
    ? summaries.length - completedCount
    : items.length;
  const [expanded, setExpanded] = useState(hasTodo);
  const [userToggled, setUserToggled] = useState(false);
  const summaryByKey = useMemo(
    () =>
      Object.fromEntries(summaries.map((summary) => [summary.key, summary])),
    [summaries],
  );

  useEffect(() => {
    if (!userToggled) {
      setExpanded(hasTodo);
    }
  }, [hasTodo, userToggled]);

  const actionButtons = useMemo(
    () =>
      items.map((item) => {
        const summary = summaryByKey[item.summaryKey];
        const state = summary?.state || 'todo';

        return (
          <LauncherActionButton
            key={item.key}
            block
            disabled={disabled}
            onClick={() => {
              if (onOpenAssistant) {
                onOpenAssistant(item.intent);
                return;
              }

              runtimeScopeNavigation.pushWorkspace(item.key);
            }}
          >
            <ActionRow>
              <ActionMeta>
                <Text strong>{item.title}</Text>
                <Text type="secondary">{item.description}</Text>
              </ActionMeta>
              <ActionStatusColumn>
                <LauncherStatusText $tone={state}>
                  {summary?.countLabel || '1'}{' '}
                  {state === 'done' ? '已完成' : '待处理'}
                </LauncherStatusText>
                <Tag
                  color={state === 'done' ? 'success' : 'processing'}
                  style={{ marginInlineEnd: 0 }}
                >
                  AI
                </Tag>
                <ActionDetailText>
                  {summary?.detailLabel || item.description}
                </ActionDetailText>
              </ActionStatusColumn>
            </ActionRow>
          </LauncherActionButton>
        );
      }),
    [disabled, onOpenAssistant, runtimeScopeNavigation, summaryByKey],
  );

  return (
    <LauncherCard data-guideid="modeling-copilot">
      <LauncherHeaderButton
        type="button"
        aria-expanded={expanded}
        aria-label={expanded ? '收起建模 AI 助手' : '展开建模 AI 助手'}
        onClick={() => {
          setUserToggled(true);
          setExpanded((value) => !value);
        }}
      >
        <LauncherHeaderMain>
          <LauncherIcon>
            <BulbOutlined />
          </LauncherIcon>
          <LauncherTitleStack>
            <LauncherTitleRow>
              <Text strong style={{ fontSize: 15 }}>
                建模 AI 助手
              </Text>
              <Tag
                color={hasTodo ? 'gold' : 'success'}
                style={{ marginInlineEnd: 0 }}
              >
                {hasTodo ? '待设置' : '已完成'}
              </Tag>
              <Text type="secondary">语义描述与关联关系建议</Text>
            </LauncherTitleRow>
            <LauncherSummaryRow>
              <LauncherSummaryPill>{flowCount} 个流程</LauncherSummaryPill>
              <LauncherSummaryPill $tone={hasTodo ? 'warning' : 'success'}>
                {hasTodo ? <ClockCircleFilled /> : <CheckCircleFilled />}
                {hasTodo
                  ? `${pendingCount} 个待完成`
                  : `${completedCount} 个已完成`}
              </LauncherSummaryPill>
            </LauncherSummaryRow>
          </LauncherTitleStack>
        </LauncherHeaderMain>
        {expanded ? <DownOutlined /> : <RightOutlined />}
      </LauncherHeaderButton>
      {expanded ? <LauncherActions>{actionButtons}</LauncherActions> : null}
    </LauncherCard>
  );
}

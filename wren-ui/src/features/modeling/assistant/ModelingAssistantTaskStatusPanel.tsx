import { Tag, Typography } from 'antd';
import styled from 'styled-components';
import type { ModelingAssistantTaskStatus } from '@/types/modelingAssistant';

const { Text } = Typography;

export type ModelingAssistantObservableTask = {
  id?: string | null;
  status?: ModelingAssistantTaskStatus | null;
  traceId?: string | null;
  error?: { message?: string | null } | null;
};

export type ModelingAssistantTaskStatusPresentation = {
  statusLabel: string;
  statusTone: 'default' | 'processing' | 'success' | 'error';
  summary: string;
  detailItems: Array<{ label: string; value: string }>;
};

const StatusPanel = styled.div`
  border: 1px solid rgba(109, 74, 255, 0.14);
  border-radius: 16px;
  background: #fbfaff;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const StatusHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
`;

const DetailGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 8px 12px;
`;

const DetailItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
`;

const normalizeTaskStatus = (status?: ModelingAssistantTaskStatus | null) =>
  status || 'GENERATING';

export const resolveModelingAssistantTaskStatusPresentation = ({
  task,
  resultCount = 0,
  resultLabel,
  saved = false,
}: {
  task?: ModelingAssistantObservableTask | null;
  resultCount?: number;
  resultLabel: string;
  saved?: boolean;
}): ModelingAssistantTaskStatusPresentation => {
  if (!task) {
    return {
      statusLabel: '准备中',
      statusTone: 'processing',
      summary: '正在创建任务并等待 AI 服务返回任务 ID。',
      detailItems: [{ label: '任务状态', value: '未创建' }],
    };
  }

  const status = normalizeTaskStatus(task.status);
  const statusMeta = {
    GENERATING: {
      statusLabel: '生成中',
      statusTone: 'processing' as const,
      summary: '任务已创建，正在轮询 AI 服务状态。',
    },
    FINISHED: {
      statusLabel: saved ? '已保存' : '已完成',
      statusTone: 'success' as const,
      summary: saved
        ? `任务完成，${resultLabel}已保存到当前语义模型。`
        : `任务完成，已返回 ${resultCount} 条${resultLabel}。`,
    },
    FAILED: {
      statusLabel: '失败',
      statusTone: 'error' as const,
      summary: task.error?.message || '任务失败，请查看错误信息后重试。',
    },
  }[status];

  return {
    ...statusMeta,
    detailItems: [
      { label: '任务 ID', value: task.id || '-' },
      { label: '任务状态', value: status },
      { label: resultLabel, value: `${resultCount}` },
      ...(task.traceId ? [{ label: 'Trace ID', value: task.traceId }] : []),
    ],
  };
};

export default function ModelingAssistantTaskStatusPanel({
  task,
  resultCount = 0,
  resultLabel,
  saved = false,
  testId = 'modeling-assistant-task-status',
}: {
  task?: ModelingAssistantObservableTask | null;
  resultCount?: number;
  resultLabel: string;
  saved?: boolean;
  testId?: string;
}) {
  const presentation = resolveModelingAssistantTaskStatusPresentation({
    task,
    resultCount,
    resultLabel,
    saved,
  });

  return (
    <StatusPanel
      data-testid={testId}
      data-task-status={task?.status || 'PENDING'}
    >
      <StatusHeader>
        <Text strong>任务状态</Text>
        <Tag color={presentation.statusTone}>{presentation.statusLabel}</Tag>
      </StatusHeader>
      <Text type="secondary">{presentation.summary}</Text>
      <DetailGrid>
        {presentation.detailItems.map((item) => (
          <DetailItem key={item.label}>
            <Text type="secondary">{item.label}</Text>
            <Text code copyable={item.label.includes('ID')}>
              {item.value}
            </Text>
          </DetailItem>
        ))}
      </DetailGrid>
    </StatusPanel>
  );
}

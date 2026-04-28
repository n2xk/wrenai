import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Empty,
  Popconfirm,
  Space,
  Spin,
  Table,
  Typography,
} from 'antd';
import { DeleteOutlined, EditOutlined } from '@ant-design/icons';
import styled from 'styled-components';
import { appMessage as message } from '@/utils/antdAppBridge';
import type {
  RelationFormValues,
  RelationFieldValue,
} from '@/components/modals/RelationModal';
import RelationModal from '@/components/modals/RelationModal';
import useModalAction from '@/hooks/useModalAction';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import ModelingAssistantRouteLayout from '../ModelingAssistantRouteLayout';
import { buildModelingAssistantBackParams } from '../modelingAssistantRoutes';
import useModelingAssistantLeaveGuard from '../useModelingAssistantLeaveGuard';
import useModelingAssistantReadonly from '../useModelingAssistantReadonly';
import useRecommendRelationshipsTask from './useRecommendRelationshipsTask';
import ModelingAssistantTaskStatusPanel from '../ModelingAssistantTaskStatusPanel';
import { Path } from '@/utils/enum';
import { getJoinTypeText } from '@/utils/data';
import {
  AssistantColumn,
  AssistantFooterBar,
  AssistantIntroCard,
  AssistantMetricCard,
  AssistantMetricGrid,
  AssistantMutedText,
  AssistantPill,
  AssistantPillRow,
  AssistantSectionCard,
  AssistantSectionHeader,
  AssistantStateCard,
} from '../modelingAssistantVisuals';

const { Paragraph, Text } = Typography;

type ModelingAssistantCompletionHandler = () => void | Promise<void>;

const RelationshipTableCard = styled.div`
  border: 1px solid #e5e7eb;
  border-radius: 18px;
  padding: 18px 20px;
  background: #fff;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.04);

  .ant-table {
    background: transparent;
  }

  .ant-table-thead > tr > th {
    background: #faf8ff;
    color: #475467;
    font-size: 12px;
    font-weight: 700;
    border-bottom: 1px solid rgba(109, 74, 255, 0.12);
  }

  .ant-table-tbody > tr > td {
    padding-top: 14px;
    padding-bottom: 14px;
    vertical-align: top;
  }
`;

const RowActionButton = styled.button`
  width: 30px;
  height: 30px;
  border-radius: 10px;
  border: 1px solid rgba(109, 74, 255, 0.12);
  background: #f8f7ff;
  color: #6d4aff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
`;

type SelectedRelationState = {
  modelName: string;
  relationKey: string;
  defaultValue: RelationFieldValue;
};

const buildRelationKey = (relation: RelationFieldValue) =>
  `${relation.fromField.fieldId}-${relation.toField.fieldId}-${relation.type}`;

const columns = ({
  modelName,
  onEdit,
  onDelete,
}: {
  modelName: string;
  onEdit: (payload: SelectedRelationState) => void;
  onDelete: (modelName: string, relationKey: string) => void;
}) => [
  {
    title: '来源',
    dataIndex: 'fromField',
    key: 'fromField',
    render: (value: any) => `${value.modelName}.${value.fieldName}`,
  },
  {
    title: '目标',
    dataIndex: 'toField',
    key: 'toField',
    render: (value: any) => `${value.modelName}.${value.fieldName}`,
  },
  {
    title: '类型',
    dataIndex: 'type',
    key: 'type',
    render: (value: string) => getJoinTypeText(value),
  },
  {
    title: '描述',
    dataIndex: 'properties',
    key: 'description',
    render: (value: Record<string, any> | undefined) =>
      value?.description || '-',
  },
  {
    title: '',
    key: 'actions',
    width: 96,
    render: (_: unknown, relation: RelationFieldValue) => {
      const relationKey = buildRelationKey(relation);
      return (
        <Space size={16}>
          <RowActionButton
            type="button"
            aria-label="编辑关联关系"
            onClick={() =>
              onEdit({
                modelName,
                relationKey,
                defaultValue: relation,
              })
            }
          >
            <EditOutlined />
          </RowActionButton>
          <Popconfirm
            title="确认删除这条关联关系吗？"
            okText="删除"
            cancelText="取消"
            onConfirm={() => onDelete(modelName, relationKey)}
          >
            <RowActionButton type="button" aria-label="删除关联关系">
              <DeleteOutlined />
            </RowActionButton>
          </Popconfirm>
        </Space>
      );
    },
  },
];

export function RecommendRelationshipsAssistantContent({
  onBack,
  onSaveSuccess,
}: {
  onBack?: ModelingAssistantCompletionHandler;
  onSaveSuccess?: ModelingAssistantCompletionHandler;
}) {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const modelingAssistantReadonly = useModelingAssistantReadonly();
  const relationModal = useModalAction<RelationFieldValue>();
  const [selectedRelation, setSelectedRelation] =
    useState<SelectedRelationState | null>(null);

  const relationshipsTask = useRecommendRelationshipsTask({
    enabled:
      runtimeScopePage.hasRuntimeScope && !modelingAssistantReadonly.isReadOnly,
    selector: runtimeScopeNavigation.selector,
    onSaveSuccess: async () => {
      message.success('关联关系保存成功。');
      await onSaveSuccess?.();
    },
  });

  const tableBlocks = useMemo(
    () =>
      Object.entries(relationshipsTask.editedRelations).map(
        ([modelName, relations]) => (
          <RelationshipTableCard key={modelName}>
            <Text strong style={{ display: 'block', marginBottom: 12 }}>
              {relationshipsTask.recommendNameMapping[modelName] || modelName}
            </Text>
            <Table
              className="console-table"
              rowKey={(relation) => buildRelationKey(relation)}
              columns={columns({
                modelName,
                onEdit: (payload) => {
                  setSelectedRelation(payload);
                  relationModal.openModal(payload.defaultValue);
                },
                onDelete: relationshipsTask.onDeleteRow,
              })}
              dataSource={relations}
              pagination={false}
            />
          </RelationshipTableCard>
        ),
      ),
    [
      relationModal,
      relationshipsTask.editedRelations,
      relationshipsTask.onDeleteRow,
      relationshipsTask.recommendNameMapping,
    ],
  );

  const renderContent = () => {
    if (runtimeScopePage.guarding || relationshipsTask.modelListLoading) {
      return (
        <AssistantStateCard $align="center">
          <Spin />
          <Text strong>正在加载建模 AI 助手上下文</Text>
          <AssistantMutedText>
            正在检查当前模型，并准备关联关系推荐结果。
          </AssistantMutedText>
        </AssistantStateCard>
      );
    }

    if (modelingAssistantReadonly.isReadOnly) {
      return (
        <AssistantColumn>
          <AssistantIntroCard>
            <AssistantPillRow>
              <AssistantPill $tone="warning">只读快照</AssistantPill>
            </AssistantPillRow>
            <Alert
              type="warning"
              showIcon
              title="历史快照中暂不支持建模 AI 助手"
              description={modelingAssistantReadonly.readOnlyHint}
            />
          </AssistantIntroCard>
        </AssistantColumn>
      );
    }

    if (relationshipsTask.requestError) {
      return (
        <AssistantColumn>
          <AssistantIntroCard>
            <AssistantPillRow>
              <AssistantPill $tone="warning">需要重试</AssistantPill>
            </AssistantPillRow>
            <Alert
              type="error"
              showIcon
              title="加载关联关系推荐失败"
              description={relationshipsTask.requestError}
              action={
                <Button
                  size="small"
                  onClick={() => void relationshipsTask.retry()}
                >
                  重试
                </Button>
              }
            />
          </AssistantIntroCard>
        </AssistantColumn>
      );
    }

    if (!relationshipsTask.task) {
      return (
        <AssistantStateCard $align="center">
          <Spin />
          <Text strong>正在准备关联关系推荐</Text>
        </AssistantStateCard>
      );
    }

    if (relationshipsTask.polling && !relationshipsTask.task?.response) {
      return (
        <AssistantStateCard $align="center">
          <Spin size="large" />
          <Paragraph style={{ marginTop: 16, marginBottom: 0 }}>
            正在生成，生成结果最多可能需要一分钟。
          </Paragraph>
        </AssistantStateCard>
      );
    }

    if (relationshipsTask.emptyState) {
      return (
        <AssistantColumn>
          <AssistantIntroCard>
            <AssistantSectionHeader>
              <div>
                <Text strong>推荐状态</Text>
                <AssistantMutedText>
                  本次运行已成功完成，但当前没有新的关联关系建议可应用。
                </AssistantMutedText>
              </div>
            </AssistantSectionHeader>
            <AssistantPillRow>
              <AssistantPill $tone="success">审核完成</AssistantPill>
              <AssistantPill>没有可保存的变更</AssistantPill>
            </AssistantPillRow>
          </AssistantIntroCard>
          <ModelingAssistantTaskStatusPanel
            task={relationshipsTask.task}
            resultCount={0}
            resultLabel="关联关系"
            testId="relationship-assistant-task-status"
          />
          <AssistantStateCard $align="center">
            <Empty
              description={
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                >
                  <Text strong>暂无新增关联关系建议</Text>
                  <Text type="secondary">当前没有推荐的关联关系。</Text>
                </div>
              }
            />
          </AssistantStateCard>
          <AssistantSectionCard>
            <AssistantFooterBar>
              <AssistantMutedText>
                当前没有可应用的关联关系建议。
              </AssistantMutedText>
              <Space>
                <Button onClick={() => void onBack?.()}>取消并返回</Button>
                <Button disabled>保存</Button>
              </Space>
            </AssistantFooterBar>
          </AssistantSectionCard>
        </AssistantColumn>
      );
    }

    const recommendationCount = Object.values(
      relationshipsTask.editedRelations,
    ).flat().length;
    const rawRecommendationCount =
      relationshipsTask.task?.response?.relationships?.length || 0;
    const modelCount = Object.keys(relationshipsTask.editedRelations).length;

    return (
      <AssistantColumn>
        <ModelingAssistantTaskStatusPanel
          task={relationshipsTask.task}
          resultCount={recommendationCount || rawRecommendationCount}
          resultLabel="关联关系"
          testId="relationship-assistant-task-status"
        />
        <AssistantIntroCard>
          <AssistantSectionHeader>
            <div>
              <Text strong>推荐状态</Text>
              <AssistantMutedText>
                请先审核推荐的关联关系，处理特殊情况后，再保存回当前语义层。
              </AssistantMutedText>
            </div>
          </AssistantSectionHeader>
          <AssistantPillRow>
            <AssistantPill $tone="accent">
              {recommendationCount} 条推荐
            </AssistantPill>
            <AssistantPill $tone="success">可保存</AssistantPill>
          </AssistantPillRow>
        </AssistantIntroCard>
        <AssistantMetricGrid>
          <AssistantMetricCard>
            <Text type="secondary">推荐变更</Text>
            <Text strong style={{ fontSize: 18 }}>
              {recommendationCount}
            </Text>
          </AssistantMetricCard>
          <AssistantMetricCard>
            <Text type="secondary">影响模型</Text>
            <Text strong style={{ fontSize: 18 }}>
              {modelCount}
            </Text>
          </AssistantMetricCard>
        </AssistantMetricGrid>
        {tableBlocks}
        <AssistantSectionCard>
          <AssistantFooterBar>
            <AssistantMutedText>
              保存前可编辑或删除推荐项；只有在确认保存后才会真正生效。
            </AssistantMutedText>
            <Button
              type="primary"
              onClick={() => void relationshipsTask.save()}
              loading={relationshipsTask.saving}
              disabled={!relationshipsTask.hasResult}
            >
              保存
            </Button>
          </AssistantFooterBar>
        </AssistantSectionCard>
      </AssistantColumn>
    );
  };

  return (
    <>
      {renderContent()}
      <RelationModal
        {...relationModal.state}
        onClose={() => {
          setSelectedRelation(null);
          relationModal.closeModal();
        }}
        onSubmit={async (values: RelationFormValues) => {
          if (!selectedRelation) {
            return;
          }
          relationshipsTask.onUpdateRelation({
            modelName: selectedRelation.modelName,
            originalRelationKey: selectedRelation.relationKey,
            values,
          });
          setSelectedRelation(null);
        }}
        model={selectedRelation?.defaultValue.fromField.modelName || ''}
        relations={relationshipsTask.editedRelations}
        defaultValue={selectedRelation?.defaultValue}
        isRecommendMode
        showDescriptionField
      />
    </>
  );
}

export default function RecommendRelationshipsPage() {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const navigateBack = async () => {
    await runtimeScopeNavigation.pushWorkspace(
      Path.Knowledge,
      buildModelingAssistantBackParams(),
    );
  };

  const leaveGuard = useModelingAssistantLeaveGuard({
    onLeave: navigateBack,
  });

  return (
    <ModelingAssistantRouteLayout
      title="生成关联关系"
      description="建模 AI 助手会用 AI 识别模型之间潜在的连接关系。请先审核并按需调整，再保存到当前数据模型。"
      onBack={leaveGuard.onBackClick}
    >
      <RecommendRelationshipsAssistantContent
        onBack={leaveGuard.onBackClick}
        onSaveSuccess={navigateBack}
      />
    </ModelingAssistantRouteLayout>
  );
}

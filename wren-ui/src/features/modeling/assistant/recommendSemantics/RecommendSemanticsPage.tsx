import { useMemo } from 'react';
import { Alert, Button, Checkbox, Input, Space, Spin, Typography } from 'antd';
import styled from 'styled-components';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import ModelingAssistantRouteLayout from '../ModelingAssistantRouteLayout';
import { buildModelingAssistantBackParams } from '../modelingAssistantRoutes';
import useModelingAssistantLeaveGuard from '../useModelingAssistantLeaveGuard';
import useModelingAssistantReadonly from '../useModelingAssistantReadonly';
import useRecommendSemanticsWizard from './useRecommendSemanticsWizard';
import GeneratedSemanticsReview from './GeneratedSemanticsReview';
import ModelingAssistantTaskStatusPanel from '../ModelingAssistantTaskStatusPanel';
import { Path } from '@/utils/enum';
import {
  AssistantColumn,
  AssistantDocLink,
  AssistantFooterBar,
  AssistantIntroCard,
  AssistantMetricCard,
  AssistantMetricGrid,
  AssistantMutedText,
  AssistantPill,
  AssistantPillRow,
  AssistantPromptChip,
  AssistantSectionCard,
  AssistantSectionHeader,
  AssistantStateCard,
} from '../modelingAssistantVisuals';

const { Paragraph, Text, Title } = Typography;

const ModelPickList = styled.div`
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const ModelPickRow = styled.label`
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 14px;
  border: 1px solid rgba(109, 74, 255, 0.12);
  background: #faf8ff;
  cursor: pointer;
`;

export default function RecommendSemanticsPage() {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const modelingAssistantReadonly = useModelingAssistantReadonly();

  const navigateBack = async () => {
    await runtimeScopeNavigation.pushWorkspace(
      Path.Knowledge,
      buildModelingAssistantBackParams(),
    );
  };

  const leaveGuard = useModelingAssistantLeaveGuard({
    onLeave: navigateBack,
  });

  const semanticsWizard = useRecommendSemanticsWizard({
    enabled:
      runtimeScopePage.hasRuntimeScope && !modelingAssistantReadonly.isReadOnly,
    selector: runtimeScopeNavigation.selector,
    onSaveSuccess: navigateBack,
  });

  const selectedModelCount = semanticsWizard.selectedModels.length;
  const generatedStateTitle = useMemo(
    () => (semanticsWizard.completed ? '已生成的语义描述' : '示例提示词'),
    [semanticsWizard.completed],
  );

  const renderPickStep = () => {
    if (runtimeScopePage.guarding || semanticsWizard.modelList.loading) {
      return (
        <AssistantStateCard $align="center">
          <Spin />
          <Text strong>正在加载模型</Text>
          <AssistantMutedText>
            正在准备可用于补充语义描述的模型。
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

    return (
      <AssistantColumn>
        <AssistantIntroCard>
          <AssistantSectionHeader>
            <div>
              <Text strong>助手设置</Text>
              <AssistantMutedText>
                选择需要补充描述的模型，再生成简洁、贴近业务的模型和字段说明后保存。
              </AssistantMutedText>
            </div>
            <AssistantDocLink
              href="https://docs.getwren.ai/cp/guide/modeling-ai-assistant"
              target="_blank"
              rel="noreferrer"
            >
              了解更多
            </AssistantDocLink>
          </AssistantSectionHeader>
          <AssistantPillRow>
            <AssistantPill $tone="accent">第 1 步 / 共 2 步</AssistantPill>
            <AssistantPill
              $tone={selectedModelCount > 0 ? 'success' : 'warning'}
            >
              已选择 {selectedModelCount} 个模型
            </AssistantPill>
          </AssistantPillRow>
        </AssistantIntroCard>
        <AssistantSectionCard>
          <Title level={4} style={{ marginTop: 0 }}>
            选择模型
          </Title>
          <AssistantMutedText>
            勾选需要由助手生成描述的模型。继续下一步时会校验是否已完成选择。
          </AssistantMutedText>
          <ModelPickList>
            {(semanticsWizard.modelList.data || []).map((model) => (
              <ModelPickRow key={model.referenceName}>
                <Checkbox
                  checked={semanticsWizard.selectedModels.includes(
                    model.referenceName,
                  )}
                  onChange={(event) =>
                    semanticsWizard.onToggleModel(
                      model.referenceName,
                      event.target.checked,
                    )
                  }
                />
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                >
                  <Text strong>{model.displayName}</Text>
                  <Text type="secondary">{model.referenceName}</Text>
                </div>
              </ModelPickRow>
            ))}
          </ModelPickList>
          {semanticsWizard.validationError ? (
            <Alert
              style={{ marginTop: 16 }}
              type="error"
              showIcon
              title={semanticsWizard.validationError}
            />
          ) : null}
        </AssistantSectionCard>
        <AssistantSectionCard>
          <AssistantFooterBar>
            <AssistantMutedText>
              示例提示词会在下一步展示；点击继续后才会真正进入生成流程。
            </AssistantMutedText>
            <Button type="primary" onClick={semanticsWizard.onNext}>
              下一步
            </Button>
          </AssistantFooterBar>
        </AssistantSectionCard>
      </AssistantColumn>
    );
  };

  const renderGenerateStep = () => (
    <AssistantColumn>
      <AssistantIntroCard>
        <AssistantSectionHeader>
          <div>
            <Text strong>生成流程</Text>
            <AssistantMutedText>
              如有需要可补充提示词，生成后确认结果，再将描述保存回建模。
            </AssistantMutedText>
          </div>
          <AssistantDocLink
            href="https://docs.getwren.ai/cp/guide/modeling-ai-assistant"
            target="_blank"
            rel="noreferrer"
          >
            了解更多
          </AssistantDocLink>
        </AssistantSectionHeader>
        <AssistantPillRow>
          <AssistantPill $tone="accent">第 2 步 / 共 2 步</AssistantPill>
          <AssistantPill
            $tone={semanticsWizard.completed ? 'success' : 'warning'}
          >
            {semanticsWizard.completed ? '已生成' : '等待生成'}
          </AssistantPill>
          <AssistantPill $tone="default">
            {selectedModelCount} 个模型
          </AssistantPill>
        </AssistantPillRow>
      </AssistantIntroCard>
      <ModelingAssistantTaskStatusPanel
        task={semanticsWizard.task}
        resultCount={semanticsWizard.generatedModels.length}
        resultLabel="语义描述"
        saved={semanticsWizard.saved}
        testId="semantics-assistant-task-status"
      />
      <AssistantMetricGrid>
        <AssistantMetricCard>
          <Text type="secondary">已选模型</Text>
          <Text strong style={{ fontSize: 18 }}>
            {selectedModelCount}
          </Text>
        </AssistantMetricCard>
        <AssistantMetricCard>
          <Text type="secondary">提示词</Text>
          <Text strong style={{ fontSize: 18 }}>
            {semanticsWizard.prompt.trim() ? '已自定义' : '可选'}
          </Text>
        </AssistantMetricCard>
      </AssistantMetricGrid>
      <AssistantSectionCard>
        <Title level={4} style={{ marginTop: 0 }}>
          生成语义描述
        </Title>
        <Paragraph type="secondary">已选模型：{selectedModelCount}</Paragraph>
        <Input.TextArea
          rows={5}
          value={semanticsWizard.prompt}
          onChange={(event) => semanticsWizard.setPrompt(event.target.value)}
          placeholder="可选：补充更多业务背景、术语偏好或描述要求"
        />
      </AssistantSectionCard>

      {semanticsWizard.requestError ? (
        <Alert
          type="error"
          showIcon
          title="生成语义描述失败"
          description={semanticsWizard.requestError}
          action={
            <Button
              size="small"
              onClick={() => void semanticsWizard.retryGenerate()}
            >
              重试
            </Button>
          }
        />
      ) : null}

      {semanticsWizard.saveError ? (
        <Alert
          type="error"
          showIcon
          title="保存语义描述失败"
          description={semanticsWizard.saveError}
          action={
            <Button size="small" onClick={() => void semanticsWizard.save()}>
              重试保存
            </Button>
          }
        />
      ) : null}

      <AssistantSectionCard>
        <Title level={5} style={{ marginTop: 0 }}>
          {generatedStateTitle}
        </Title>
        {!semanticsWizard.completed ? (
          <AssistantMutedText>
            这些示例提示词仅供参考，不会自动填入输入框。
          </AssistantMutedText>
        ) : null}
        {semanticsWizard.completed ? (
          <GeneratedSemanticsReview items={semanticsWizard.generatedModels} />
        ) : (
          <Space wrap>
            {semanticsWizard.examplePrompts.map((item) => (
              <AssistantPromptChip key={item} type="button">
                {item}
              </AssistantPromptChip>
            ))}
          </Space>
        )}
      </AssistantSectionCard>

      {semanticsWizard.polling &&
      semanticsWizard.task?.status === 'GENERATING' ? (
        <AssistantStateCard $align="center">
          <Spin />
          <Paragraph style={{ marginTop: 12, marginBottom: 0 }}>
            正在生成语义描述...
          </Paragraph>
        </AssistantStateCard>
      ) : null}

      <AssistantSectionCard>
        <AssistantFooterBar>
          <Button onClick={semanticsWizard.onBack}>上一步</Button>
          <Space>
            <Button
              onClick={() => void semanticsWizard.save()}
              type={semanticsWizard.completed ? 'primary' : 'default'}
              loading={semanticsWizard.saving}
              disabled={!semanticsWizard.completed}
            >
              保存
            </Button>
            <Button
              type={semanticsWizard.completed ? 'default' : 'primary'}
              onClick={() => void semanticsWizard.generate()}
              loading={semanticsWizard.polling}
            >
              {semanticsWizard.completed ? '重新生成' : '开始生成'}
            </Button>
          </Space>
        </AssistantFooterBar>
      </AssistantSectionCard>
    </AssistantColumn>
  );

  return (
    <ModelingAssistantRouteLayout
      title="生成语义描述"
      description="选择模型并补充可选上下文，让建模 AI 助手生成描述，确认后再保存回语义模型。"
      onBack={leaveGuard.onBackClick}
    >
      {semanticsWizard.step === 'pick'
        ? renderPickStep()
        : renderGenerateStep()}
    </ModelingAssistantRouteLayout>
  );
}

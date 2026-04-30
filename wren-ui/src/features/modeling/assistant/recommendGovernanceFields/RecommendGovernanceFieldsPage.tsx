import { useMemo, useState } from 'react';
import { Alert, Button, Input, Space, Tag, Typography } from 'antd';
import styled from 'styled-components';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { appMessage as message } from '@/utils/antdAppBridge';
import { Path } from '@/utils/enum';
import ModelingAssistantRouteLayout from '../ModelingAssistantRouteLayout';
import { buildModelingAssistantBackParams } from '../modelingAssistantRoutes';
import useModelingAssistantLeaveGuard from '../useModelingAssistantLeaveGuard';
import useModelingAssistantReadonly from '../useModelingAssistantReadonly';
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
import {
  buildGovernanceFieldDrafts,
  countGovernanceDrafts,
  type GovernanceDraftItem,
  type GovernanceFieldDrafts,
} from './recommendGovernanceFieldsSupport';

const { Text, Title } = Typography;
const { TextArea } = Input;

type ModelingAssistantCompletionHandler = () => void | Promise<void>;

const DraftGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px;
`;

const DraftCard = styled.div`
  border: 1px solid #e5e7eb;
  border-radius: 16px;
  background: #fff;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const DraftMetaRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`;

const examplePrompts = [
  '按首存 cohort、续存和渠道 ROI 推荐治理字段',
  '渠道综合日报需要 PV、UV、下载点击等外部流量指标',
  '普通充值订单查询不要误命中综合日报模板',
];

const renderDraftCard = (item: GovernanceDraftItem) => (
  <DraftCard key={`${item.title}-${item.description}`}>
    <div>
      <Text strong>{item.title}</Text>
      <AssistantMutedText>{item.description}</AssistantMutedText>
    </div>
    <DraftMetaRow>
      {(item.requiredSlots.length ? item.requiredSlots : ['无必填槽位']).map(
        (slot) => (
          <Tag key={slot} color="blue" style={{ marginInlineEnd: 0 }}>
            {slot}
          </Tag>
        ),
      )}
    </DraftMetaRow>
    {item.expectedGrain ? (
      <AssistantMutedText>推荐粒度：{item.expectedGrain}</AssistantMutedText>
    ) : null}
    <AssistantMutedText>
      适用：{item.applicableScenarios.join('、') || '-'}
      <br />
      不适用：{item.notApplicableScenarios.join('、') || '-'}
    </AssistantMutedText>
  </DraftCard>
);

const DraftSection = ({
  title,
  items,
  emptyText,
}: {
  title: string;
  items: GovernanceDraftItem[];
  emptyText: string;
}) => (
  <AssistantSectionCard>
    <AssistantSectionHeader>
      <div>
        <Text strong>{title}</Text>
        <AssistantMutedText>
          先审核这些治理字段，再复制到对应知识库表单中保存。
        </AssistantMutedText>
      </div>
      <AssistantPill $tone={items.length ? 'success' : 'default'}>
        {items.length} 条建议
      </AssistantPill>
    </AssistantSectionHeader>
    {items.length ? (
      <DraftGrid>{items.map(renderDraftCard)}</DraftGrid>
    ) : (
      <AssistantMutedText>{emptyText}</AssistantMutedText>
    )}
  </AssistantSectionCard>
);

export function RecommendGovernanceFieldsAssistantContent({
  onSaveSuccess: _onSaveSuccess,
}: {
  onSaveSuccess?: ModelingAssistantCompletionHandler;
}) {
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const modelingAssistantReadonly = useModelingAssistantReadonly();
  void _onSaveSuccess;
  const [prompt, setPrompt] = useState(examplePrompts[0]);
  const [drafts, setDrafts] = useState<GovernanceFieldDrafts | null>(null);
  const draftCount = useMemo(
    () => (drafts ? countGovernanceDrafts(drafts) : 0),
    [drafts],
  );

  const generateDrafts = () => {
    setDrafts(buildGovernanceFieldDrafts(prompt));
  };

  const copyDrafts = async () => {
    if (!drafts) return;
    await navigator.clipboard.writeText(JSON.stringify(drafts, null, 2));
    message.success('已复制治理字段草稿');
  };

  if (runtimeScopePage.guarding) {
    return (
      <AssistantStateCard $align="center">
        <Text strong>正在准备知识库上下文</Text>
        <AssistantMutedText>
          加载完成后即可生成治理字段草稿。
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
            title="历史快照中暂不支持生成治理字段"
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
            <Text strong>治理字段推荐</Text>
            <AssistantMutedText>
              输入你希望治理的业务口径，助手会生成业务词、SQL
              模板和外部依赖的结构化草稿。
              草稿不会自动生效，需要你审核后复制到知识库表单中保存。
            </AssistantMutedText>
          </div>
        </AssistantSectionHeader>
        <AssistantPillRow>
          <AssistantPill $tone="accent">P1 治理助手</AssistantPill>
          <AssistantPill $tone={draftCount ? 'success' : 'warning'}>
            {draftCount ? `${draftCount} 条草稿` : '等待生成'}
          </AssistantPill>
        </AssistantPillRow>
      </AssistantIntroCard>

      <AssistantSectionCard>
        <Title level={4} style={{ marginTop: 0 }}>
          输入治理目标
        </Title>
        <TextArea
          value={prompt}
          rows={4}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="例如：按首存 cohort、续存和渠道 ROI 推荐治理字段"
        />
        <Space size={[8, 8]} wrap>
          {examplePrompts.map((item) => (
            <Button key={item} size="small" onClick={() => setPrompt(item)}>
              {item}
            </Button>
          ))}
        </Space>
        <AssistantFooterBar>
          <AssistantMutedText>
            当前版本先用确定性规则生成可审核草稿，后续可接后端 LLM 任务。
          </AssistantMutedText>
          <Space>
            <Button onClick={() => setDrafts(null)} disabled={!drafts}>
              清空
            </Button>
            <Button type="primary" onClick={generateDrafts}>
              生成草稿
            </Button>
          </Space>
        </AssistantFooterBar>
      </AssistantSectionCard>

      {drafts ? (
        <>
          <AssistantMetricGrid>
            <AssistantMetricCard>
              <Text strong>{drafts.businessTerms.length}</Text>
              <AssistantMutedText>业务词建议</AssistantMutedText>
            </AssistantMetricCard>
            <AssistantMetricCard>
              <Text strong>{drafts.sqlTemplates.length}</Text>
              <AssistantMutedText>SQL 模板治理建议</AssistantMutedText>
            </AssistantMetricCard>
            <AssistantMetricCard>
              <Text strong>{drafts.externalDependencies.length}</Text>
              <AssistantMutedText>外部依赖建议</AssistantMutedText>
            </AssistantMetricCard>
          </AssistantMetricGrid>
          <DraftSection
            title="业务词"
            items={drafts.businessTerms}
            emptyText="本次输入没有明显业务词建议。"
          />
          <DraftSection
            title="SQL 模板治理字段"
            items={drafts.sqlTemplates}
            emptyText="本次输入没有明显 SQL 模板治理字段。"
          />
          <DraftSection
            title="外部数据依赖"
            items={drafts.externalDependencies}
            emptyText="本次输入未触发外部数据依赖建议。"
          />
          <AssistantSectionCard>
            <AssistantFooterBar>
              <AssistantMutedText>
                采用前请检查必填槽位、适用/不适用场景和粒度是否符合当前知识库。
              </AssistantMutedText>
              <Button type="primary" onClick={() => void copyDrafts()}>
                采用建议并复制 JSON
              </Button>
            </AssistantFooterBar>
          </AssistantSectionCard>
        </>
      ) : null}
    </AssistantColumn>
  );
}

export default function RecommendGovernanceFieldsPage() {
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
      title="推荐治理字段"
      description="根据业务口径生成业务词、SQL 模板和外部依赖的治理字段草稿，审核后再保存。"
      onBack={leaveGuard.onBackClick}
    >
      <RecommendGovernanceFieldsAssistantContent onSaveSuccess={navigateBack} />
    </ModelingAssistantRouteLayout>
  );
}

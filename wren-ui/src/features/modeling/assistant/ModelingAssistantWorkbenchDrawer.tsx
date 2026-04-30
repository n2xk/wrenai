import { Drawer } from 'antd';
import type { ModelingAssistantIntent } from './modelingAssistantRoutes';
import { RecommendGovernanceFieldsAssistantContent } from './recommendGovernanceFields/RecommendGovernanceFieldsPage';
import { RecommendRelationshipsAssistantContent } from './recommendRelationships/RecommendRelationshipsPage';
import { RecommendSemanticsAssistantContent } from './recommendSemantics/RecommendSemanticsPage';

const ASSISTANT_DRAWER_TITLE: Record<ModelingAssistantIntent, string> = {
  governance: '推荐治理字段',
  relationships: '生成关联关系',
  semantics: '生成语义描述',
};

const ASSISTANT_DRAWER_DESCRIPTION: Record<ModelingAssistantIntent, string> = {
  governance:
    '根据业务口径生成业务词、SQL 模板和外部依赖治理字段草稿，审核后再保存。',
  relationships:
    '在当前知识库建模上下文中审核 AI 推荐的关联关系，确认后保存回语义层。',
  semantics:
    '在当前知识库建模上下文中选择模型、生成语义描述，并确认后保存回语义层。',
};

export default function ModelingAssistantWorkbenchDrawer({
  intent,
  onClose,
  onSaveSuccess,
}: {
  intent?: ModelingAssistantIntent | null;
  onClose: () => void | Promise<void>;
  onSaveSuccess: () => void | Promise<void>;
}) {
  if (!intent) {
    return null;
  }

  return (
    <Drawer
      open
      width="min(1080px, calc(100vw - 224px))"
      title={ASSISTANT_DRAWER_TITLE[intent]}
      onClose={() => void onClose()}
      destroyOnClose
      styles={{
        body: {
          background: '#f8fafc',
          padding: 24,
        },
      }}
      extra={
        <span style={{ color: '#667085', fontSize: 13 }}>
          {ASSISTANT_DRAWER_DESCRIPTION[intent]}
        </span>
      }
    >
      {intent === 'governance' ? (
        <RecommendGovernanceFieldsAssistantContent
          onSaveSuccess={onSaveSuccess}
        />
      ) : intent === 'semantics' ? (
        <RecommendSemanticsAssistantContent onSaveSuccess={onSaveSuccess} />
      ) : (
        <RecommendRelationshipsAssistantContent
          onBack={onClose}
          onSaveSuccess={onSaveSuccess}
        />
      )}
    </Drawer>
  );
}

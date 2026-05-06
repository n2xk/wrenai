import { FolderOpenOutlined, PlusOutlined } from '@ant-design/icons';
import { Typography } from 'antd';
import {
  EmptyInner,
  EmptyStage,
  PrimaryBlackButton,
} from '@/features/knowledgePage/index.styles';

const { Text, Title } = Typography;

type KnowledgeNoKnowledgeBaseEmptyStateProps = {
  canCreateKnowledgeBase: boolean;
  createKnowledgeBaseBlockedReason?: string | null;
  onCreateKnowledgeBase: () => void;
};

export default function KnowledgeNoKnowledgeBaseEmptyState({
  canCreateKnowledgeBase,
  createKnowledgeBaseBlockedReason,
  onCreateKnowledgeBase,
}: KnowledgeNoKnowledgeBaseEmptyStateProps) {
  return (
    <EmptyStage>
      <EmptyInner>
        <FolderOpenOutlined style={{ fontSize: 48, color: '#c4c8d5' }} />
        <Title level={4} style={{ margin: 0 }}>
          还没有知识库
        </Title>
        <Text type="secondary">
          先创建一个知识库，再添加数据资产、SQL 模板和问数策略。
        </Text>
        <PrimaryBlackButton
          type="button"
          disabled={!canCreateKnowledgeBase}
          title={
            canCreateKnowledgeBase
              ? '创建知识库'
              : createKnowledgeBaseBlockedReason || '当前账号不能创建知识库'
          }
          onClick={onCreateKnowledgeBase}
        >
          <PlusOutlined />
          <span>创建知识库</span>
        </PrimaryBlackButton>
        {!canCreateKnowledgeBase && createKnowledgeBaseBlockedReason ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {createKnowledgeBaseBlockedReason}
          </Text>
        ) : null}
      </EmptyInner>
    </EmptyStage>
  );
}

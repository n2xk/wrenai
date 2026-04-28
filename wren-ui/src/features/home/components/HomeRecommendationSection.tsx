import BookOutlined from '@ant-design/icons/BookOutlined';
import DatabaseOutlined from '@ant-design/icons/DatabaseOutlined';
import FundViewOutlined from '@ant-design/icons/FundViewOutlined';
import {
  ExploreHeaderBar,
  ExploreTemplateTag,
  ExploreTitle,
  RecommendationAssetName,
  RecommendationCard,
  RecommendationBadge,
  RecommendationCardHeader,
  RecommendationIcon,
  RecommendationQuestion,
  RecommendationRow,
  RecommendationSection,
} from '../homePageStyles';

export interface HomeRecommendationCard {
  question: string;
  badge: string;
  knowledgeBaseId?: string;
  knowledgeBaseName?: string;
  assetName?: string;
}

type HomeRecommendationSectionProps = {
  cards: HomeRecommendationCard[];
  onSelectQuestion: (card: HomeRecommendationCard) => void;
};

export default function HomeRecommendationSectionBlock({
  cards,
  onSelectQuestion,
}: HomeRecommendationSectionProps) {
  return (
    <RecommendationSection>
      <ExploreHeaderBar>
        <ExploreTitle>探索</ExploreTitle>
        <ExploreTemplateTag>推荐模板</ExploreTemplateTag>
      </ExploreHeaderBar>
      <RecommendationRow>
        {cards.map((card, index) => {
          const iconAccent = '#f3f4f6';

          return (
            <RecommendationCard
              key={`${card.knowledgeBaseId || 'recommendation'}-${card.question}-${index}`}
              type="button"
              $accent={iconAccent}
              aria-label={`使用案例问题：${card.question}${card.assetName ? `，来源资产：${card.assetName}` : ''}`}
              onClick={() => onSelectQuestion(card)}
            >
              <RecommendationCardHeader>
                <RecommendationIcon $accent={iconAccent}>
                  {index === 0 ? (
                    <FundViewOutlined />
                  ) : index === 1 ? (
                    <DatabaseOutlined />
                  ) : (
                    <BookOutlined />
                  )}
                </RecommendationIcon>
                <RecommendationBadge $primary={card.badge === '最新'}>
                  {card.badge}
                </RecommendationBadge>
              </RecommendationCardHeader>
              <RecommendationQuestion>{card.question}</RecommendationQuestion>
              {card.assetName ? (
                <RecommendationAssetName>
                  来源资产 · {card.assetName}
                </RecommendationAssetName>
              ) : null}
            </RecommendationCard>
          );
        })}
      </RecommendationRow>
    </RecommendationSection>
  );
}

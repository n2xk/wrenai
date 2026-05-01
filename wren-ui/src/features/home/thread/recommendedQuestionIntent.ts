import type { HomeIntentKind } from '@/types/homeIntent';

type RecommendedQuestionSelectionIntentInput = {
  category?: string | null;
  question?: string | null;
  suggestedIntent?: HomeIntentKind | null;
};

const CHART_RECOMMENDATION_CATEGORIES = new Set([
  'chart_followup',
  'chart_refine',
]);

const CHART_RECOMMENDATION_TEXT_PATTERN =
  /(图表|图形|可视化|柱状图|折线图|饼图|面积图|散点图|chart|graph|plot|visual)/i;

export const isChartRecommendationSelection = ({
  category,
  question,
  suggestedIntent,
}: RecommendedQuestionSelectionIntentInput) =>
  CHART_RECOMMENDATION_CATEGORIES.has(category || '') ||
  (suggestedIntent === 'CHART' &&
    CHART_RECOMMENDATION_TEXT_PATTERN.test(question || ''));

export const resolveRecommendedQuestionIntentHint = (
  selection: RecommendedQuestionSelectionIntentInput,
): HomeIntentKind => {
  if (isChartRecommendationSelection(selection)) {
    return 'CHART';
  }

  if (selection.suggestedIntent === 'RECOMMEND_QUESTIONS') {
    return 'RECOMMEND_QUESTIONS';
  }

  return 'ASK';
};

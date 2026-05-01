import {
  isChartRecommendationSelection,
  resolveRecommendedQuestionIntentHint,
} from './recommendedQuestionIntent';

describe('recommendedQuestionIntent', () => {
  it('keeps non-chart recommended questions as normal asks even when metadata says CHART', () => {
    const selection = {
      category: 'compare',
      question: '比较各渠道4月注册量',
      suggestedIntent: 'CHART' as const,
    };

    expect(isChartRecommendationSelection(selection)).toBe(false);
    expect(resolveRecommendedQuestionIntentHint(selection)).toBe('ASK');
  });

  it('routes explicit chart follow-up categories to chart generation', () => {
    const selection = {
      category: 'chart_followup',
      question: '按渠道展示注册量',
      suggestedIntent: 'CHART' as const,
    };

    expect(isChartRecommendationSelection(selection)).toBe(true);
    expect(resolveRecommendedQuestionIntentHint(selection)).toBe('CHART');
  });

  it('routes explicit chart wording to chart generation', () => {
    const selection = {
      category: 'compare',
      question: '生成一个比较各渠道注册量的柱状图',
      suggestedIntent: 'CHART' as const,
    };

    expect(isChartRecommendationSelection(selection)).toBe(true);
    expect(resolveRecommendedQuestionIntentHint(selection)).toBe('CHART');
  });
});

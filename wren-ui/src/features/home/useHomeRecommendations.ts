import { useMemo } from 'react';
import type { SuggestedQuestionsPayload } from '@/utils/homeRest';
import {
  getReferenceDemoKnowledgeByName,
  getReferenceDisplayKnowledgeName,
  REFERENCE_HOME_RECOMMENDATIONS,
} from '@/utils/referenceDemoKnowledge';
import type { HomeRecommendationCard } from './components/HomeRecommendationSection';

type KnowledgeBaseSummary = {
  id: string;
  name?: string | null;
};

type RecommendationAssetSummary = {
  id: string;
  name: string;
  suggestedQuestions?: string[];
};

const GOVERNED_SQL_PAIR_LABEL_PATTERN = /业务模板|可信参考|问数样例/;
const GOVERNED_INSTRUCTION_LABEL_PATTERN = /分析规则/;

const normalizeRecommendationLabel = (label?: string | null) =>
  String(label || '').trim();

const isGovernedSuggestedQuestionLabel = (label?: string | null) => {
  const normalizedLabel = normalizeRecommendationLabel(label);
  return (
    GOVERNED_SQL_PAIR_LABEL_PATTERN.test(normalizedLabel) ||
    GOVERNED_INSTRUCTION_LABEL_PATTERN.test(normalizedLabel)
  );
};

export function useHomeRecommendations({
  currentKnowledgeBases,
  currentKnowledgeBase,
  selectedKnowledgeBaseIds,
  suggestedQuestionsData,
  knowledgeBaseAssets,
}: {
  currentKnowledgeBases: KnowledgeBaseSummary[];
  currentKnowledgeBase?: KnowledgeBaseSummary | null;
  selectedKnowledgeBaseIds: string[];
  suggestedQuestionsData: SuggestedQuestionsPayload | null;
  knowledgeBaseAssets: RecommendationAssetSummary[];
}) {
  const recommendationKnowledgeBase = useMemo(() => {
    if (selectedKnowledgeBaseIds.length > 0) {
      const selectedKnowledgeBase = currentKnowledgeBases.find(
        (knowledgeBase) => knowledgeBase.id === selectedKnowledgeBaseIds[0],
      );
      if (selectedKnowledgeBase) {
        return selectedKnowledgeBase;
      }
    }

    return currentKnowledgeBase || null;
  }, [currentKnowledgeBase, currentKnowledgeBases, selectedKnowledgeBaseIds]);

  const recommendationKnowledgeBaseName =
    recommendationKnowledgeBase?.name || '';

  const matchedDemoKnowledge = useMemo(
    () => getReferenceDemoKnowledgeByName(recommendationKnowledgeBaseName),
    [recommendationKnowledgeBaseName],
  );

  const sampleQuestions = useMemo(
    () => suggestedQuestionsData?.questions || [],
    [suggestedQuestionsData],
  );

  const suggestedQuestionCards = useMemo<HomeRecommendationCard[]>(
    () =>
      sampleQuestions
        .filter(
          (item): item is NonNullable<(typeof sampleQuestions)[number]> =>
            item !== null && Boolean(item?.question?.trim()),
        )
        .slice(0, 3)
        .map(
          (
            item: NonNullable<(typeof sampleQuestions)[number]>,
            index: number,
          ) => ({
            question: item.question.trim(),
            badge:
              normalizeRecommendationLabel(item.label) ||
              (index === 1 ? '最新' : '热门'),
            knowledgeBaseId: recommendationKnowledgeBase?.id,
            knowledgeBaseName: recommendationKnowledgeBase?.name || undefined,
          }),
        ),
    [recommendationKnowledgeBase, sampleQuestions],
  );

  const governedSuggestedQuestionCards = useMemo(
    () =>
      suggestedQuestionCards.filter((card) =>
        isGovernedSuggestedQuestionLabel(card.badge),
      ),
    [suggestedQuestionCards],
  );

  const assetRecommendationCards = useMemo<HomeRecommendationCard[]>(() => {
    const assetsWithQuestions = knowledgeBaseAssets
      .map((asset) => ({
        ...asset,
        suggestedQuestions: (asset.suggestedQuestions || [])
          .map((question) => question.trim())
          .filter(Boolean),
      }))
      .filter((asset) => asset.suggestedQuestions.length > 0);

    if (assetsWithQuestions.length === 0) {
      return [];
    }

    const entries: Array<{ question: string; assetName: string }> = [];
    let questionIndex = 0;

    while (entries.length < 3) {
      let consumedQuestion = false;

      for (const asset of assetsWithQuestions) {
        const question = asset.suggestedQuestions[questionIndex];
        if (!question) {
          continue;
        }

        entries.push({
          question,
          assetName: asset.name,
        });
        consumedQuestion = true;

        if (entries.length >= 3) {
          break;
        }
      }

      if (!consumedQuestion) {
        break;
      }

      questionIndex += 1;
    }

    return entries.map((entry, index) => ({
      question: entry.question,
      badge: index === 1 ? '最新' : '热门',
      knowledgeBaseId: recommendationKnowledgeBase?.id,
      knowledgeBaseName: recommendationKnowledgeBase?.name || undefined,
      assetName: entry.assetName,
    }));
  }, [knowledgeBaseAssets, recommendationKnowledgeBase]);

  const fallbackQuestionsForKnowledgeBase = useMemo(() => {
    const displayName = getReferenceDisplayKnowledgeName(
      recommendationKnowledgeBase,
    );

    return [
      `围绕「${displayName}」先看哪些关键指标？`,
      `基于「${displayName}」有哪些值得优先追问的问题？`,
      `「${displayName}」里最适合先验证的业务结论是什么？`,
    ];
  }, [recommendationKnowledgeBase]);

  const scopedFallbackKnowledgeBaseCards = useMemo<HomeRecommendationCard[]>(
    () =>
      recommendationKnowledgeBase
        ? fallbackQuestionsForKnowledgeBase.map((question, index) => ({
            question,
            badge: index === 1 ? '最新' : '热门',
            knowledgeBaseId: recommendationKnowledgeBase.id,
            knowledgeBaseName: recommendationKnowledgeBase.name || undefined,
          }))
        : [],
    [fallbackQuestionsForKnowledgeBase, recommendationKnowledgeBase],
  );

  const workspaceKnowledgeBaseCards = useMemo<HomeRecommendationCard[]>(() => {
    return currentKnowledgeBases.slice(0, 3).map((knowledgeBase, index) => {
      const matchedKnowledge = getReferenceDemoKnowledgeByName(
        knowledgeBase.name || '',
      );
      const displayName = getReferenceDisplayKnowledgeName(knowledgeBase.name);
      const fallbackQuestions = [
        `围绕「${displayName}」先看哪些关键指标？`,
        `基于「${displayName}」有哪些值得优先追问的问题？`,
        `「${displayName}」里最适合先验证的业务结论是什么？`,
      ];

      return {
        question:
          matchedKnowledge?.suggestedQuestions[index] ||
          matchedKnowledge?.suggestedQuestions[0] ||
          fallbackQuestions[index] ||
          fallbackQuestions[0],
        badge: index === 1 ? '最新' : '热门',
        knowledgeBaseId: knowledgeBase.id,
        knowledgeBaseName: knowledgeBase.name || undefined,
      };
    });
  }, [currentKnowledgeBases]);

  const recommendationCards = useMemo<HomeRecommendationCard[]>(() => {
    const scopedCardMeta = recommendationKnowledgeBase
      ? {
          knowledgeBaseId: recommendationKnowledgeBase.id,
          knowledgeBaseName: recommendationKnowledgeBase.name || undefined,
        }
      : {};

    if (governedSuggestedQuestionCards.length > 0) {
      return governedSuggestedQuestionCards;
    }

    if (assetRecommendationCards.length > 0) {
      return assetRecommendationCards;
    }

    if (matchedDemoKnowledge) {
      const primaryQuestions = matchedDemoKnowledge.suggestedQuestions;
      const fallbackQuestion =
        REFERENCE_HOME_RECOMMENDATIONS[1]?.question ||
        REFERENCE_HOME_RECOMMENDATIONS[0]?.question;

      return [
        {
          question:
            primaryQuestions[0] || REFERENCE_HOME_RECOMMENDATIONS[0].question,
          badge: '热门',
          ...scopedCardMeta,
        },
        {
          question: primaryQuestions[1] || fallbackQuestion,
          badge: '最新',
          ...scopedCardMeta,
        },
        {
          question:
            primaryQuestions[2] || REFERENCE_HOME_RECOMMENDATIONS[2].question,
          badge: '热门',
          ...scopedCardMeta,
        },
      ];
    }

    if (suggestedQuestionCards.length > 0) {
      return suggestedQuestionCards.map((card) => ({
        ...card,
        ...scopedCardMeta,
      }));
    }

    if (scopedFallbackKnowledgeBaseCards.length > 0) {
      return scopedFallbackKnowledgeBaseCards;
    }
    if (workspaceKnowledgeBaseCards.length > 0) {
      return workspaceKnowledgeBaseCards;
    }
    return REFERENCE_HOME_RECOMMENDATIONS;
  }, [
    assetRecommendationCards,
    governedSuggestedQuestionCards,
    matchedDemoKnowledge,
    recommendationKnowledgeBase,
    scopedFallbackKnowledgeBaseCards,
    suggestedQuestionCards,
    workspaceKnowledgeBaseCards,
  ]);

  return {
    recommendationCards,
  };
}

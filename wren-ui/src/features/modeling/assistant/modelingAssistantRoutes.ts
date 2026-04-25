import { Path } from '@/utils/enum';
import { buildKnowledgeWorkbenchParams } from '@/utils/knowledgeWorkbench';

export const MODELING_ASSISTANT_PATHS = [
  Path.RecommendRelationships,
  Path.RecommendSemantics,
] as const;

export const MODELING_ASSISTANT_ROUTE_TITLES = {
  [Path.RecommendRelationships]: '生成关联关系',
  [Path.RecommendSemantics]: '生成语义描述',
} as const;

export const buildModelingAssistantBackParams = () =>
  buildKnowledgeWorkbenchParams('modeling');

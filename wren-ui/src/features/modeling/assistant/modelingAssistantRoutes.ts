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

export type ModelingAssistantIntent = 'relationships' | 'semantics';

export const MODELING_ASSISTANT_INTENTS = [
  'relationships',
  'semantics',
] as const;

export const isModelingAssistantIntent = (
  value?: string | null,
): value is ModelingAssistantIntent =>
  MODELING_ASSISTANT_INTENTS.includes(value as ModelingAssistantIntent);

export const resolveModelingAssistantIntent = (value?: string | null) =>
  isModelingAssistantIntent(value) ? value : null;

export const buildModelingAssistantBackParams = () =>
  buildKnowledgeWorkbenchParams('modeling');

export const buildModelingAssistantWorkbenchParams = (
  intent?: ModelingAssistantIntent | null,
) =>
  buildKnowledgeWorkbenchParams(
    'modeling',
    intent ? { openAssistant: intent } : {},
  );

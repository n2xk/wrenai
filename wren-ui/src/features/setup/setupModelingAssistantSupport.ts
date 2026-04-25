import type { ModelingAssistantIntent } from '@/features/knowledgePage/knowledgeWorkbenchControllerStageViewTypes';
import { buildKnowledgeWorkbenchParams } from '@/utils/knowledgeWorkbench';

export type SetupModelingAssistantHandoffSource =
  | 'sample-dataset-import'
  | 'relationships-review';

export const resolveSetupModelingAssistantIntent = (
  source: SetupModelingAssistantHandoffSource,
): ModelingAssistantIntent =>
  source === 'sample-dataset-import' ? 'relationships' : 'semantics';

export const buildSetupModelingAssistantParams = (
  source: SetupModelingAssistantHandoffSource,
) =>
  buildKnowledgeWorkbenchParams('modeling', {
    openAssistant: resolveSetupModelingAssistantIntent(source),
  });

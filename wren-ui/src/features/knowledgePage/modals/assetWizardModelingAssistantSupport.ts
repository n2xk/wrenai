import type { ModelingAssistantIntent } from '@/features/knowledgePage/knowledgeWorkbenchControllerStageViewTypes';
import type { AssetView } from '@/features/knowledgePage/types';

export const resolveAssetWizardModelingAssistantIntent = ({
  assets,
  isBatchSelection,
}: {
  assets: AssetView[];
  isBatchSelection: boolean;
}): ModelingAssistantIntent | undefined => {
  if (isBatchSelection) {
    return 'relationships';
  }

  const modelAssetCount = assets.filter(
    (asset) => asset.kind === 'model',
  ).length;

  if (modelAssetCount === 1) {
    return 'semantics';
  }

  return undefined;
};

export const resolveAssetWizardModelingAssistantLabel = (
  intent?: ModelingAssistantIntent,
) => {
  switch (intent) {
    case 'relationships':
      return '去生成表关系';
    case 'semantics':
      return '去补充语义';
    default:
      return '去建模';
  }
};

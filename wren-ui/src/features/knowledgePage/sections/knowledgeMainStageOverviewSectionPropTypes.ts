import type { KnowledgeMainStageProps } from './knowledgeMainStageTypes';
import type { KnowledgeWorkbenchHeaderProps } from './KnowledgeWorkbenchHeader';
import type { KnowledgeModelingSectionProps } from './KnowledgeModelingSection';
import type { KnowledgeOverviewStageProps } from './KnowledgeOverviewStage';

export type KnowledgeHeaderSectionArgs = Pick<
  KnowledgeMainStageProps,
  | 'activeWorkbenchSection'
  | 'previewFieldCount'
  | 'isSnapshotReadonlyKnowledgeBase'
  | 'isReadonlyKnowledgeBase'
  | 'isKnowledgeMutationDisabled'
  | 'knowledgeMutationHint'
  | 'knowledgeDescription'
  | 'onOpenKnowledgeEditor'
> & {
  onChangeWorkbenchSection: KnowledgeWorkbenchHeaderProps['onChangeWorkbenchSection'];
};

export type KnowledgeOverviewSectionArgs = Pick<
  KnowledgeMainStageProps,
  | 'activeWorkbenchSection'
  | 'activeDetailAsset'
  | 'detailAssetFields'
  | 'detailAssets'
  | 'detailFieldFilter'
  | 'detailFieldKeyword'
  | 'detailTab'
  | 'historicalSnapshotReadonlyHint'
  | 'isKnowledgeMutationDisabled'
  | 'isReadonlyKnowledgeBase'
  | 'isSnapshotReadonlyKnowledgeBase'
  | 'knowledgeMutationHint'
  | 'modelingSummary'
  | 'onChangeDetailTab'
  | 'onChangeFieldFilter'
  | 'onChangeFieldKeyword'
  | 'onCloseAssetDetail'
  | 'onOpenAssetDetail'
  | 'onOpenAssetWizard'
  | 'onOpenModeling'
  | 'previewFieldCount'
  | 'showKnowledgeAssetsLoading'
  | 'ruleList'
  | 'sqlList'
> & {
  onCreateRuleDraft?: KnowledgeOverviewStageProps['onCreateRuleDraft'];
  onCreateSqlTemplateDraft?: KnowledgeOverviewStageProps['onCreateSqlTemplateDraft'];
};

export type KnowledgeModelingSectionArgs = Pick<
  KnowledgeMainStageProps,
  'modelingSummary' | 'modelingWorkspaceKey'
>;

export type {
  KnowledgeModelingSectionProps,
  KnowledgeOverviewStageProps,
  KnowledgeWorkbenchHeaderProps,
};

import type { KnowledgeWorkbenchMainStageProps } from './buildKnowledgeWorkbenchStageProps';
import type { KnowledgeWorkbenchControllerStageArgs } from './knowledgeWorkbenchControllerStageTypes';

type KnowledgeWorkbenchMainStageOverviewArgs = Omit<
  KnowledgeWorkbenchControllerStageArgs,
  'knowledgeState'
> & {
  knowledgeState: Pick<
    KnowledgeWorkbenchControllerStageArgs['knowledgeState'],
    | 'isSnapshotReadonlyKnowledgeBase'
    | 'isReadonlyKnowledgeBase'
    | 'isKnowledgeMutationDisabled'
    | 'hasActiveKnowledgeBase'
    | 'canCreateKnowledgeBase'
    | 'createKnowledgeBaseBlockedReason'
    | 'knowledgeMutationHint'
    | 'knowledgeDescription'
  >;
};

export default function buildKnowledgeWorkbenchMainStageOverviewInput({
  actions,
  contentData,
  knowledgeState,
  localState,
  viewState,
}: Pick<
  KnowledgeWorkbenchMainStageOverviewArgs,
  'actions' | 'contentData' | 'knowledgeState' | 'localState' | 'viewState'
>): Pick<
  KnowledgeWorkbenchMainStageProps,
  | 'activeWorkbenchSection'
  | 'onChangeWorkbenchSection'
  | 'previewFieldCount'
  | 'isSnapshotReadonlyKnowledgeBase'
  | 'isReadonlyKnowledgeBase'
  | 'isKnowledgeMutationDisabled'
  | 'hasActiveKnowledgeBase'
  | 'canCreateKnowledgeBase'
  | 'createKnowledgeBaseBlockedReason'
  | 'knowledgeMutationHint'
  | 'knowledgeDescription'
  | 'showKnowledgeAssetsLoading'
  | 'detailAssets'
  | 'activeDetailAsset'
  | 'detailTab'
  | 'detailFieldKeyword'
  | 'detailFieldFilter'
  | 'detailAssetFields'
  | 'onOpenAssetWizard'
  | 'onOpenKnowledgeEditor'
  | 'onCreateKnowledgeBase'
  | 'onOpenAssetDetail'
  | 'onCloseAssetDetail'
  | 'onChangeDetailTab'
  | 'onChangeFieldKeyword'
  | 'onChangeFieldFilter'
> {
  return {
    activeWorkbenchSection: viewState.activeWorkbenchSection,
    onChangeWorkbenchSection: viewState.handleChangeWorkbenchSection,
    previewFieldCount: contentData.previewFieldCount,
    isSnapshotReadonlyKnowledgeBase:
      knowledgeState.isSnapshotReadonlyKnowledgeBase,
    isReadonlyKnowledgeBase: knowledgeState.isReadonlyKnowledgeBase,
    isKnowledgeMutationDisabled: knowledgeState.isKnowledgeMutationDisabled,
    hasActiveKnowledgeBase: knowledgeState.hasActiveKnowledgeBase,
    canCreateKnowledgeBase: knowledgeState.canCreateKnowledgeBase,
    createKnowledgeBaseBlockedReason:
      knowledgeState.createKnowledgeBaseBlockedReason,
    knowledgeMutationHint: knowledgeState.knowledgeMutationHint,
    knowledgeDescription: knowledgeState.knowledgeDescription,
    showKnowledgeAssetsLoading: viewState.showKnowledgeAssetsLoading,
    detailAssets: viewState.detailAssets,
    activeDetailAsset: viewState.activeDetailAsset,
    detailTab: localState.detailTab,
    detailFieldKeyword: localState.detailFieldKeyword,
    detailFieldFilter: localState.detailFieldFilter,
    detailAssetFields: viewState.detailAssetFields,
    onOpenAssetWizard: viewState.handleOpenAssetWizard,
    onOpenKnowledgeEditor: actions.openEditKnowledgeBaseModal,
    onCreateKnowledgeBase: actions.openCreateKnowledgeBaseModal,
    onOpenAssetDetail: viewState.openAssetDetail,
    onCloseAssetDetail: viewState.handleCloseAssetDetail,
    onChangeDetailTab: localState.setDetailTab,
    onChangeFieldKeyword: localState.setDetailFieldKeyword,
    onChangeFieldFilter: localState.setDetailFieldFilter,
  };
}

import {
  buildKnowledgeInstructionsStageProps,
  buildKnowledgeModelingSectionProps,
  buildKnowledgeMainStageEditorsInput,
  buildKnowledgeOverviewStageProps,
  buildKnowledgeSqlTemplatesStageProps,
  buildKnowledgeWorkbenchHeaderProps,
} from '@/features/knowledgePage/sections/buildKnowledgeMainStageSectionProps';
import {
  MainStage,
  MainStageContent,
} from '@/features/knowledgePage/index.styles';
import AskPoliciesManager from '@/features/askPolicies/AskPoliciesManager';
import KnowledgeWorkbenchHeader from '@/features/knowledgePage/sections/KnowledgeWorkbenchHeader';
import KnowledgeBusinessTermsStage from '@/features/knowledgePage/sections/KnowledgeBusinessTermsStage';
import KnowledgeExternalDependenciesStage from '@/features/knowledgePage/sections/KnowledgeExternalDependenciesStage';
import KnowledgeInstructionsStage from '@/features/knowledgePage/sections/KnowledgeInstructionsStage';
import KnowledgeModelingSection from '@/features/knowledgePage/sections/KnowledgeModelingSection';
import KnowledgeOverviewStage from '@/features/knowledgePage/sections/KnowledgeOverviewStage';
import KnowledgeSqlTemplatesStage from '@/features/knowledgePage/sections/KnowledgeSqlTemplatesStage';
import type { KnowledgeMainStageProps } from '@/features/knowledgePage/sections/knowledgeMainStageTypes';
import { useKnowledgeWorkbenchEditors } from '@/features/knowledgePage/sections/useKnowledgeWorkbenchEditors';

function KnowledgeMainStage({
  activeWorkbenchSection,
  onChangeWorkbenchSection,
  previewFieldCount,
  isSnapshotReadonlyKnowledgeBase,
  isReadonlyKnowledgeBase,
  isKnowledgeMutationDisabled,
  knowledgeMutationHint,
  knowledgeDescription,
  showKnowledgeAssetsLoading,
  detailAssets,
  activeDetailAsset,
  detailTab,
  detailFieldKeyword,
  detailFieldFilter,
  detailAssetFields,
  onOpenAssetWizard,
  onOpenKnowledgeEditor,
  onOpenAssetDetail,
  onCloseAssetDetail,
  onCreateRuleDraftFromAsset,
  onCreateSqlTemplateDraftFromAsset,
  onChangeDetailTab,
  onChangeFieldKeyword,
  onChangeFieldFilter,
  historicalSnapshotReadonlyHint,
  ruleList,
  sqlList,
  ruleManageLoading,
  sqlManageLoading,
  onOpenRuleDetail,
  onOpenSqlTemplateDetail,
  onDeleteRule: _onDeleteRule,
  onDeleteSqlTemplate: _onDeleteSqlTemplate,
  editingInstruction,
  editingSqlPair,
  ruleForm,
  sqlTemplateForm,
  createInstructionLoading,
  updateInstructionLoading,
  createSqlPairLoading,
  updateSqlPairLoading,
  onSubmitRuleDetail,
  onSubmitSqlTemplateDetail,
  onResetRuleDetailEditor,
  onResetSqlTemplateEditor,
  modelingWorkspaceKey,
  modelingSummary,
  onOpenModeling,
  runtimeSelector = {},
}: KnowledgeMainStageProps) {
  const editors = useKnowledgeWorkbenchEditors(
    buildKnowledgeMainStageEditorsInput({
      activeWorkbenchSection,
      detailAssets,
      editingInstruction,
      editingSqlPair,
      onChangeWorkbenchSection,
      onCreateRuleDraftFromAsset,
      onCreateSqlTemplateDraftFromAsset,
      onDeleteRule: _onDeleteRule,
      onDeleteSqlTemplate: _onDeleteSqlTemplate,
      onOpenRuleDetail,
      onOpenSqlTemplateDetail,
      onResetRuleDetailEditor,
      onResetSqlTemplateEditor,
      onSubmitRuleDetail,
      onSubmitSqlTemplateDetail,
      ruleForm,
      ruleList,
      sqlList,
      sqlTemplateForm,
    }),
  );
  const {
    handleCreateRuleFromAsset,
    handleCreateSqlTemplateFromAsset,
    handleWorkbenchSectionChange,
  } = editors;
  return (
    <MainStage>
      <KnowledgeWorkbenchHeader
        {...buildKnowledgeWorkbenchHeaderProps({
          activeWorkbenchSection,
          previewFieldCount,
          isSnapshotReadonlyKnowledgeBase,
          isReadonlyKnowledgeBase,
          isKnowledgeMutationDisabled,
          knowledgeMutationHint,
          knowledgeDescription,
          onOpenKnowledgeEditor,
          onChangeWorkbenchSection: handleWorkbenchSectionChange,
        })}
      />

      <MainStageContent>
        <KnowledgeOverviewStage
          {...buildKnowledgeOverviewStageProps({
            activeWorkbenchSection,
            activeDetailAsset,
            detailAssetFields,
            detailAssets,
            detailFieldFilter,
            detailFieldKeyword,
            detailTab,
            historicalSnapshotReadonlyHint,
            isKnowledgeMutationDisabled,
            isReadonlyKnowledgeBase,
            isSnapshotReadonlyKnowledgeBase,
            modelingSummary,
            onChangeDetailTab,
            onChangeFieldFilter,
            onChangeFieldKeyword,
            onCloseAssetDetail,
            onCreateRuleDraft: handleCreateRuleFromAsset,
            onCreateSqlTemplateDraft: handleCreateSqlTemplateFromAsset,
            onOpenAssetDetail,
            onOpenAssetWizard,
            onOpenModeling,
            previewFieldCount,
            ruleList,
            showKnowledgeAssetsLoading,
            sqlList,
          })}
        />

        {activeWorkbenchSection === 'modeling' ? (
          <KnowledgeModelingSection
            {...buildKnowledgeModelingSectionProps({
              modelingSummary,
              modelingWorkspaceKey,
            })}
          />
        ) : null}

        {activeWorkbenchSection === 'sqlTemplates' ? (
          <KnowledgeSqlTemplatesStage
            {...buildKnowledgeSqlTemplatesStageProps({
              createSqlPairLoading,
              editingSqlPair,
              editors,
              isKnowledgeMutationDisabled,
              sqlList,
              sqlManageLoading,
              sqlTemplateForm,
              updateSqlPairLoading,
            })}
          />
        ) : null}

        {activeWorkbenchSection === 'instructions' ? (
          <KnowledgeInstructionsStage
            {...buildKnowledgeInstructionsStageProps({
              createInstructionLoading,
              editingInstruction,
              editors,
              isKnowledgeMutationDisabled,
              ruleForm,
              ruleList,
              ruleManageLoading,
              updateInstructionLoading,
            })}
          />
        ) : null}

        {activeWorkbenchSection === 'businessTerms' ? (
          <KnowledgeBusinessTermsStage
            isKnowledgeMutationDisabled={isKnowledgeMutationDisabled}
            runtimeSelector={runtimeSelector}
          />
        ) : null}

        {activeWorkbenchSection === 'externalDependencies' ? (
          <KnowledgeExternalDependenciesStage
            isKnowledgeMutationDisabled={isKnowledgeMutationDisabled}
            runtimeSelector={runtimeSelector}
          />
        ) : null}

        {activeWorkbenchSection === 'askPolicies' ? (
          <AskPoliciesManager
            embedded
            lockScopeToKnowledgeBase
            runtimeScopeSelector={runtimeSelector}
            hasRuntimeScope={Boolean(
              runtimeSelector.workspaceId && runtimeSelector.knowledgeBaseId,
            )}
            mutationDisabled={isKnowledgeMutationDisabled}
            mutationDisabledHint={knowledgeMutationHint}
            description="为当前知识库配置问数策略，用于约束模板采纳、必填业务槽位和问数路由。"
          />
        ) : null}
      </MainStageContent>
    </MainStage>
  );
}

export default KnowledgeMainStage;

import { useMemo } from 'react';
import type {
  RuleDetailFormValues,
  SqlTemplateFormValues,
} from '@/hooks/useKnowledgeRuleSqlManager';
import type {
  Instruction,
  SqlPair,
  SqlPairTemplateMode,
} from '@/types/knowledge';
import {
  filterKnowledgeInstructions,
  filterKnowledgeSqlTemplates,
  hasRuleDraftChanges,
  hasSqlTemplateDraftChanges,
} from '@/utils/knowledgeWorkbenchEditor';

export function useKnowledgeWorkbenchDraftDerivedState({
  ruleDraftBaseline,
  ruleList,
  ruleListScope,
  ruleSearchKeyword,
  sqlDraftBaseline,
  sqlList,
  sqlListMode,
  sqlSearchKeyword,
  watchedRuleContent,
  watchedRuleScope,
  watchedRuleSummary,
  watchedSqlContent,
  watchedSqlDescription,
  watchedSqlBusinessSignatureJson,
  watchedSqlExpectedGrain,
  watchedSqlExternalDependenciesText,
  watchedSqlNegativeScenariosText,
  watchedSqlParameterSchemaJson,
  watchedSqlPositiveScenariosText,
  watchedSqlRequiredSlotsText,
  watchedSqlTemplateMode,
}: {
  ruleDraftBaseline: RuleDetailFormValues;
  ruleList: Instruction[];
  ruleListScope: 'all' | 'default' | 'matched';
  ruleSearchKeyword: string;
  sqlDraftBaseline: SqlTemplateFormValues;
  sqlList: SqlPair[];
  sqlListMode: 'all' | 'recent';
  sqlSearchKeyword: string;
  watchedRuleContent?: string;
  watchedRuleScope?: 'all' | 'matched';
  watchedRuleSummary?: string;
  watchedSqlContent?: string;
  watchedSqlDescription?: string;
  watchedSqlBusinessSignatureJson?: string;
  watchedSqlExpectedGrain?: string;
  watchedSqlExternalDependenciesText?: string;
  watchedSqlNegativeScenariosText?: string;
  watchedSqlParameterSchemaJson?: string;
  watchedSqlPositiveScenariosText?: string;
  watchedSqlRequiredSlotsText?: string;
  watchedSqlTemplateMode?: SqlPairTemplateMode;
}) {
  const visibleSqlList = useMemo(
    () =>
      filterKnowledgeSqlTemplates({
        sqlList,
        keyword: sqlSearchKeyword,
        mode: sqlListMode,
      }),
    [sqlList, sqlListMode, sqlSearchKeyword],
  );

  const visibleRuleList = useMemo(
    () =>
      filterKnowledgeInstructions({
        ruleList,
        keyword: ruleSearchKeyword,
        scope: ruleListScope,
      }),
    [ruleList, ruleListScope, ruleSearchKeyword],
  );

  const isRuleDraftDirty = useMemo(
    () =>
      hasRuleDraftChanges({
        currentValues: {
          summary: watchedRuleSummary,
          scope: watchedRuleScope,
          content: watchedRuleContent,
        },
        initialValues: ruleDraftBaseline,
      }),
    [
      ruleDraftBaseline,
      watchedRuleContent,
      watchedRuleScope,
      watchedRuleSummary,
    ],
  );

  const isSqlDraftDirty = useMemo(
    () =>
      hasSqlTemplateDraftChanges({
        currentValues: {
          description: watchedSqlDescription,
          sql: watchedSqlContent,
          templateMode: watchedSqlTemplateMode,
          requiredSlotsText: watchedSqlRequiredSlotsText,
          expectedGrain: watchedSqlExpectedGrain,
          positiveScenariosText: watchedSqlPositiveScenariosText,
          negativeScenariosText: watchedSqlNegativeScenariosText,
          externalDependenciesText: watchedSqlExternalDependenciesText,
          parameterSchemaJson: watchedSqlParameterSchemaJson,
          businessSignatureJson: watchedSqlBusinessSignatureJson,
        },
        initialValues: sqlDraftBaseline,
      }),
    [
      sqlDraftBaseline,
      watchedSqlBusinessSignatureJson,
      watchedSqlContent,
      watchedSqlDescription,
      watchedSqlExpectedGrain,
      watchedSqlExternalDependenciesText,
      watchedSqlNegativeScenariosText,
      watchedSqlParameterSchemaJson,
      watchedSqlPositiveScenariosText,
      watchedSqlRequiredSlotsText,
      watchedSqlTemplateMode,
    ],
  );

  return {
    isRuleDraftDirty,
    isSqlDraftDirty,
    visibleRuleList,
    visibleSqlList,
  };
}

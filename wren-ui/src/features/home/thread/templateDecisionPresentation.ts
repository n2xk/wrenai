import type { AskTemplateDecision } from '@/types/home';

import type { ThreadWorkbenchMessages } from './threadWorkbenchMessages';

type TemplateMessages = ThreadWorkbenchMessages['template'];

export type TemplateDecisionPresentation = {
  badge: string;
  description?: string | null;
  tagColor: string;
  templateTitle?: string | null;
};

export type TemplateDecisionPresentationOptions = {
  isSqlFlow?: boolean;
};

const joinParts = (parts: Array<string | null | undefined>) =>
  parts.filter((part): part is string => Boolean(part)).join(' · ');

const isDirectLlmSqlGeneration = (templateDecision: AskTemplateDecision) =>
  templateDecision.decisionReason === 'no_sql_pair_candidates';

const formatParameterValue = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(formatParameterValue).join(', ')}]`;
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }
  if (value === null || value === undefined) {
    return 'null';
  }
  return String(value);
};

const formatTemplateDecisionParameters = (
  parameters?: Record<string, any> | null,
) => {
  const entries = Object.entries(parameters || {}).filter(
    ([, value]) => value !== undefined,
  );
  if (entries.length === 0) {
    return null;
  }

  return entries
    .slice(0, 6)
    .map(([key, value]) => `${key}=${formatParameterValue(value)}`)
    .join(', ');
};

const resolveDecisionReasonText = (
  templateDecision: AskTemplateDecision,
  messages: TemplateMessages,
) => {
  const fallbackReasonMap: Record<string, string> = {
    inactive_template: messages.reasons.inactiveTemplate,
    missing_template_parameters: messages.reasons.missingTemplateParameters,
    template_confidence_below_threshold:
      messages.reasons.templateConfidenceBelowThreshold,
    template_conflict_low_margin: messages.reasons.templateConflictLowMargin,
    template_core_protection_rejected_correction:
      messages.reasons.templateCoreProtectionRejectedCorrection,
    template_dry_run_failed: messages.reasons.templateDryRunFailed,
    template_schema_retrieval_insufficient:
      messages.reasons.templateSchemaRetrievalInsufficient,
  };
  const decisionReasonMap: Record<string, string> = {
    explicit_business_template_selected:
      messages.reasons.explicitBusinessTemplateSelected,
    no_sql_pair_candidates: messages.reasons.noSqlPairCandidates,
    reference_sql_pair_selected: messages.reasons.referenceSqlPairSelected,
    trusted_reference_selected: messages.reasons.trustedReferenceSelected,
  };

  const fallbackReason = templateDecision.fallbackReason || null;
  const decisionReason = templateDecision.decisionReason || null;

  if (fallbackReason && fallbackReasonMap[fallbackReason]) {
    return fallbackReasonMap[fallbackReason];
  }
  if (decisionReason && decisionReasonMap[decisionReason]) {
    return decisionReasonMap[decisionReason];
  }

  return fallbackReason || decisionReason;
};

export const resolveTemplateDecisionBadge = (
  templateDecision: AskTemplateDecision,
  messages: TemplateMessages,
) => {
  if (templateDecision.decisionReason === 'no_sql_pair_candidates') {
    return messages.badges.llmGenerated;
  }
  if (templateDecision.sqlSource === 'rendered_template') {
    return messages.badges.executable;
  }
  if (templateDecision.sqlSource === 'anchored_template') {
    return messages.badges.anchored;
  }
  if (templateDecision.sqlSource === 'anchored_generated') {
    return messages.badges.anchoredGenerated;
  }
  if (
    templateDecision.sqlSource === 'corrected' &&
    (templateDecision.mode === 'anchored_template' ||
      templateDecision.mode === 'executable_template')
  ) {
    return messages.badges.correctedTemplate;
  }
  if (templateDecision.mode === 'executable_template') {
    return messages.badges.executable;
  }
  if (templateDecision.mode === 'anchored_template') {
    return messages.badges.anchored;
  }
  if (templateDecision.mode === 'trusted_reference') {
    return messages.badges.trustedReference;
  }
  return messages.badges.reference;
};

const resolveTemplateDecisionSqlSourceText = (
  templateDecision: AskTemplateDecision,
  messages: TemplateMessages,
) => {
  const sqlSourceMap: Record<string, string> = {
    anchored_generated: messages.sqlSources.anchoredGenerated,
    anchored_template: messages.sqlSources.anchoredTemplate,
    corrected: messages.sqlSources.corrected,
    generated: messages.sqlSources.generated,
    rendered_template: messages.sqlSources.renderedTemplate,
  };

  if (!templateDecision.sqlSource) {
    return null;
  }

  if (isDirectLlmSqlGeneration(templateDecision)) {
    return messages.sqlSources.directGenerated;
  }

  return sqlSourceMap[templateDecision.sqlSource] || templateDecision.sqlSource;
};

const resolveTemplateDecisionTagColor = (
  templateDecision: AskTemplateDecision,
) => {
  if (templateDecision.sqlSource === 'rendered_template') {
    return 'geekblue';
  }
  if (templateDecision.sqlSource === 'anchored_template') {
    return 'purple';
  }
  if (templateDecision.sqlSource === 'anchored_generated') {
    return 'magenta';
  }
  if (
    templateDecision.sqlSource === 'corrected' &&
    (templateDecision.mode === 'anchored_template' ||
      templateDecision.mode === 'executable_template')
  ) {
    return 'cyan';
  }
  if (templateDecision.mode === 'trusted_reference') {
    return 'gold';
  }
  return 'default';
};

const formatInstructionCount = (
  instructionCount: number | null | undefined,
  messages: TemplateMessages,
) =>
  typeof instructionCount === 'number'
    ? instructionCount > 0
      ? `${messages.labels.analysisRulesMatched}${instructionCount}${messages.labels.analysisRulesMatchedSuffix}`
      : messages.labels.analysisRulesNotMatched
    : null;

const resolveReasonLabel = (
  templateDecision: AskTemplateDecision,
  messages: TemplateMessages,
) =>
  templateDecision.fallbackReason
    ? messages.labels.fallbackReason
    : messages.labels.decisionReason;

const resolveGeneralTemplateDecisionPresentation = (
  templateDecision: AskTemplateDecision,
  messages: TemplateMessages,
): TemplateDecisionPresentation => {
  const reasonText = resolveDecisionReasonText(templateDecision, messages);
  const requiredExternalDependencies =
    templateDecision.requiredExternalDependencies?.filter(Boolean).join(', ') ||
    null;
  const hasExternalDependencyGap = Boolean(requiredExternalDependencies);
  const instructionCountText = formatInstructionCount(
    templateDecision.instructionCount,
    messages,
  );

  return {
    badge: hasExternalDependencyGap
      ? messages.badges.missingExternalData
      : messages.badges.knowledgeAnswer,
    description:
      joinParts([
        templateDecision.templateTitle
          ? `${messages.labels.template}${templateDecision.templateTitle}`
          : null,
        templateDecision.templateId != null
          ? `${messages.labels.templateId}${templateDecision.templateId}`
          : null,
        hasExternalDependencyGap
          ? messages.reasons.missingExternalData
          : reasonText,
        requiredExternalDependencies
          ? `${messages.labels.requiredExternalDependencies}${requiredExternalDependencies}`
          : null,
        instructionCountText,
        messages.labels.noSqlFlow,
      ]) || null,
    tagColor: hasExternalDependencyGap ? 'warning' : 'default',
    templateTitle: templateDecision.templateTitle || null,
  };
};

export const resolveTemplateDecisionPresentation = (
  templateDecision: AskTemplateDecision | null | undefined,
  messages: TemplateMessages,
  options: TemplateDecisionPresentationOptions = {},
): TemplateDecisionPresentation | null => {
  if (!templateDecision) {
    return null;
  }

  if (options.isSqlFlow === false) {
    return resolveGeneralTemplateDecisionPresentation(
      templateDecision,
      messages,
    );
  }

  const reasonText = resolveDecisionReasonText(templateDecision, messages);
  const sqlSourceText = resolveTemplateDecisionSqlSourceText(
    templateDecision,
    messages,
  );
  const directLlmSqlGeneration = isDirectLlmSqlGeneration(templateDecision);
  const missingParameters =
    templateDecision.missingParameters?.filter(Boolean).join(', ') || null;
  const parametersText = formatTemplateDecisionParameters(
    templateDecision.parameters,
  );
  const instructionCountText = formatInstructionCount(
    templateDecision.instructionCount,
    messages,
  );
  const requiredExternalDependencies =
    templateDecision.requiredExternalDependencies?.filter(Boolean).join(', ') ||
    null;
  const sqlTemplateReferenceStatus = directLlmSqlGeneration
    ? `${messages.labels.sqlTemplateReference}${messages.labels.notMatched}`
    : null;
  const reasonDescription =
    reasonText && !directLlmSqlGeneration
      ? `${resolveReasonLabel(templateDecision, messages)}${reasonText}`
      : null;

  return {
    badge: resolveTemplateDecisionBadge(templateDecision, messages),
    description:
      joinParts([
        templateDecision.templateTitle
          ? `${messages.labels.template}${templateDecision.templateTitle}`
          : null,
        templateDecision.templateId != null
          ? `${messages.labels.templateId}${templateDecision.templateId}`
          : null,
        templateDecision.mode
          ? `${messages.labels.mode}${templateDecision.mode}`
          : null,
        sqlTemplateReferenceStatus,
        reasonDescription,
        missingParameters
          ? `${messages.labels.missingParameters}${missingParameters}`
          : null,
        parametersText
          ? `${messages.labels.parameters}${parametersText}`
          : null,
        instructionCountText,
        requiredExternalDependencies
          ? `${messages.labels.requiredExternalDependencies}${requiredExternalDependencies}`
          : null,
        templateDecision.historyBackedTemplateContinuity
          ? messages.labels.historyContinuity
          : null,
        sqlSourceText ? `${messages.labels.sqlSource}${sqlSourceText}` : null,
      ]) || null,
    tagColor: resolveTemplateDecisionTagColor(templateDecision),
    templateTitle: templateDecision.templateTitle || null,
  };
};

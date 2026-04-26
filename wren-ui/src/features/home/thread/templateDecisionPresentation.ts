import type { AskTemplateDecision } from '@/types/home';

import type { ThreadWorkbenchMessages } from './threadWorkbenchMessages';

type TemplateMessages = ThreadWorkbenchMessages['template'];

export type TemplateDecisionPresentation = {
  badge: string;
  description?: string | null;
  tagColor: string;
  templateTitle?: string | null;
};

const joinParts = (parts: Array<string | null | undefined>) =>
  parts.filter((part): part is string => Boolean(part)).join(' · ');

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

export const resolveTemplateDecisionPresentation = (
  templateDecision: AskTemplateDecision | null | undefined,
  messages: TemplateMessages,
): TemplateDecisionPresentation | null => {
  if (!templateDecision) {
    return null;
  }

  const reasonText = resolveDecisionReasonText(templateDecision, messages);
  const sqlSourceText = resolveTemplateDecisionSqlSourceText(
    templateDecision,
    messages,
  );
  const missingParameters =
    templateDecision.missingParameters?.filter(Boolean).join(', ') || null;

  return {
    badge: resolveTemplateDecisionBadge(templateDecision, messages),
    description:
      joinParts([
        templateDecision.templateTitle
          ? `${messages.labels.template}${templateDecision.templateTitle}`
          : null,
        reasonText,
        missingParameters
          ? `${messages.labels.missingParameters}${missingParameters}`
          : null,
        sqlSourceText ? `${messages.labels.sqlSource}${sqlSourceText}` : null,
      ]) || null,
    tagColor: resolveTemplateDecisionTagColor(templateDecision),
    templateTitle: templateDecision.templateTitle || null,
  };
};

import type { AskTemplateDecision } from '@server/models/adaptor';

const DIRECT_TEMPLATE_SQL_SOURCES = new Set([
  'anchored_template',
  'rendered_template',
]);

type TemplateDecisionCarrier =
  | {
      templateDecision?: AskTemplateDecision | null;
    }
  | {
      detail?: any;
    }
  | null
  | undefined;

export const getTemplateDecision = (
  carrier: TemplateDecisionCarrier,
): AskTemplateDecision | null => {
  if (!carrier || typeof carrier !== 'object') {
    return null;
  }

  if ('templateDecision' in carrier) {
    return carrier.templateDecision ?? null;
  }

  if ('detail' in carrier && carrier.detail) {
    const templateDecision = (carrier.detail as any).templateDecision;
    return (templateDecision as AskTemplateDecision | null | undefined) ?? null;
  }

  return null;
};

export const shouldExecuteTemplateSqlAsDialect = (
  templateDecision?: AskTemplateDecision | null,
) =>
  Boolean(
    templateDecision &&
    DIRECT_TEMPLATE_SQL_SOURCES.has(templateDecision.sqlSource ?? '') &&
    !(templateDecision.missingParameters || []).length,
  );

export const getPreviewSqlModeForTemplateCarrier = (
  carrier: TemplateDecisionCarrier,
) =>
  shouldExecuteTemplateSqlAsDialect(getTemplateDecision(carrier))
    ? 'dialect'
    : undefined;

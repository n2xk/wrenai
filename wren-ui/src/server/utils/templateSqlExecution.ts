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
  | {
      sqlMode?: 'wren' | 'dialect' | null;
      artifactLineage?: {
        sqlMode?: 'wren' | 'dialect' | null;
      } | null;
    }
  | null
  | undefined;

export type PreviewSqlMode = 'wren' | 'dialect';

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

export const getStoredPreviewSqlMode = (
  carrier: TemplateDecisionCarrier,
): PreviewSqlMode | undefined => {
  if (!carrier || typeof carrier !== 'object') {
    return undefined;
  }

  if ('sqlMode' in carrier && carrier.sqlMode) {
    return carrier.sqlMode;
  }

  if (
    'artifactLineage' in carrier &&
    carrier.artifactLineage?.sqlMode
  ) {
    return carrier.artifactLineage.sqlMode;
  }

  if ('detail' in carrier && carrier.detail?.sqlMode) {
    return carrier.detail.sqlMode;
  }

  return undefined;
};

export const getPreviewSqlModeForTemplateCarrier = (
  carrier: TemplateDecisionCarrier,
) => {
  const storedSqlMode = getStoredPreviewSqlMode(carrier);
  if (storedSqlMode) {
    return storedSqlMode;
  }

  return shouldExecuteTemplateSqlAsDialect(getTemplateDecision(carrier))
    ? 'dialect'
    : undefined;
};

export const resolvePreviewSqlMode = (
  ...carriers: TemplateDecisionCarrier[]
): PreviewSqlMode | undefined => {
  for (const carrier of carriers) {
    const sqlMode = getPreviewSqlModeForTemplateCarrier(carrier);
    if (sqlMode) {
      return sqlMode;
    }
  }
  return undefined;
};

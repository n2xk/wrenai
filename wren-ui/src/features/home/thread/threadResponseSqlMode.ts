import type { AskTemplateDecision, ThreadResponse } from '@/types/home';
import type { SqlPreviewMode } from '@/utils/sqlPreviewRest';

const DIRECT_TEMPLATE_SQL_SOURCES = new Set([
  'anchored_template',
  'rendered_template',
]);

export const shouldPreviewTemplateSqlAsDialect = (
  templateDecision?: AskTemplateDecision | null,
) =>
  Boolean(
    templateDecision &&
    DIRECT_TEMPLATE_SQL_SOURCES.has(templateDecision.sqlSource ?? '') &&
    !(templateDecision.missingParameters || []).length,
  );

export const resolveThreadResponseSqlPreviewMode = (
  response?: Pick<ThreadResponse, 'askingTask'> | null,
  sourceResponse?: Pick<ThreadResponse, 'askingTask'> | null,
): SqlPreviewMode | undefined =>
  shouldPreviewTemplateSqlAsDialect(
    response?.askingTask?.diagnostics?.templateDecision ||
      sourceResponse?.askingTask?.diagnostics?.templateDecision,
  )
    ? 'dialect'
    : undefined;

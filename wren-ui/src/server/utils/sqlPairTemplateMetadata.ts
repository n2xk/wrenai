import { SqlPair } from '@server/repositories';

export const SQL_PAIR_TEMPLATE_LEVELS = ['L0', 'L1', 'L2', 'L3'] as const;
export const SQL_PAIR_TEMPLATE_MODES = [
  'reference',
  'trusted_reference',
  'anchored_template',
  'executable_template',
] as const;
export const SQL_PAIR_ASSET_KINDS = ['sql_pair', 'sql_template'] as const;
export const SQL_PAIR_SOURCE_TYPES = [
  'user_saved',
  'admin_marked',
  'business_import',
  'system_promoted',
] as const;
export const SQL_PAIR_SCOPE_TYPES = [
  'personal',
  'workspace',
  'knowledge_base',
] as const;
export const SQL_PAIR_STATUSES = ['draft', 'active', 'deprecated'] as const;

type StringLiteralTuple = readonly string[];

const pickAllowed = <TValues extends StringLiteralTuple>(
  value: unknown,
  allowed: TValues,
  fallback: TValues[number],
): TValues[number] =>
  typeof value === 'string' && allowed.includes(value) ? value : fallback;

const pickJsonObject = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;

export const normalizeSqlPairTemplateMetadata = (
  payload: Record<string, any>,
  options: { includeDefaults?: boolean } = {},
): Partial<SqlPair> => ({
  ...(options.includeDefaults !== false || payload.assetKind !== undefined
    ? {
        assetKind: pickAllowed(
          payload.assetKind,
          SQL_PAIR_ASSET_KINDS,
          'sql_pair',
        ),
      }
    : {}),
  ...(options.includeDefaults !== false || payload.templateLevel !== undefined
    ? {
        templateLevel: pickAllowed(
          payload.templateLevel,
          SQL_PAIR_TEMPLATE_LEVELS,
          'L0',
        ),
      }
    : {}),
  ...(options.includeDefaults !== false || payload.templateMode !== undefined
    ? {
        templateMode: pickAllowed(
          payload.templateMode,
          SQL_PAIR_TEMPLATE_MODES,
          'reference',
        ),
      }
    : {}),
  ...(options.includeDefaults !== false || payload.sourceType !== undefined
    ? {
        sourceType: pickAllowed(
          payload.sourceType,
          SQL_PAIR_SOURCE_TYPES,
          'user_saved',
        ),
      }
    : {}),
  ...(options.includeDefaults !== false || payload.scopeType !== undefined
    ? {
        scopeType: pickAllowed(
          payload.scopeType,
          SQL_PAIR_SCOPE_TYPES,
          'knowledge_base',
        ),
      }
    : {}),
  ...(options.includeDefaults !== false || payload.parameterSchema !== undefined
    ? { parameterSchema: pickJsonObject(payload.parameterSchema) }
    : {}),
  ...(options.includeDefaults !== false ||
  payload.businessSignature !== undefined
    ? { businessSignature: pickJsonObject(payload.businessSignature) }
    : {}),
  ...(options.includeDefaults !== false || payload.templateVersion !== undefined
    ? {
        templateVersion:
          typeof payload.templateVersion === 'number' &&
          payload.templateVersion > 0
            ? Math.floor(payload.templateVersion)
            : 1,
      }
    : {}),
  ...(options.includeDefaults !== false || payload.status !== undefined
    ? { status: pickAllowed(payload.status, SQL_PAIR_STATUSES, 'active') }
    : {}),
});

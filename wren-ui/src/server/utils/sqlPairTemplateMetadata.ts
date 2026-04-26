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

const GOVERNED_TEMPLATE_MODES = new Set([
  'anchored_template',
  'executable_template',
]);
const GOVERNED_TEMPLATE_SOURCE_TYPES = new Set([
  'admin_marked',
  'business_import',
  'system_promoted',
]);
const MANAGER_ROLE_KEYS = new Set([
  'owner',
  'admin',
  'workspace_owner',
  'workspace_admin',
]);
const TEMPLATE_LEVEL_RANK: Record<string, number> = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
};

type StringLiteralTuple = readonly string[];

type TemplateAuthorizationActor = {
  isPlatformAdmin?: boolean | null;
  principalId?: string | null;
  workspaceRoleKeys?: string[] | null;
};

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

const pickOptionalDateTime = (value: unknown) => {
  if (value == null || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return null;
  }

  return Number.isNaN(Date.parse(normalizedValue)) ? null : normalizedValue;
};

const normalizeRoleKey = (roleKey?: string | null) =>
  String(roleKey || '')
    .trim()
    .toLowerCase();

const getTemplateLevelRank = (templateLevel?: string | null) =>
  TEMPLATE_LEVEL_RANK[String(templateLevel || 'L0').toUpperCase()] || 0;

export const canManageGovernedSqlPair = (
  actor?: TemplateAuthorizationActor | null,
) =>
  Boolean(
    actor?.isPlatformAdmin ||
    (actor?.workspaceRoleKeys || []).some((roleKey) =>
      MANAGER_ROLE_KEYS.has(normalizeRoleKey(roleKey)),
    ),
  );

export const isGovernedSqlPair = (
  sqlPair?: Partial<
    Pick<
      SqlPair,
      | 'assetKind'
      | 'approvedAt'
      | 'approvedBy'
      | 'effectiveFrom'
      | 'effectiveTo'
      | 'sourceType'
      | 'templateLevel'
      | 'templateMode'
    >
  > | null,
) => {
  if (!sqlPair) {
    return false;
  }

  return Boolean(
    sqlPair.assetKind === 'sql_template' ||
    GOVERNED_TEMPLATE_MODES.has(String(sqlPair.templateMode || '')) ||
    getTemplateLevelRank(sqlPair.templateLevel) >= 2 ||
    GOVERNED_TEMPLATE_SOURCE_TYPES.has(String(sqlPair.sourceType || '')) ||
    sqlPair.approvedAt ||
    sqlPair.approvedBy ||
    sqlPair.effectiveFrom ||
    sqlPair.effectiveTo,
  );
};

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
  ...(options.includeDefaults !== false || payload.effectiveFrom !== undefined
    ? { effectiveFrom: pickOptionalDateTime(payload.effectiveFrom) }
    : {}),
  ...(options.includeDefaults !== false || payload.effectiveTo !== undefined
    ? { effectiveTo: pickOptionalDateTime(payload.effectiveTo) }
    : {}),
  ...(options.includeDefaults !== false || payload.approvedBy !== undefined
    ? {
        approvedBy:
          typeof payload.approvedBy === 'string' && payload.approvedBy.trim()
            ? payload.approvedBy.trim()
            : null,
      }
    : {}),
  ...(options.includeDefaults !== false || payload.approvedAt !== undefined
    ? { approvedAt: pickOptionalDateTime(payload.approvedAt) }
    : {}),
});

export const finalizeSqlPairTemplateMetadata = ({
  actor,
  currentSqlPair,
  metadata,
  now = new Date(),
}: {
  actor?: TemplateAuthorizationActor | null;
  currentSqlPair?: Partial<SqlPair> | null;
  metadata: Partial<SqlPair>;
  now?: Date;
}) => {
  const normalizedCurrentMetadata = currentSqlPair
    ? normalizeSqlPairTemplateMetadata(currentSqlPair as Record<string, any>)
    : null;
  const mergedMetadata = {
    ...(normalizedCurrentMetadata || {}),
    ...metadata,
  } as Partial<SqlPair>;
  const wantsGovernedTemplate = isGovernedSqlPair(mergedMetadata);

  if (wantsGovernedTemplate && !canManageGovernedSqlPair(actor)) {
    throw new Error(
      'Business SQL templates require workspace owner/admin approval',
    );
  }

  const nextMetadata: Partial<SqlPair> = {
    ...mergedMetadata,
  };

  if (wantsGovernedTemplate) {
    if (nextMetadata.assetKind !== 'sql_template') {
      nextMetadata.assetKind = 'sql_template';
    }
    if (getTemplateLevelRank(nextMetadata.templateLevel) < 2) {
      nextMetadata.templateLevel = 'L2';
    }
    if (!GOVERNED_TEMPLATE_MODES.has(String(nextMetadata.templateMode || ''))) {
      nextMetadata.templateMode = 'anchored_template';
    }
    if (
      !GOVERNED_TEMPLATE_SOURCE_TYPES.has(String(nextMetadata.sourceType || ''))
    ) {
      nextMetadata.sourceType = 'admin_marked';
    }
    if (!nextMetadata.status) {
      nextMetadata.status = 'active';
    }
    if (!nextMetadata.approvedBy) {
      nextMetadata.approvedBy = actor?.principalId || null;
    }
    if (!nextMetadata.approvedAt) {
      nextMetadata.approvedAt = now.toISOString();
    }
    if (!nextMetadata.templateVersion || nextMetadata.templateVersion <= 0) {
      nextMetadata.templateVersion = 1;
    }
  }

  if (
    nextMetadata.effectiveFrom &&
    nextMetadata.effectiveTo &&
    Date.parse(nextMetadata.effectiveFrom) >
      Date.parse(nextMetadata.effectiveTo)
  ) {
    throw new Error(
      'SQL template effectiveFrom must be earlier than effectiveTo',
    );
  }

  return nextMetadata;
};

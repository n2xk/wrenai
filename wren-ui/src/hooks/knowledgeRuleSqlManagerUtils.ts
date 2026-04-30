import type {
  CreateInstructionInput,
  CreateSqlPairInput,
  Instruction,
  SqlPair,
  SqlPairTemplateMode,
} from '@/types/knowledge';
import {
  SQL_PAIR_BUSINESS_TEMPLATE_PRESET,
  SQL_PAIR_REFERENCE_PRESET,
} from '@/types/knowledge';

export type RuleDetailFormValues = {
  summary: string;
  scope: 'all' | 'matched';
  content: string;
  relatedBusinessTermsText?: string;
  relatedExternalDependenciesText?: string;
  runtimeUsageJson?: string;
};

export type SqlTemplateFormValues = {
  sql: string;
  scope: 'all' | 'matched';
  description: string;
  templateMode: SqlPairTemplateMode;
  requiredSlotsText?: string;
  expectedGrain?: string;
  positiveScenariosText?: string;
  negativeScenariosText?: string;
  externalDependenciesText?: string;
  parameterSchemaJson?: string;
  businessSignatureJson?: string;
};

const parseTextList = (value?: string) =>
  Array.from(
    new Set(
      (value || '')
        .split(/[\n,，]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );

const formatTextList = (value?: string[]) => (value || []).join('\n');

const SQL_TEMPLATE_MODES: SqlPairTemplateMode[] = [
  'reference',
  'trusted_reference',
  'anchored_template',
  'executable_template',
];

const isSqlPairTemplateMode = (
  value?: string | null,
): value is SqlPairTemplateMode =>
  SQL_TEMPLATE_MODES.includes(value as SqlPairTemplateMode);

export const resolveSqlTemplateFormMode = (
  sqlPair?: Pick<SqlPair, 'templateMode' | 'assetKind'> | null,
): SqlPairTemplateMode => {
  if (isSqlPairTemplateMode(sqlPair?.templateMode as string | null)) {
    return sqlPair?.templateMode as SqlPairTemplateMode;
  }
  return sqlPair?.assetKind === 'sql_template'
    ? 'anchored_template'
    : 'reference';
};

const pickTextList = (
  value: Record<string, any> | null | undefined,
  ...keys: string[]
) => {
  for (const key of keys) {
    const raw = value?.[key];
    if (Array.isArray(raw)) {
      return formatTextList(
        raw.map((item) => `${item}`.trim()).filter(Boolean),
      );
    }
    if (typeof raw === 'string' && raw.trim()) {
      return raw.trim();
    }
  }
  return '';
};

const pickTextValue = (
  value: Record<string, any> | null | undefined,
  ...keys: string[]
) => {
  for (const key of keys) {
    const raw = value?.[key];
    if (typeof raw === 'string' && raw.trim()) {
      return raw.trim();
    }
  }
  return '';
};

const buildSqlTemplateMetadata = (
  templateMode: SqlPairTemplateMode,
): Pick<
  CreateSqlPairInput,
  | 'assetKind'
  | 'templateLevel'
  | 'templateMode'
  | 'sourceType'
  | 'scopeType'
  | 'approvedAt'
  | 'approvedBy'
  | 'effectiveFrom'
  | 'effectiveTo'
  | 'status'
> => {
  if (templateMode === 'anchored_template') {
    return {
      ...SQL_PAIR_BUSINESS_TEMPLATE_PRESET,
      templateMode,
      status: 'active',
    };
  }
  if (templateMode === 'executable_template') {
    return {
      ...SQL_PAIR_BUSINESS_TEMPLATE_PRESET,
      templateLevel: 'L3',
      templateMode,
      status: 'active',
    };
  }
  if (templateMode === 'trusted_reference') {
    return {
      ...SQL_PAIR_REFERENCE_PRESET,
      templateLevel: 'L1',
      templateMode,
      approvedAt: null,
      approvedBy: null,
      effectiveFrom: null,
      effectiveTo: null,
      status: 'active',
    };
  }
  return {
    ...SQL_PAIR_REFERENCE_PRESET,
    approvedAt: null,
    approvedBy: null,
    effectiveFrom: null,
    effectiveTo: null,
    status: 'active',
  };
};

const mergeParameterSchema = ({
  parameterSchema,
  requiredSlotsText,
}: {
  parameterSchema: Record<string, any> | null;
  requiredSlotsText?: string;
}) => {
  const required = parseTextList(requiredSlotsText);
  if (!parameterSchema && required.length === 0) {
    return null;
  }
  return {
    ...(parameterSchema || {}),
    required,
  };
};

const mergeBusinessSignature = ({
  businessSignature,
  expectedGrain,
  externalDependenciesText,
  negativeScenariosText,
  positiveScenariosText,
}: {
  businessSignature: Record<string, any> | null;
  expectedGrain?: string;
  externalDependenciesText?: string;
  negativeScenariosText?: string;
  positiveScenariosText?: string;
}) => {
  const nextSignature = {
    ...(businessSignature || {}),
  };
  const positiveCues = parseTextList(positiveScenariosText);
  const negativeCues = parseTextList(negativeScenariosText);
  const externalDependencies = parseTextList(externalDependenciesText);
  const normalizedExpectedGrain = expectedGrain?.trim() || '';
  const shouldWritePositiveCues =
    positiveCues.length > 0 ||
    Object.prototype.hasOwnProperty.call(nextSignature, 'positiveCues');
  const shouldWriteNegativeCues =
    negativeCues.length > 0 ||
    Object.prototype.hasOwnProperty.call(nextSignature, 'negativeCues');
  const shouldWriteExternalDependencies =
    externalDependencies.length > 0 ||
    Object.prototype.hasOwnProperty.call(nextSignature, 'externalDependencies');

  if (shouldWritePositiveCues) {
    nextSignature.positiveCues = positiveCues;
    delete nextSignature.positive_cues;
  }
  if (shouldWriteNegativeCues) {
    nextSignature.negativeCues = negativeCues;
    delete nextSignature.negative_cues;
  }
  if (shouldWriteExternalDependencies) {
    nextSignature.externalDependencies = externalDependencies;
    delete nextSignature.external_dependencies;
  }
  if (normalizedExpectedGrain) {
    nextSignature.expectedGrain = normalizedExpectedGrain;
    delete nextSignature.expected_grain;
    delete nextSignature.resultGrain;
    delete nextSignature.result_grain;
  } else {
    delete nextSignature.expectedGrain;
  }

  return Object.keys(nextSignature).length > 0 ? nextSignature : null;
};

const parseOptionalJsonObject = (value?: string) => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('结构化字段必须是 JSON object');
  }
  return parsed as Record<string, any>;
};

const formatJsonObject = (value?: Record<string, any> | null) =>
  value && typeof value === 'object' ? JSON.stringify(value, null, 2) : '';

const INSTRUCTION_SUMMARY_PREFIX = '【规则描述】';
const INSTRUCTION_CONTENT_PREFIX = '【规则内容】';
const RULE_SQL_LIST_CACHE_TTL_MS = 15_000;

export const EMPTY_RULE_DETAIL_VALUES: RuleDetailFormValues = {
  summary: '',
  scope: 'all',
  content: '',
  relatedBusinessTermsText: '',
  relatedExternalDependenciesText: '',
  runtimeUsageJson: '',
};

export const shouldUseRuleSqlListCache = ({
  forceRefresh,
  lastLoadedAt,
  lastLoadedScopeKey,
  currentScopeKey,
  now = Date.now(),
  ttlMs = RULE_SQL_LIST_CACHE_TTL_MS,
}: {
  forceRefresh: boolean;
  lastLoadedAt: number;
  lastLoadedScopeKey?: string | null;
  currentScopeKey?: string | null;
  now?: number;
  ttlMs?: number;
}) =>
  !forceRefresh &&
  (!currentScopeKey ||
    !lastLoadedScopeKey ||
    currentScopeKey === lastLoadedScopeKey) &&
  lastLoadedAt > 0 &&
  now - lastLoadedAt <= ttlMs;

export const parseInstructionDraft = (
  instruction?: Instruction | null,
): RuleDetailFormValues => {
  const raw = instruction?.instruction?.trim() || '';
  const questions = instruction?.questions || [];
  if (!raw) {
    return {
      summary: '',
      scope: instruction?.isDefault ? 'all' : 'matched',
      content: '',
      relatedBusinessTermsText: formatTextList(
        instruction?.relatedBusinessTerms,
      ),
      relatedExternalDependenciesText: formatTextList(
        instruction?.relatedExternalDependencies,
      ),
      runtimeUsageJson: formatJsonObject(instruction?.runtimeUsage),
    };
  }

  if (
    raw.startsWith(INSTRUCTION_SUMMARY_PREFIX) &&
    raw.includes(`\n${INSTRUCTION_CONTENT_PREFIX}`)
  ) {
    const [summaryBlock, ...contentBlocks] = raw.split(
      `\n${INSTRUCTION_CONTENT_PREFIX}`,
    );
    return {
      summary: summaryBlock.replace(INSTRUCTION_SUMMARY_PREFIX, '').trim(),
      scope: instruction?.isDefault ? 'all' : 'matched',
      content: contentBlocks.join(`\n${INSTRUCTION_CONTENT_PREFIX}`).trim(),
      relatedBusinessTermsText: formatTextList(
        instruction?.relatedBusinessTerms,
      ),
      relatedExternalDependenciesText: formatTextList(
        instruction?.relatedExternalDependencies,
      ),
      runtimeUsageJson: formatJsonObject(instruction?.runtimeUsage),
    };
  }

  return {
    summary: questions[0] || raw.split('\n')[0] || '未命名规则',
    scope: instruction?.isDefault ? 'all' : 'matched',
    content: raw,
    relatedBusinessTermsText: formatTextList(instruction?.relatedBusinessTerms),
    relatedExternalDependenciesText: formatTextList(
      instruction?.relatedExternalDependencies,
    ),
    runtimeUsageJson: formatJsonObject(instruction?.runtimeUsage),
  };
};

export const buildInstructionPayload = (
  values: RuleDetailFormValues,
): CreateInstructionInput => {
  const summary = values.summary.trim() || '未命名规则';
  const content = values.content.trim() || summary;

  return {
    isDefault: values.scope === 'all',
    instruction: `${INSTRUCTION_SUMMARY_PREFIX}${summary}\n${INSTRUCTION_CONTENT_PREFIX}${content}`,
    questions: values.scope === 'all' ? [] : [summary],
    relatedBusinessTerms: parseTextList(values.relatedBusinessTermsText),
    relatedExternalDependencies: parseTextList(
      values.relatedExternalDependenciesText,
    ),
    runtimeUsage: parseOptionalJsonObject(values.runtimeUsageJson),
  };
};

export const buildSqlTemplatePayload = (
  values: SqlTemplateFormValues,
): CreateSqlPairInput => {
  const templateMetadata = buildSqlTemplateMetadata(values.templateMode);
  const parameterSchema = mergeParameterSchema({
    parameterSchema: parseOptionalJsonObject(values.parameterSchemaJson),
    requiredSlotsText: values.requiredSlotsText,
  });
  const businessSignature = mergeBusinessSignature({
    businessSignature: parseOptionalJsonObject(values.businessSignatureJson),
    expectedGrain: values.expectedGrain,
    externalDependenciesText: values.externalDependenciesText,
    negativeScenariosText: values.negativeScenariosText,
    positiveScenariosText: values.positiveScenariosText,
  });

  return {
    sql: values.sql,
    question: values.description,
    ...templateMetadata,
    parameterSchema,
    businessSignature,
  };
};

export const buildSqlTemplateFormValues = (
  sqlPair?: SqlPair | null,
): SqlTemplateFormValues => {
  const businessSignature = sqlPair?.businessSignature || null;
  const parameterSchema = sqlPair?.parameterSchema || null;
  return {
    sql: sqlPair?.sql || '',
    scope: 'all',
    description: sqlPair?.question || '',
    templateMode: resolveSqlTemplateFormMode(sqlPair),
    requiredSlotsText: pickTextList(parameterSchema, 'required'),
    expectedGrain: pickTextValue(
      businessSignature,
      'expectedGrain',
      'expected_grain',
      'resultGrain',
      'result_grain',
    ),
    positiveScenariosText: pickTextList(
      businessSignature,
      'positiveCues',
      'positive_cues',
    ),
    negativeScenariosText: pickTextList(
      businessSignature,
      'negativeCues',
      'negative_cues',
    ),
    externalDependenciesText: pickTextList(
      businessSignature,
      'externalDependencies',
      'external_dependencies',
    ),
    parameterSchemaJson: formatJsonObject(parameterSchema),
    businessSignatureJson: formatJsonObject(businessSignature),
  };
};

const hasSameQuestions = (left: string[] = [], right: string[] = []) =>
  left.length === right.length &&
  left.every((question, index) => question === right[index]);

export const findMatchingInstruction = ({
  ruleList,
  editingId,
  payload,
}: {
  ruleList: Instruction[];
  editingId?: number;
  payload: CreateInstructionInput;
}) => {
  if (editingId != null) {
    return ruleList.find((instruction) => instruction.id === editingId) || null;
  }

  return (
    ruleList.find(
      (instruction) =>
        instruction.instruction === payload.instruction &&
        instruction.isDefault === payload.isDefault &&
        hasSameQuestions(instruction.questions, payload.questions),
    ) ||
    ruleList[0] ||
    null
  );
};

export const findMatchingSqlPair = ({
  sqlList,
  editingId,
  payload,
}: {
  sqlList: SqlPair[];
  editingId?: number;
  payload: CreateSqlPairInput;
}) => {
  if (editingId != null) {
    return sqlList.find((sqlPair) => sqlPair.id === editingId) || null;
  }

  return (
    sqlList.find(
      (sqlPair) =>
        sqlPair.sql === payload.sql &&
        sqlPair.question === payload.question &&
        (sqlPair.templateMode || 'reference') ===
          (payload.templateMode || 'reference'),
    ) ||
    sqlList[0] ||
    null
  );
};

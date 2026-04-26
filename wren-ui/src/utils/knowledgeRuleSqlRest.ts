import {
  buildRuntimeScopeUrl,
  type ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import type {
  BusinessTerm,
  CreateBusinessTermInput,
  CreateExternalDependencyInput,
  CreateInstructionInput,
  CreateSqlPairInput,
  ExternalDependency,
  Instruction,
  SqlPair,
} from '@/types/knowledge';

type InstructionRestPayload = Partial<
  Pick<
    Instruction,
    | 'id'
    | 'instruction'
    | 'questions'
    | 'isDefault'
    | 'relatedBusinessTerms'
    | 'relatedExternalDependencies'
    | 'runtimeUsage'
    | 'createdAt'
    | 'updatedAt'
  >
> & {
  isGlobal?: boolean | null;
};

type SqlPairRestPayload = Partial<
  Pick<
    SqlPair,
    | 'id'
    | 'question'
    | 'sql'
    | 'assetKind'
    | 'approvedAt'
    | 'approvedBy'
    | 'templateLevel'
    | 'templateMode'
    | 'sourceType'
    | 'scopeType'
    | 'parameterSchema'
    | 'businessSignature'
    | 'effectiveFrom'
    | 'effectiveTo'
    | 'templateVersion'
    | 'status'
    | 'createdAt'
    | 'updatedAt'
  >
>;

type BusinessTermRestPayload = Partial<BusinessTerm>;
type ExternalDependencyRestPayload = Partial<ExternalDependency>;

const buildInstructionsCollectionUrl = (selector: ClientRuntimeScopeSelector) =>
  buildRuntimeScopeUrl('/api/v1/knowledge/instructions', {}, selector);

const buildInstructionItemUrl = (
  id: string | number,
  selector: ClientRuntimeScopeSelector,
) => buildRuntimeScopeUrl(`/api/v1/knowledge/instructions/${id}`, {}, selector);

const buildSqlPairsCollectionUrl = (selector: ClientRuntimeScopeSelector) =>
  buildRuntimeScopeUrl('/api/v1/knowledge/sql_pairs', {}, selector);

const buildSqlPairItemUrl = (
  id: string | number,
  selector: ClientRuntimeScopeSelector,
) => buildRuntimeScopeUrl(`/api/v1/knowledge/sql_pairs/${id}`, {}, selector);

const buildBusinessTermsCollectionUrl = (
  selector: ClientRuntimeScopeSelector,
) => buildRuntimeScopeUrl('/api/v1/knowledge/business_terms', {}, selector);

const buildBusinessTermItemUrl = (
  id: string | number,
  selector: ClientRuntimeScopeSelector,
) =>
  buildRuntimeScopeUrl(`/api/v1/knowledge/business_terms/${id}`, {}, selector);

const buildExternalDependenciesCollectionUrl = (
  selector: ClientRuntimeScopeSelector,
) =>
  buildRuntimeScopeUrl('/api/v1/knowledge/external_dependencies', {}, selector);

const buildExternalDependencyItemUrl = (
  id: string | number,
  selector: ClientRuntimeScopeSelector,
) =>
  buildRuntimeScopeUrl(
    `/api/v1/knowledge/external_dependencies/${id}`,
    {},
    selector,
  );

const buildSqlPairGenerateQuestionUrl = (
  selector: ClientRuntimeScopeSelector,
) =>
  buildRuntimeScopeUrl(
    '/api/v1/knowledge/sql_pairs/generate-question',
    {},
    selector,
  );

const normalizeStringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];

const normalizeObject = (value: unknown): Record<string, any> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;

const normalizeInstructionItem = (
  payload: InstructionRestPayload,
): Instruction | null => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const parsedId = Number(payload.id);
  if (!Number.isFinite(parsedId)) {
    return null;
  }

  return {
    id: parsedId,
    instruction:
      typeof payload.instruction === 'string' ? payload.instruction : '',
    questions: normalizeStringList(payload.questions),
    isDefault:
      typeof payload.isDefault === 'boolean'
        ? payload.isDefault
        : Boolean(payload.isGlobal),
    relatedBusinessTerms: normalizeStringList(payload.relatedBusinessTerms),
    relatedExternalDependencies: normalizeStringList(
      payload.relatedExternalDependencies,
    ),
    runtimeUsage: normalizeObject(payload.runtimeUsage),
    createdAt: typeof payload.createdAt === 'string' ? payload.createdAt : '',
    updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : '',
  };
};

const normalizeInstructionsPayload = (payload: unknown): Instruction[] => {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((item) => normalizeInstructionItem(item as InstructionRestPayload))
    .filter((item): item is Instruction => Boolean(item));
};

const normalizeSqlPairItem = (payload: SqlPairRestPayload): SqlPair | null => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const parsedId = Number(payload.id);
  if (!Number.isFinite(parsedId)) {
    return null;
  }

  return {
    id: parsedId,
    question: typeof payload.question === 'string' ? payload.question : '',
    sql: typeof payload.sql === 'string' ? payload.sql : '',
    assetKind:
      typeof payload.assetKind === 'string' ? payload.assetKind : 'sql_pair',
    approvedAt:
      typeof payload.approvedAt === 'string' ? payload.approvedAt : null,
    approvedBy:
      typeof payload.approvedBy === 'string' ? payload.approvedBy : null,
    templateLevel:
      typeof payload.templateLevel === 'string' ? payload.templateLevel : 'L0',
    templateMode:
      typeof payload.templateMode === 'string'
        ? payload.templateMode
        : 'reference',
    sourceType:
      typeof payload.sourceType === 'string'
        ? payload.sourceType
        : 'user_saved',
    scopeType:
      typeof payload.scopeType === 'string'
        ? payload.scopeType
        : 'knowledge_base',
    parameterSchema: normalizeObject(payload.parameterSchema),
    businessSignature: normalizeObject(payload.businessSignature),
    effectiveFrom:
      typeof payload.effectiveFrom === 'string' ? payload.effectiveFrom : null,
    effectiveTo:
      typeof payload.effectiveTo === 'string' ? payload.effectiveTo : null,
    templateVersion:
      typeof payload.templateVersion === 'number' ? payload.templateVersion : 1,
    status: typeof payload.status === 'string' ? payload.status : 'active',
    createdAt: typeof payload.createdAt === 'string' ? payload.createdAt : null,
    updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : null,
  };
};

const normalizeSqlPairsPayload = (payload: unknown): SqlPair[] => {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((item) => normalizeSqlPairItem(item as SqlPairRestPayload))
    .filter((item): item is SqlPair => Boolean(item));
};

const normalizeBusinessTermItem = (
  payload: BusinessTermRestPayload,
): BusinessTerm | null => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const parsedId = Number(payload.id);
  if (!Number.isFinite(parsedId)) {
    return null;
  }

  return {
    id: parsedId,
    termId: typeof payload.termId === 'string' ? payload.termId : '',
    name: typeof payload.name === 'string' ? payload.name : '',
    category:
      typeof payload.category === 'string' ? payload.category : 'metric',
    aliases: normalizeStringList(payload.aliases),
    definition:
      typeof payload.definition === 'string' ? payload.definition : '',
    canonicalExpression:
      typeof payload.canonicalExpression === 'string'
        ? payload.canonicalExpression
        : null,
    sourceTables: normalizeStringList(payload.sourceTables),
    sourceFields: normalizeStringList(payload.sourceFields),
    relatedRules: normalizeStringList(payload.relatedRules),
    relatedTemplates: normalizeStringList(payload.relatedTemplates),
    features: normalizeStringList(payload.features),
    conflictTerms: normalizeStringList(payload.conflictTerms),
    status: typeof payload.status === 'string' ? payload.status : 'active',
    createdAt: typeof payload.createdAt === 'string' ? payload.createdAt : null,
    updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : null,
  };
};

const normalizeBusinessTermsPayload = (payload: unknown): BusinessTerm[] => {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((item) => normalizeBusinessTermItem(item as BusinessTermRestPayload))
    .filter((item): item is BusinessTerm => Boolean(item));
};

const normalizeExternalDependencyItem = (
  payload: ExternalDependencyRestPayload,
): ExternalDependency | null => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const parsedId = Number(payload.id);
  if (!Number.isFinite(parsedId)) {
    return null;
  }

  return {
    id: parsedId,
    dependencyId:
      typeof payload.dependencyId === 'string' ? payload.dependencyId : '',
    name: typeof payload.name === 'string' ? payload.name : '',
    aliases: normalizeStringList(payload.aliases),
    sourceStatus:
      typeof payload.sourceStatus === 'string'
        ? payload.sourceStatus
        : 'missing',
    missingBehavior:
      typeof payload.missingBehavior === 'string'
        ? payload.missingBehavior
        : 'ask_user',
    requiredGrain: normalizeStringList(payload.requiredGrain),
    requiredByTerms: normalizeStringList(payload.requiredByTerms),
    requiredByTemplates: normalizeStringList(payload.requiredByTemplates),
    relatedRules: normalizeStringList(payload.relatedRules),
    askUserPrompt:
      typeof payload.askUserPrompt === 'string' ? payload.askUserPrompt : null,
    validation: normalizeObject(payload.validation),
    status: typeof payload.status === 'string' ? payload.status : 'active',
    createdAt: typeof payload.createdAt === 'string' ? payload.createdAt : null,
    updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : null,
  };
};

const normalizeExternalDependenciesPayload = (
  payload: unknown,
): ExternalDependency[] => {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((item) =>
      normalizeExternalDependencyItem(item as ExternalDependencyRestPayload),
    )
    .filter((item): item is ExternalDependency => Boolean(item));
};

export const parseKnowledgeRuleSqlRestResponse = async <TPayload>(
  response: Response,
  fallbackMessage: string,
): Promise<TPayload> => {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      (payload as { error?: string } | null)?.error || fallbackMessage,
    );
  }

  return payload as TPayload;
};

export const listKnowledgeInstructions = async (
  selector: ClientRuntimeScopeSelector,
) => {
  const response = await fetch(buildInstructionsCollectionUrl(selector));
  const payload = await parseKnowledgeRuleSqlRestResponse<unknown>(
    response,
    '加载分析规则失败，请稍后重试。',
  );

  return normalizeInstructionsPayload(payload);
};

export const createKnowledgeInstruction = async (
  selector: ClientRuntimeScopeSelector,
  data: CreateInstructionInput,
) => {
  const response = await fetch(buildInstructionsCollectionUrl(selector), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instruction: data.instruction,
      questions: data.isDefault ? [] : data.questions,
      isGlobal: data.isDefault,
      relatedBusinessTerms: data.relatedBusinessTerms || [],
      relatedExternalDependencies: data.relatedExternalDependencies || [],
      runtimeUsage: data.runtimeUsage || null,
    }),
  });

  return parseKnowledgeRuleSqlRestResponse<InstructionRestPayload>(
    response,
    '创建分析规则失败，请稍后重试。',
  );
};

export const updateKnowledgeInstruction = async (
  selector: ClientRuntimeScopeSelector,
  id: number,
  data: CreateInstructionInput,
) => {
  const response = await fetch(buildInstructionItemUrl(id, selector), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instruction: data.instruction,
      questions: data.isDefault ? [] : data.questions,
      isGlobal: data.isDefault,
      relatedBusinessTerms: data.relatedBusinessTerms || [],
      relatedExternalDependencies: data.relatedExternalDependencies || [],
      runtimeUsage: data.runtimeUsage || null,
    }),
  });

  return parseKnowledgeRuleSqlRestResponse<InstructionRestPayload>(
    response,
    '更新分析规则失败，请稍后重试。',
  );
};

export const deleteKnowledgeInstruction = async (
  selector: ClientRuntimeScopeSelector,
  id: number,
) => {
  const response = await fetch(buildInstructionItemUrl(id, selector), {
    method: 'DELETE',
  });

  return parseKnowledgeRuleSqlRestResponse<unknown>(
    response,
    '删除分析规则失败，请稍后重试。',
  );
};

export const listKnowledgeSqlPairs = async (
  selector: ClientRuntimeScopeSelector,
) => {
  const response = await fetch(buildSqlPairsCollectionUrl(selector));
  const payload = await parseKnowledgeRuleSqlRestResponse<unknown>(
    response,
    '加载 SQL 模板失败，请稍后重试。',
  );

  return normalizeSqlPairsPayload(payload);
};

export const createKnowledgeSqlPair = async (
  selector: ClientRuntimeScopeSelector,
  data: CreateSqlPairInput,
) => {
  const response = await fetch(buildSqlPairsCollectionUrl(selector), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  return parseKnowledgeRuleSqlRestResponse<SqlPairRestPayload>(
    response,
    '创建 SQL 模板失败，请稍后重试。',
  );
};

export const updateKnowledgeSqlPair = async (
  selector: ClientRuntimeScopeSelector,
  id: number,
  data: CreateSqlPairInput,
) => {
  const response = await fetch(buildSqlPairItemUrl(id, selector), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  return parseKnowledgeRuleSqlRestResponse<SqlPairRestPayload>(
    response,
    '更新 SQL 模板失败，请稍后重试。',
  );
};

export const deleteKnowledgeSqlPair = async (
  selector: ClientRuntimeScopeSelector,
  id: number,
) => {
  const response = await fetch(buildSqlPairItemUrl(id, selector), {
    method: 'DELETE',
  });

  return parseKnowledgeRuleSqlRestResponse<unknown>(
    response,
    '删除 SQL 模板失败，请稍后重试。',
  );
};

export const listKnowledgeBusinessTerms = async (
  selector: ClientRuntimeScopeSelector,
) => {
  const response = await fetch(buildBusinessTermsCollectionUrl(selector));
  const payload = await parseKnowledgeRuleSqlRestResponse<unknown>(
    response,
    '加载业务词典失败，请稍后重试。',
  );

  return normalizeBusinessTermsPayload(payload);
};

export const createKnowledgeBusinessTerm = async (
  selector: ClientRuntimeScopeSelector,
  data: CreateBusinessTermInput,
) => {
  const response = await fetch(buildBusinessTermsCollectionUrl(selector), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  return parseKnowledgeRuleSqlRestResponse<BusinessTermRestPayload>(
    response,
    '创建业务词典失败，请稍后重试。',
  );
};

export const updateKnowledgeBusinessTerm = async (
  selector: ClientRuntimeScopeSelector,
  id: number,
  data: CreateBusinessTermInput,
) => {
  const response = await fetch(buildBusinessTermItemUrl(id, selector), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  return parseKnowledgeRuleSqlRestResponse<BusinessTermRestPayload>(
    response,
    '更新业务词典失败，请稍后重试。',
  );
};

export const deleteKnowledgeBusinessTerm = async (
  selector: ClientRuntimeScopeSelector,
  id: number,
) => {
  const response = await fetch(buildBusinessTermItemUrl(id, selector), {
    method: 'DELETE',
  });

  return parseKnowledgeRuleSqlRestResponse<unknown>(
    response,
    '删除业务词典失败，请稍后重试。',
  );
};

export const listKnowledgeExternalDependencies = async (
  selector: ClientRuntimeScopeSelector,
) => {
  const response = await fetch(
    buildExternalDependenciesCollectionUrl(selector),
  );
  const payload = await parseKnowledgeRuleSqlRestResponse<unknown>(
    response,
    '加载外部数据依赖失败，请稍后重试。',
  );

  return normalizeExternalDependenciesPayload(payload);
};

export const createKnowledgeExternalDependency = async (
  selector: ClientRuntimeScopeSelector,
  data: CreateExternalDependencyInput,
) => {
  const response = await fetch(
    buildExternalDependenciesCollectionUrl(selector),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
  );

  return parseKnowledgeRuleSqlRestResponse<ExternalDependencyRestPayload>(
    response,
    '创建外部数据依赖失败，请稍后重试。',
  );
};

export const updateKnowledgeExternalDependency = async (
  selector: ClientRuntimeScopeSelector,
  id: number,
  data: CreateExternalDependencyInput,
) => {
  const response = await fetch(buildExternalDependencyItemUrl(id, selector), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  return parseKnowledgeRuleSqlRestResponse<ExternalDependencyRestPayload>(
    response,
    '更新外部数据依赖失败，请稍后重试。',
  );
};

export const deleteKnowledgeExternalDependency = async (
  selector: ClientRuntimeScopeSelector,
  id: number,
) => {
  const response = await fetch(buildExternalDependencyItemUrl(id, selector), {
    method: 'DELETE',
  });

  return parseKnowledgeRuleSqlRestResponse<unknown>(
    response,
    '删除外部数据依赖失败，请稍后重试。',
  );
};

export const generateKnowledgeSqlPairQuestion = async (
  selector: ClientRuntimeScopeSelector,
  sql: string,
) => {
  const response = await fetch(buildSqlPairGenerateQuestionUrl(selector), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  });

  const payload = await parseKnowledgeRuleSqlRestResponse<{
    question?: string;
  }>(response, '生成问题失败，请稍后重试。');

  return payload.question || '';
};

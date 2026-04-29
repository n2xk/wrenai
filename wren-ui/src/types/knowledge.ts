export type CreateInstructionInput = {
  instruction: string;
  isDefault: boolean;
  questions: string[];
  relatedBusinessTerms?: string[];
  relatedExternalDependencies?: string[];
  runtimeUsage?: Record<string, any> | null;
};

export type CreateSqlPairInput = {
  question: string;
  sql: string;
  skipSqlValidation?: boolean;
  sqlMode?: 'wren' | 'dialect';
  assetKind?: SqlPairAssetKind;
  approvedAt?: string | null;
  approvedBy?: string | null;
  templateLevel?: SqlPairTemplateLevel;
  templateMode?: SqlPairTemplateMode;
  sourceType?: SqlPairSourceType;
  scopeType?: SqlPairScopeType;
  parameterSchema?: Record<string, any> | null;
  businessSignature?: Record<string, any> | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  templateVersion?: number;
  status?: SqlPairStatus;
};

export type Instruction = {
  __typename?: 'Instruction';
  createdAt: string;
  id: number;
  instruction: string;
  isDefault: boolean;
  questions: string[];
  relatedBusinessTerms?: string[];
  relatedExternalDependencies?: string[];
  runtimeUsage?: Record<string, any> | null;
  updatedAt: string;
};

export type BusinessTermCategory =
  | 'metric'
  | 'dimension'
  | 'segment'
  | 'formula'
  | 'event'
  | 'business_process';

export type BusinessTerm = {
  id: number;
  termId: string;
  name: string;
  category: BusinessTermCategory | string;
  aliases: string[];
  definition: string;
  canonicalExpression?: string | null;
  sourceTables: string[];
  sourceFields: string[];
  relatedRules: string[];
  relatedTemplates: string[];
  features: string[];
  conflictTerms: string[];
  status: string;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type CreateBusinessTermInput = Omit<
  BusinessTerm,
  'id' | 'createdAt' | 'updatedAt'
>;

export type ExternalDependency = {
  id: number;
  dependencyId: string;
  name: string;
  aliases: string[];
  sourceStatus: 'available' | 'missing' | 'partial' | 'manual_input' | string;
  missingBehavior:
    | 'ask_user'
    | 'block_answer'
    | 'allow_partial_answer'
    | string;
  requiredGrain: string[];
  requiredByTerms: string[];
  requiredByTemplates: string[];
  relatedRules: string[];
  askUserPrompt?: string | null;
  validation?: Record<string, any> | null;
  status: string;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type CreateExternalDependencyInput = Omit<
  ExternalDependency,
  'id' | 'createdAt' | 'updatedAt'
>;

export type SqlPair = {
  __typename?: 'SqlPair';
  assetKind?: SqlPairAssetKind | string | null;
  approvedAt?: string | null;
  approvedBy?: string | null;
  businessSignature?: Record<string, any> | null;
  createdAt?: string | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  id: number;
  parameterSchema?: Record<string, any> | null;
  question: string;
  scopeType?: SqlPairScopeType | string | null;
  sql: string;
  sourceType?: SqlPairSourceType | string | null;
  status?: SqlPairStatus | string | null;
  templateLevel?: SqlPairTemplateLevel | string | null;
  templateMode?: SqlPairTemplateMode | string | null;
  templateVersion?: number | null;
  updatedAt?: string | null;
};

export type SqlPairAssetKind = 'sql_pair' | 'sql_template';
export type SqlPairTemplateLevel = 'L0' | 'L1' | 'L2' | 'L3';
export type SqlPairTemplateMode =
  | 'reference'
  | 'trusted_reference'
  | 'anchored_template'
  | 'executable_template';
export type SqlPairSourceType =
  | 'user_saved'
  | 'admin_marked'
  | 'business_import'
  | 'system_promoted';
export type SqlPairScopeType = 'personal' | 'workspace' | 'knowledge_base';
export type SqlPairStatus = 'draft' | 'active' | 'deprecated';

export const SQL_PAIR_REFERENCE_PRESET: Pick<
  CreateSqlPairInput,
  'assetKind' | 'templateLevel' | 'templateMode' | 'sourceType' | 'scopeType'
> = {
  assetKind: 'sql_pair',
  templateLevel: 'L0',
  templateMode: 'reference',
  sourceType: 'user_saved',
  scopeType: 'knowledge_base',
};

export const SQL_PAIR_BUSINESS_TEMPLATE_PRESET: Pick<
  CreateSqlPairInput,
  'assetKind' | 'templateLevel' | 'templateMode' | 'sourceType' | 'scopeType'
> = {
  assetKind: 'sql_template',
  templateLevel: 'L2',
  templateMode: 'anchored_template',
  sourceType: 'admin_marked',
  scopeType: 'knowledge_base',
};

export const getSqlPairTemplateModeLabel = (
  sqlPair?: Pick<SqlPair, 'templateMode' | 'assetKind'> | null,
) => {
  const mode = sqlPair?.templateMode;
  if (mode === 'executable_template') {
    return '参数化模板';
  }
  if (mode === 'anchored_template' || sqlPair?.assetKind === 'sql_template') {
    return '业务口径';
  }
  if (mode === 'trusted_reference') {
    return '可信参考';
  }
  return '参考样例';
};

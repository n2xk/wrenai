export type CreateInstructionInput = {
  instruction: string;
  isDefault: boolean;
  questions: string[];
};

export type CreateSqlPairInput = {
  question: string;
  sql: string;
  skipSqlValidation?: boolean;
  assetKind?: SqlPairAssetKind;
  templateLevel?: SqlPairTemplateLevel;
  templateMode?: SqlPairTemplateMode;
  sourceType?: SqlPairSourceType;
  scopeType?: SqlPairScopeType;
  parameterSchema?: Record<string, any> | null;
  businessSignature?: Record<string, any> | null;
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
  updatedAt: string;
};

export type SqlPair = {
  __typename?: 'SqlPair';
  assetKind?: SqlPairAssetKind | string | null;
  businessSignature?: Record<string, any> | null;
  createdAt?: string | null;
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

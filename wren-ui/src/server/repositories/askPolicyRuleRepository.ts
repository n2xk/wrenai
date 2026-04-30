import { Knex } from 'knex';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';
import {
  BaseRepository,
  IBasicRepository,
  IQueryOptions,
} from './baseRepository';

export type AskPolicyRuleStatus = 'active' | 'disabled';

export interface AskPolicyRule {
  id: number;
  projectId?: number | null;
  workspaceId: string;
  knowledgeBaseId?: string | null;
  actorUserId?: string | null;
  name: string;
  status: AskPolicyRuleStatus;
  version: number;
  queryContainsAny: string[];
  templateIds: string[];
  forbiddenTemplates: string[];
  requiredSlots: string[];
  reasonCode: string;
  description?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type AskPolicyRuleCreateData = Omit<
  AskPolicyRule,
  'id' | 'createdAt' | 'updatedAt'
>;

export type AskPolicyRuleListFilter = {
  workspaceId: string;
  knowledgeBaseId?: string | null;
  knowledgeBaseIds?: string[] | null;
  includeWorkspaceRules?: boolean;
  status?: AskPolicyRuleStatus | null;
};

export interface IAskPolicyRuleRepository extends IBasicRepository<AskPolicyRule> {
  findAllForScope(
    filter: AskPolicyRuleListFilter,
    queryOptions?: IQueryOptions,
  ): Promise<AskPolicyRule[]>;
}

const JSON_ARRAY_COLUMNS = new Set([
  'queryContainsAny',
  'templateIds',
  'forbiddenTemplates',
  'requiredSlots',
]);

const snakeToCamel = (value: string) =>
  value.replace(/_([a-z])/g, (_match, char) => char.toUpperCase());

const parseJsonArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(value.map((item) => String(item || '').trim()).filter(Boolean)),
    );
  }
  if (typeof value === 'string' && value) {
    try {
      return parseJsonArray(JSON.parse(value));
    } catch (_error) {
      return [];
    }
  }
  return [];
};

export class AskPolicyRuleRepository
  extends BaseRepository<AskPolicyRule>
  implements IAskPolicyRuleRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'ask_policy_rule' });
  }

  public async findAllForScope(
    filter: AskPolicyRuleListFilter,
    queryOptions?: IQueryOptions,
  ): Promise<AskPolicyRule[]> {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const query = executer(this.tableName).where({
      workspace_id: filter.workspaceId,
    });

    if (filter.status) {
      query.andWhere('status', filter.status);
    }

    if (Array.isArray(filter.knowledgeBaseIds)) {
      const ids = filter.knowledgeBaseIds.filter(Boolean);
      query.andWhere((builder) => {
        if (filter.includeWorkspaceRules !== false) {
          builder.whereNull('knowledge_base_id');
        }
        if (ids.length > 0) {
          builder.orWhereIn('knowledge_base_id', ids);
        }
      });
    } else if (filter.knowledgeBaseId) {
      query.andWhere((builder) => {
        if (filter.includeWorkspaceRules !== false) {
          builder.whereNull('knowledge_base_id');
        }
        builder.orWhere('knowledge_base_id', filter.knowledgeBaseId);
      });
    } else if (filter.includeWorkspaceRules !== false) {
      query.whereNull('knowledge_base_id');
    }

    const rows = await query
      .orderBy('updated_at', 'desc')
      .orderBy('id', 'desc');
    return rows.map(this.transformFromDBData);
  }

  protected transformToDBData = (data: Partial<AskPolicyRule>) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const nextData = mapKeys(data, (_value, key) => snakeCase(key));
    return mapValues(nextData, (value, key) =>
      JSON_ARRAY_COLUMNS.has(snakeToCamel(String(key)))
        ? JSON.stringify(parseJsonArray(value))
        : value,
    );
  };

  protected transformFromDBData = (data: any): AskPolicyRule => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const row = mapKeys(data, (_value, key) => camelCase(key));

    return {
      ...row,
      queryContainsAny: parseJsonArray(row.queryContainsAny),
      templateIds: parseJsonArray(row.templateIds),
      forbiddenTemplates: parseJsonArray(row.forbiddenTemplates),
      requiredSlots: parseJsonArray(row.requiredSlots),
    } as AskPolicyRule;
  };
}

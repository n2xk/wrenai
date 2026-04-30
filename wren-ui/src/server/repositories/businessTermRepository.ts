import { Knex } from 'knex';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';
import { BaseRepository, IBasicRepository } from './baseRepository';

export interface BusinessTerm {
  id: number;
  projectId?: number | null;
  workspaceId?: string | null;
  knowledgeBaseId?: string | null;
  kbSnapshotId?: string | null;
  deployHash?: string | null;
  actorUserId?: string | null;
  termId: string;
  name: string;
  category: string;
  aliases: string[];
  definition: string;
  canonicalExpression?: string | null;
  sourceTables: string[];
  sourceFields: string[];
  relatedRules: string[];
  relatedTemplates: string[];
  features: string[];
  conflictTerms: string[];
  applicableScenarios: string[];
  notApplicableScenarios: string[];
  requiredSlots: string[];
  status: string;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type BusinessTermRuntimeScope = Pick<
  BusinessTerm,
  | 'projectId'
  | 'workspaceId'
  | 'knowledgeBaseId'
  | 'kbSnapshotId'
  | 'deployHash'
>;

export interface IBusinessTermRepository extends IBasicRepository<BusinessTerm> {
  findAllByRuntimeIdentity(
    runtimeIdentity: BusinessTermRuntimeScope,
  ): Promise<BusinessTerm[]>;
  findOneByIdWithRuntimeIdentity(
    id: number,
    runtimeIdentity: BusinessTermRuntimeScope,
  ): Promise<BusinessTerm | null>;
}

export class BusinessTermRepository
  extends BaseRepository<BusinessTerm>
  implements IBusinessTermRepository
{
  private readonly jsonbColumns = [
    'aliases',
    'sourceTables',
    'sourceFields',
    'relatedRules',
    'relatedTemplates',
    'features',
    'conflictTerms',
    'applicableScenarios',
    'notApplicableScenarios',
    'requiredSlots',
  ];
  private readonly canonicalScopeFields: (keyof BusinessTermRuntimeScope)[] = [
    'workspaceId',
    'knowledgeBaseId',
    'kbSnapshotId',
    'deployHash',
  ];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'knowledge_business_terms' });
  }

  public async findAllByRuntimeIdentity(
    runtimeIdentity: BusinessTermRuntimeScope,
  ): Promise<BusinessTerm[]> {
    const query = this.buildRuntimeScopedQuery(runtimeIdentity).orderBy(
      'updated_at',
      'desc',
    );
    const rows = await query;
    return rows.map((row) => this.transformFromDBData(row));
  }

  public async findOneByIdWithRuntimeIdentity(
    id: number,
    runtimeIdentity: BusinessTermRuntimeScope,
  ): Promise<BusinessTerm | null> {
    const row = await this.buildRuntimeScopedQuery(runtimeIdentity)
      .where({ id })
      .first();
    return row ? this.transformFromDBData(row) : null;
  }

  private buildRuntimeScopedQuery(scope: BusinessTermRuntimeScope) {
    const query = this.knex(this.tableName);
    const isKnowledgeBaseScopedQuery = Boolean(scope.knowledgeBaseId);

    this.applyBridgeScopeField(
      query,
      scope.projectId,
      this.hasCanonicalRuntimeScope(scope),
    );
    this.applyScopeField(query, 'workspaceId', scope.workspaceId);
    this.applyScopeField(query, 'knowledgeBaseId', scope.knowledgeBaseId);
    if (!isKnowledgeBaseScopedQuery) {
      this.applyScopeField(query, 'kbSnapshotId', scope.kbSnapshotId);
      this.applyScopeField(query, 'deployHash', scope.deployHash);
    }

    return query;
  }

  private hasCanonicalRuntimeScope(scope: BusinessTermRuntimeScope) {
    return this.canonicalScopeFields.some((field) => scope[field] != null);
  }

  private applyBridgeScopeField(
    query: Knex.QueryBuilder,
    bridgeProjectId?: number | null,
    hasCanonicalScope = false,
  ) {
    if (hasCanonicalScope) {
      return;
    }

    if (bridgeProjectId == null) {
      query.whereNull('project_id');
      return;
    }

    query.andWhere('project_id', bridgeProjectId);
  }

  private applyScopeField(
    query: Knex.QueryBuilder,
    field: Exclude<keyof BusinessTermRuntimeScope, 'projectId'>,
    value?: string | null,
  ) {
    const column = snakeCase(field);
    if (value == null) {
      query.whereNull(column);
      return;
    }

    query.andWhere(column, value);
  }

  protected override transformFromDBData = (data: any) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const camelCaseData = mapKeys(data, (_value, key) => camelCase(key));
    const transformData = mapValues(camelCaseData, (value, key) => {
      if (this.jsonbColumns.includes(key)) {
        if (typeof value === 'string') {
          return value ? JSON.parse(value) : [];
        }
        return Array.isArray(value) ? value : [];
      }
      return value;
    });
    return transformData as BusinessTerm;
  };

  protected override transformToDBData = (data: any) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const transformedData = mapValues(data, (value, key) => {
      if (this.jsonbColumns.includes(key)) {
        return JSON.stringify(Array.isArray(value) ? value : []);
      }
      return value;
    });
    return mapKeys(transformedData, (_value, key) => snakeCase(key));
  };
}

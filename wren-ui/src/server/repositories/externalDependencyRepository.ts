import { Knex } from 'knex';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';
import { BaseRepository, IBasicRepository } from './baseRepository';

export interface ExternalDependency {
  id: number;
  projectId?: number | null;
  workspaceId?: string | null;
  knowledgeBaseId?: string | null;
  kbSnapshotId?: string | null;
  deployHash?: string | null;
  actorUserId?: string | null;
  dependencyId: string;
  name: string;
  aliases: string[];
  sourceStatus: string;
  missingBehavior: string;
  requiredGrain: string[];
  requiredByTerms: string[];
  requiredByTemplates: string[];
  relatedRules: string[];
  triggerWhen: string[];
  notTriggerWhen: string[];
  lifecycle: string;
  inputModes: string[];
  askUserPrompt?: string | null;
  validation?: Record<string, any> | null;
  status: string;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type ExternalDependencyRuntimeScope = Pick<
  ExternalDependency,
  | 'projectId'
  | 'workspaceId'
  | 'knowledgeBaseId'
  | 'kbSnapshotId'
  | 'deployHash'
>;

export interface IExternalDependencyRepository extends IBasicRepository<ExternalDependency> {
  findAllByRuntimeIdentity(
    runtimeIdentity: ExternalDependencyRuntimeScope,
  ): Promise<ExternalDependency[]>;
  findOneByIdWithRuntimeIdentity(
    id: number,
    runtimeIdentity: ExternalDependencyRuntimeScope,
  ): Promise<ExternalDependency | null>;
}

export class ExternalDependencyRepository
  extends BaseRepository<ExternalDependency>
  implements IExternalDependencyRepository
{
  private readonly jsonbColumns = [
    'aliases',
    'requiredGrain',
    'requiredByTerms',
    'requiredByTemplates',
    'relatedRules',
    'triggerWhen',
    'notTriggerWhen',
    'inputModes',
    'validation',
  ];
  private readonly arrayJsonbColumns = [
    'aliases',
    'requiredGrain',
    'requiredByTerms',
    'requiredByTemplates',
    'relatedRules',
    'triggerWhen',
    'notTriggerWhen',
    'inputModes',
  ];
  private readonly canonicalScopeFields: (keyof ExternalDependencyRuntimeScope)[] =
    ['workspaceId', 'knowledgeBaseId', 'kbSnapshotId', 'deployHash'];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'knowledge_external_dependencies' });
  }

  public async findAllByRuntimeIdentity(
    runtimeIdentity: ExternalDependencyRuntimeScope,
  ): Promise<ExternalDependency[]> {
    const query = this.buildRuntimeScopedQuery(runtimeIdentity).orderBy(
      'updated_at',
      'desc',
    );
    const rows = await query;
    return rows.map((row) => this.transformFromDBData(row));
  }

  public async findOneByIdWithRuntimeIdentity(
    id: number,
    runtimeIdentity: ExternalDependencyRuntimeScope,
  ): Promise<ExternalDependency | null> {
    const row = await this.buildRuntimeScopedQuery(runtimeIdentity)
      .where({ id })
      .first();
    return row ? this.transformFromDBData(row) : null;
  }

  private buildRuntimeScopedQuery(scope: ExternalDependencyRuntimeScope) {
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

  private hasCanonicalRuntimeScope(scope: ExternalDependencyRuntimeScope) {
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
    field: Exclude<keyof ExternalDependencyRuntimeScope, 'projectId'>,
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
      if (!this.jsonbColumns.includes(key)) {
        return value;
      }
      const parsed =
        typeof value === 'string' && value ? JSON.parse(value) : value;
      if (this.arrayJsonbColumns.includes(key)) {
        return Array.isArray(parsed) ? parsed : [];
      }
      return parsed && typeof parsed === 'object' ? parsed : null;
    });
    return transformData as ExternalDependency;
  };

  protected override transformToDBData = (data: any) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const transformedData = mapValues(data, (value, key) => {
      if (!this.jsonbColumns.includes(key)) {
        return value;
      }
      if (this.arrayJsonbColumns.includes(key)) {
        return JSON.stringify(Array.isArray(value) ? value : []);
      }
      return value == null ? null : JSON.stringify(value);
    });
    return mapKeys(transformedData, (_value, key) => snakeCase(key));
  };
}

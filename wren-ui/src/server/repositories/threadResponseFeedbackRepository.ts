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

export type ThreadResponseFeedbackRating = 'positive' | 'negative';

export enum ThreadResponseFeedbackReason {
  SQL_GENERATION_FAILED = 'sql_generation_failed',
  INCORRECT_DATA_RETRIEVED = 'incorrect_data_retrieved',
  INCORRECT_AI_SUMMARY = 'incorrect_ai_summary',
  FAILED_TO_ADHERE_INSTRUCTIONS = 'failed_to_adhere_instructions',
  FAILED_TO_ADHERE_SUMMARY_INSTRUCTIONS = 'failed_to_adhere_summary_instructions',
  FAILED_TO_ADHERE_SQL_PAIRS = 'failed_to_adhere_sql_pairs',
  OTHER = 'other',
}

export const THREAD_RESPONSE_FEEDBACK_REASON_VALUES = Object.values(
  ThreadResponseFeedbackReason,
);

export type ThreadResponseFeedbackSource =
  | 'result_footer'
  | 'regression_test'
  | 'api';

export interface ThreadResponseFeedback {
  id: number;
  threadResponseId: number;
  threadId: number;
  projectId?: number | null;
  workspaceId?: string | null;
  knowledgeBaseId?: string | null;
  kbSnapshotId?: string | null;
  deployHash?: string | null;
  actorUserId?: string | null;
  rating: ThreadResponseFeedbackRating;
  reasonCodes: ThreadResponseFeedbackReason[];
  comment?: string | null;
  source: ThreadResponseFeedbackSource;
  metadata: Record<string, any>;
  createdAt?: string;
  updatedAt?: string;
}

export type ThreadResponseFeedbackUpsertData = Omit<
  ThreadResponseFeedback,
  'id' | 'createdAt' | 'updatedAt'
>;

export type ThreadResponseFeedbackListFilter = {
  projectId?: number | null;
  workspaceId?: string | null;
  workspaceIds?: string[] | null;
  knowledgeBaseId?: string | null;
  rating?: ThreadResponseFeedbackRating | null;
  reasonCode?: ThreadResponseFeedbackReason | null;
  source?: ThreadResponseFeedbackSource | null;
  keyword?: string | null;
};

export type ThreadResponseFeedbackListOptions = {
  offset?: number;
  limit?: number;
};

export type ThreadResponseFeedbackListResult = {
  items: ThreadResponseFeedback[];
  total: number;
};

export interface IThreadResponseFeedbackRepository extends IBasicRepository<ThreadResponseFeedback> {
  findOneByResponseAndActor(
    threadResponseId: number,
    actorUserId?: string | null,
    queryOptions?: IQueryOptions,
  ): Promise<ThreadResponseFeedback | null>;
  findAllForManagement(
    filter: ThreadResponseFeedbackListFilter,
    options?: ThreadResponseFeedbackListOptions,
    queryOptions?: IQueryOptions,
  ): Promise<ThreadResponseFeedbackListResult>;
  upsertForResponseActor(
    data: ThreadResponseFeedbackUpsertData,
    queryOptions?: IQueryOptions,
  ): Promise<ThreadResponseFeedback>;
  deleteByResponseAndActor(
    threadResponseId: number,
    actorUserId?: string | null,
    queryOptions?: IQueryOptions,
  ): Promise<number>;
}

const parseJsonArray = (value: unknown): ThreadResponseFeedbackReason[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is ThreadResponseFeedbackReason =>
      THREAD_RESPONSE_FEEDBACK_REASON_VALUES.includes(
        item as ThreadResponseFeedbackReason,
      ),
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

const parseJsonObject = (value: unknown): Record<string, any> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, any>;
  }

  if (typeof value === 'string' && value) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, any>)
        : {};
    } catch (_error) {
      return {};
    }
  }

  return {};
};

export class ThreadResponseFeedbackRepository
  extends BaseRepository<ThreadResponseFeedback>
  implements IThreadResponseFeedbackRepository
{
  private readonly jsonbColumns = ['reasonCodes', 'metadata'];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'thread_response_feedback' });
  }

  public async findOneByResponseAndActor(
    threadResponseId: number,
    actorUserId?: string | null,
    queryOptions?: IQueryOptions,
  ): Promise<ThreadResponseFeedback | null> {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const query = executer(this.tableName)
      .where({ thread_response_id: threadResponseId })
      .first();

    if (actorUserId) {
      query.andWhere('actor_user_id', actorUserId);
    } else {
      query.whereNull('actor_user_id');
    }

    const result = await query;
    return result ? this.transformFromDBData(result) : null;
  }

  public async findAllForManagement(
    filter: ThreadResponseFeedbackListFilter,
    options: ThreadResponseFeedbackListOptions = {},
    queryOptions?: IQueryOptions,
  ): Promise<ThreadResponseFeedbackListResult> {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const baseQuery = executer(this.tableName);
    this.applyManagementFilter(baseQuery, filter);

    const [{ count }] = await baseQuery.clone().count<{ count: string }[]>({
      count: '*',
    });
    const query = baseQuery
      .clone()
      .orderBy('updated_at', 'desc')
      .orderBy('id', 'desc');

    if (options.offset && options.offset > 0) {
      query.offset(options.offset);
    }
    if (options.limit && options.limit > 0) {
      query.limit(options.limit);
    }

    const rows = await query;
    return {
      items: rows.map(this.transformFromDBData),
      total: Number.parseInt(String(count || '0'), 10) || 0,
    };
  }

  public async upsertForResponseActor(
    data: ThreadResponseFeedbackUpsertData,
    queryOptions?: IQueryOptions,
  ): Promise<ThreadResponseFeedback> {
    const existing = await this.findOneByResponseAndActor(
      data.threadResponseId,
      data.actorUserId,
      queryOptions,
    );

    if (existing) {
      return await this.updateOne(
        existing.id,
        {
          ...data,
          updatedAt: this.knex.fn.now() as unknown as string,
        },
        queryOptions,
      );
    }

    return await this.createOne(data, queryOptions);
  }

  public async deleteByResponseAndActor(
    threadResponseId: number,
    actorUserId?: string | null,
    queryOptions?: IQueryOptions,
  ): Promise<number> {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const query = executer(this.tableName)
      .where({ thread_response_id: threadResponseId })
      .delete();

    if (actorUserId) {
      query.andWhere('actor_user_id', actorUserId);
    } else {
      query.whereNull('actor_user_id');
    }

    return await query;
  }

  private applyManagementFilter(
    query: Knex.QueryBuilder,
    filter: ThreadResponseFeedbackListFilter,
  ) {
    if (Array.isArray(filter.workspaceIds)) {
      if (filter.workspaceIds.length > 0) {
        query.whereIn('workspace_id', filter.workspaceIds);
      } else {
        query.whereRaw('1 = 0');
      }
    } else if (filter.workspaceId) {
      query.where('workspace_id', filter.workspaceId);
    } else if (filter.projectId) {
      query.where('project_id', filter.projectId);
    }

    if (filter.knowledgeBaseId) {
      query.andWhere('knowledge_base_id', filter.knowledgeBaseId);
    }
    if (filter.rating) {
      query.andWhere('rating', filter.rating);
    }
    if (filter.source) {
      query.andWhere('source', filter.source);
    }
    if (filter.reasonCode) {
      query.andWhereRaw('reason_codes @> ?::jsonb', [
        JSON.stringify([filter.reasonCode]),
      ]);
    }

    const keyword = String(filter.keyword || '').trim();
    if (keyword) {
      const keywordPattern = `%${keyword}%`;
      query.andWhere((builder) => {
        builder
          .whereILike('comment', keywordPattern)
          .orWhereILike('actor_user_id', keywordPattern)
          .orWhereRaw("metadata ->> 'question' ILIKE ?", [keywordPattern])
          .orWhereRaw("metadata ->> 'sql' ILIKE ?", [keywordPattern])
          .orWhereRaw(
            "metadata -> 'templateDecision' ->> 'templateTitle' ILIKE ?",
            [keywordPattern],
          )
          .orWhereRaw('CAST(thread_response_id AS TEXT) ILIKE ?', [
            keywordPattern,
          ])
          .orWhereRaw('CAST(thread_id AS TEXT) ILIKE ?', [keywordPattern]);
      });
    }
  }

  protected override transformToDBData = (
    data: Partial<ThreadResponseFeedback>,
  ) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }

    const transformedData = mapValues(data, (value, key) => {
      if (value !== undefined && this.jsonbColumns.includes(key)) {
        return JSON.stringify(value);
      }
      return value;
    });

    return mapKeys(transformedData, (_value, key) => snakeCase(key));
  };

  protected override transformFromDBData = (
    data: any,
  ): ThreadResponseFeedback => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }

    const camelCaseData = mapKeys(data, (_value, key) => camelCase(key));
    const transformedData = mapValues(camelCaseData, (value, key) => {
      if (key === 'reasonCodes') {
        return parseJsonArray(value);
      }
      if (key === 'metadata') {
        return parseJsonObject(value);
      }
      return value;
    });

    return transformedData as ThreadResponseFeedback;
  };
}

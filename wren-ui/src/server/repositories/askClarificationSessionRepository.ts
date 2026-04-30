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

export type AskClarificationSessionStatus =
  | 'needs_clarification'
  | 'clarification_provided'
  | 'resuming'
  | 'cancelled';

export interface AskClarificationSession {
  id: number;
  sessionId: string;
  projectId?: number | null;
  workspaceId?: string | null;
  knowledgeBaseId?: string | null;
  kbSnapshotId?: string | null;
  deployHash?: string | null;
  actorUserId?: string | null;
  threadId?: number | null;
  askingTaskId?: number | null;
  status: AskClarificationSessionStatus;
  originalQuestion?: string | null;
  pendingSlots: string[];
  resolvedSlots: Record<string, any>;
  clarificationState: Record<string, any>;
  expiresAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type AskClarificationSessionUpsertData = Omit<
  AskClarificationSession,
  'id' | 'createdAt' | 'updatedAt'
>;

export interface IAskClarificationSessionRepository extends IBasicRepository<AskClarificationSession> {
  findBySessionId(
    sessionId: string,
    queryOptions?: IQueryOptions,
  ): Promise<AskClarificationSession | null>;
  upsertBySessionId(
    data: AskClarificationSessionUpsertData,
    queryOptions?: IQueryOptions,
  ): Promise<AskClarificationSession>;
}

const parseJsonArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
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

const snakeToCamel = (value: string) =>
  value.replace(/_([a-z])/g, (_match, char) => char.toUpperCase());

export class AskClarificationSessionRepository
  extends BaseRepository<AskClarificationSession>
  implements IAskClarificationSessionRepository
{
  private readonly jsonbColumns = [
    'pendingSlots',
    'resolvedSlots',
    'clarificationState',
  ];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'ask_clarification_session' });
  }

  public async findBySessionId(
    sessionId: string,
    queryOptions?: IQueryOptions,
  ): Promise<AskClarificationSession | null> {
    return await this.findOneBy({ sessionId }, queryOptions);
  }

  public async upsertBySessionId(
    data: AskClarificationSessionUpsertData,
    queryOptions?: IQueryOptions,
  ): Promise<AskClarificationSession> {
    const existing = await this.findBySessionId(data.sessionId, queryOptions);
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

  protected transformToDBData = (data: Partial<AskClarificationSession>) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const nextData = mapKeys(data, (_value, key) => snakeCase(key));
    return mapValues(nextData, (value, key) =>
      this.jsonbColumns.includes(snakeToCamel(String(key)))
        ? JSON.stringify(value ?? {})
        : value,
    );
  };

  protected transformFromDBData = (data: any): AskClarificationSession => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const row = mapKeys(data, (_value, key) => camelCase(key));
    return {
      ...row,
      pendingSlots: parseJsonArray(row.pendingSlots),
      resolvedSlots: parseJsonObject(row.resolvedSlots),
      clarificationState: parseJsonObject(row.clarificationState),
    } as AskClarificationSession;
  };
}

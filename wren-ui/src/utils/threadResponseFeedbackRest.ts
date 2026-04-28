import {
  buildRuntimeScopeUrl,
  resolveClientRuntimeScopeSelector,
  type ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import { parseRestJsonResponse } from './rest';

export type ThreadResponseFeedbackRating = 'positive' | 'negative';

export type ThreadResponseFeedbackReason =
  | 'sql_generation_failed'
  | 'incorrect_data_retrieved'
  | 'incorrect_ai_summary'
  | 'failed_to_adhere_instructions'
  | 'failed_to_adhere_summary_instructions'
  | 'failed_to_adhere_sql_pairs'
  | 'other';

export type ThreadResponseFeedbackData = {
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
  source?: string | null;
  metadata?: Record<string, any> | null;
  workspace?: FeedbackWorkspaceOption | null;
  knowledgeBase?: FeedbackKnowledgeBaseOption | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type ThreadResponseFeedbackPayload = {
  rating: ThreadResponseFeedbackRating;
  reasonCodes?: ThreadResponseFeedbackReason[];
  comment?: string | null;
};

export type ThreadResponseFeedbackListFilter = {
  workspaceId?: string | null;
  rating?: ThreadResponseFeedbackRating | null;
  reasonCode?: ThreadResponseFeedbackReason | null;
  source?: string | null;
  knowledgeBaseId?: string | null;
  keyword?: string | null;
};

export type FeedbackWorkspaceOption = {
  id: string;
  name: string;
  slug?: string | null;
  kind?: string | null;
};

export type FeedbackKnowledgeBaseOption = {
  id: string;
  workspaceId: string;
  name: string;
  slug?: string | null;
  kind?: string | null;
};

export type ThreadResponseFeedbackListResponse = {
  items: ThreadResponseFeedbackData[];
  total: number;
  hasMore: boolean;
  workspaces: FeedbackWorkspaceOption[];
  knowledgeBases: FeedbackKnowledgeBaseOption[];
};

export const DEFAULT_THREAD_RESPONSE_FEEDBACK_LIST: ThreadResponseFeedbackListResponse =
  {
    items: [],
    total: 0,
    hasMore: false,
    workspaces: [],
    knowledgeBases: [],
  };

export const THREAD_RESPONSE_FEEDBACK_REASON_OPTIONS: Array<{
  value: ThreadResponseFeedbackReason;
  label: string;
}> = [
  {
    value: 'sql_generation_failed',
    label: 'SQL 生成失败',
  },
  {
    value: 'incorrect_data_retrieved',
    label: '查询数据不正确',
  },
  {
    value: 'incorrect_ai_summary',
    label: 'AI 总结不正确',
  },
  {
    value: 'failed_to_adhere_instructions',
    label: '没有遵循分析规则',
  },
  {
    value: 'failed_to_adhere_summary_instructions',
    label: '没有遵循总结指令',
  },
  {
    value: 'failed_to_adhere_sql_pairs',
    label: '没有遵循 SQL 模板',
  },
  {
    value: 'other',
    label: '其他',
  },
];

export const THREAD_RESPONSE_FEEDBACK_RATING_OPTIONS: Array<{
  value: ThreadResponseFeedbackRating;
  label: string;
}> = [
  { value: 'positive', label: '有帮助' },
  { value: 'negative', label: '没帮助' },
];

export const THREAD_RESPONSE_FEEDBACK_SOURCE_OPTIONS = [
  { value: 'result_footer', label: '结果页反馈' },
  { value: 'regression_test', label: '回归测试' },
  { value: 'api', label: 'API' },
] as const;

export const buildThreadResponseFeedbackUrl = (
  responseId: number,
  selector = resolveClientRuntimeScopeSelector(),
) =>
  buildRuntimeScopeUrl(
    `/api/v1/thread-responses/${responseId}/feedback`,
    {},
    selector,
  );

export const buildThreadResponseFeedbackListUrl = ({
  offset = 0,
  limit = 50,
  filter,
}: {
  selector?: ClientRuntimeScopeSelector;
  offset?: number;
  limit?: number;
  filter?: ThreadResponseFeedbackListFilter;
}) =>
  (() => {
    const params = new URLSearchParams();
    params.set('offset', `${offset}`);
    params.set('limit', `${limit}`);
    if (filter?.workspaceId) {
      params.set('workspaceId', filter.workspaceId);
    }
    if (filter?.rating) {
      params.set('rating', filter.rating);
    }
    if (filter?.reasonCode) {
      params.set('reasonCode', filter.reasonCode);
    }
    if (filter?.source) {
      params.set('source', filter.source);
    }
    if (filter?.knowledgeBaseId) {
      params.set('knowledgeBaseId', filter.knowledgeBaseId);
    }
    if (filter?.keyword) {
      params.set('keyword', filter.keyword);
    }

    return `/api/v1/thread-response-feedback?${params.toString()}`;
  })();

export const getThreadResponseFeedback = async ({
  responseId,
  selector,
  fetcher = fetch,
}: {
  responseId: number;
  selector?: ClientRuntimeScopeSelector;
  fetcher?: typeof fetch;
}) => {
  const response = await fetcher(
    buildThreadResponseFeedbackUrl(responseId, selector),
    { cache: 'no-store' },
  );
  return parseRestJsonResponse<{ feedback: ThreadResponseFeedbackData | null }>(
    response,
    '加载问数结果反馈失败，请稍后重试。',
  );
};

export const listThreadResponseFeedback = async ({
  selector,
  offset = 0,
  limit = 50,
  filter,
  fetcher = fetch,
}: {
  selector?: ClientRuntimeScopeSelector;
  offset?: number;
  limit?: number;
  filter?: ThreadResponseFeedbackListFilter;
  fetcher?: typeof fetch;
}) => {
  const response = await fetcher(
    buildThreadResponseFeedbackListUrl({
      selector,
      offset,
      limit,
      filter,
    }),
    { cache: 'no-store' },
  );
  return parseRestJsonResponse<ThreadResponseFeedbackListResponse>(
    response,
    '加载问数反馈失败，请稍后重试。',
  );
};

export const upsertThreadResponseFeedback = async ({
  responseId,
  selector,
  payload,
  fetcher = fetch,
}: {
  responseId: number;
  selector?: ClientRuntimeScopeSelector;
  payload: ThreadResponseFeedbackPayload;
  fetcher?: typeof fetch;
}) => {
  const response = await fetcher(
    buildThreadResponseFeedbackUrl(responseId, selector),
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  return parseRestJsonResponse<{ feedback: ThreadResponseFeedbackData }>(
    response,
    '保存问数结果反馈失败，请稍后重试。',
  );
};

export const deleteThreadResponseFeedback = async ({
  responseId,
  selector,
  fetcher = fetch,
}: {
  responseId: number;
  selector?: ClientRuntimeScopeSelector;
  fetcher?: typeof fetch;
}) => {
  const response = await fetcher(
    buildThreadResponseFeedbackUrl(responseId, selector),
    { method: 'DELETE' },
  );
  return parseRestJsonResponse<{ success: boolean }>(
    response,
    '撤销问数结果反馈失败，请稍后重试。',
  );
};

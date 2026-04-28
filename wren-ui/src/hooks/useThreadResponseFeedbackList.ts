import { useMemo } from 'react';
import { type ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import useRestRequest from './useRestRequest';
import {
  buildThreadResponseFeedbackListUrl,
  DEFAULT_THREAD_RESPONSE_FEEDBACK_LIST,
  type ThreadResponseFeedbackListFilter,
  type ThreadResponseFeedbackListResponse,
} from '@/utils/threadResponseFeedbackRest';

export default function useThreadResponseFeedbackList({
  enabled,
  selector,
  offset,
  limit,
  filter,
  onError,
}: {
  enabled: boolean;
  selector?: ClientRuntimeScopeSelector;
  offset: number;
  limit: number;
  filter?: ThreadResponseFeedbackListFilter;
  onError?: (error: Error) => void;
}) {
  const requestUrl = useMemo(
    () =>
      enabled
        ? buildThreadResponseFeedbackListUrl({
            selector,
            offset,
            limit,
            filter,
          })
        : null,
    [
      enabled,
      filter?.keyword,
      filter?.knowledgeBaseId,
      filter?.rating,
      filter?.reasonCode,
      filter?.source,
      filter?.workspaceId,
      limit,
      offset,
      selector?.deployHash,
      selector?.kbSnapshotId,
      selector?.knowledgeBaseId,
      selector?.runtimeScopeId,
      selector?.workspaceId,
    ],
  );

  const { data, loading, refetch, error } =
    useRestRequest<ThreadResponseFeedbackListResponse>({
      enabled: Boolean(requestUrl),
      initialData: DEFAULT_THREAD_RESPONSE_FEEDBACK_LIST,
      requestKey: requestUrl,
      request: async ({ signal }) => {
        const response = await fetch(requestUrl!, {
          credentials: 'include',
          signal,
          cache: 'no-store',
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error || '加载问数反馈失败，请稍后重试。');
        }

        return {
          items: Array.isArray(payload?.items) ? payload.items : [],
          total: typeof payload?.total === 'number' ? payload.total : 0,
          hasMore: Boolean(payload?.hasMore),
          workspaces: Array.isArray(payload?.workspaces)
            ? payload.workspaces
            : [],
          knowledgeBases: Array.isArray(payload?.knowledgeBases)
            ? payload.knowledgeBases
            : [],
        };
      },
      onError,
    });

  return {
    data,
    loading,
    refetch,
    error,
  };
}

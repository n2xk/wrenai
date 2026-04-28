import { ApiType } from '@/types/apiHistory';
import type { ApiHistoryListItem } from '@/hooks/useApiHistoryList';

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const firstNonEmptyString = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (isNonEmptyString(value)) {
      return value;
    }
  }

  return null;
};

const stringifyIdentifier = (value: unknown): string | null => {
  if (isNonEmptyString(value)) {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
};

export const resolveApiHistoryQueryPreview = (
  record: Pick<
    ApiHistoryListItem,
    'apiType' | 'requestPayload' | 'responsePayload'
  >,
): string | null => {
  const requestPayload = record.requestPayload || {};
  const responsePayload = record.responsePayload || {};
  const nestedRequestData =
    requestPayload.data &&
    typeof requestPayload.data === 'object' &&
    !Array.isArray(requestPayload.data)
      ? requestPayload.data
      : {};

  if (record.apiType === ApiType.RUN_SQL) {
    return firstNonEmptyString(
      requestPayload.sql,
      nestedRequestData.sql,
      responsePayload.sql,
    );
  }

  return firstNonEmptyString(
    requestPayload.question,
    nestedRequestData.question,
    responsePayload.question,
    responsePayload.askingTask?.question,
    requestPayload.sql,
    nestedRequestData.sql,
    responsePayload.sql,
    responsePayload.askingTask?.candidates?.[0]?.sql,
  );
};

export const resolveApiHistoryThreadId = (
  record: Pick<
    ApiHistoryListItem,
    'apiType' | 'threadId' | 'requestPayload' | 'responsePayload'
  >,
): string | null => {
  const requestPayload = record.requestPayload || {};
  const responsePayload = record.responsePayload || {};

  return (
    stringifyIdentifier(record.threadId) ||
    stringifyIdentifier(responsePayload.threadId) ||
    stringifyIdentifier(requestPayload.threadId) ||
    (record.apiType === ApiType.ASK || record.apiType === ApiType.GET_THREADS
      ? stringifyIdentifier(requestPayload.id) ||
        stringifyIdentifier(responsePayload.id)
      : null)
  );
};

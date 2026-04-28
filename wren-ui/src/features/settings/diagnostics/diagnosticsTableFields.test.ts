import { ApiType } from '@/types/apiHistory';
import {
  resolveApiHistoryQueryPreview,
  resolveApiHistoryThreadId,
} from './diagnosticsTableFields';

describe('diagnosticsTableFields', () => {
  describe('resolveApiHistoryQueryPreview', () => {
    it('keeps direct request question as the first choice', () => {
      expect(
        resolveApiHistoryQueryPreview({
          apiType: ApiType.ASK,
          requestPayload: {
            question: '直接问题',
          },
          responsePayload: {
            question: '响应问题',
          },
        }),
      ).toBe('直接问题');
    });

    it('falls back to nested request data and serialized thread response fields', () => {
      expect(
        resolveApiHistoryQueryPreview({
          apiType: ApiType.ASK,
          requestPayload: {
            data: {
              question: '追问问题',
            },
          },
          responsePayload: null,
        }),
      ).toBe('追问问题');

      expect(
        resolveApiHistoryQueryPreview({
          apiType: ApiType.ASK,
          requestPayload: {
            id: 117,
            data: null,
            action: 'generate-answer',
          },
          responsePayload: {
            question: '序列化响应问题',
            sql: 'select 1',
          },
        }),
      ).toBe('序列化响应问题');
    });

    it('falls back to SQL for run-sql and response-only ask records', () => {
      expect(
        resolveApiHistoryQueryPreview({
          apiType: ApiType.RUN_SQL,
          requestPayload: {
            sql: 'select * from orders',
          },
          responsePayload: {
            sql: 'select * from fallback',
          },
        }),
      ).toBe('select * from orders');

      expect(
        resolveApiHistoryQueryPreview({
          apiType: ApiType.ASK,
          requestPayload: {},
          responsePayload: {
            sql: 'select 2',
          },
        }),
      ).toBe('select 2');
    });
  });

  describe('resolveApiHistoryThreadId', () => {
    it('keeps top-level thread id as the first choice', () => {
      expect(
        resolveApiHistoryThreadId({
          apiType: ApiType.ASK,
          threadId: 'thread-1',
          requestPayload: {
            threadId: 'thread-request',
          },
          responsePayload: {
            threadId: 7,
          },
        }),
      ).toBe('thread-1');
    });

    it('falls back to serialized response and request identifiers', () => {
      expect(
        resolveApiHistoryThreadId({
          apiType: ApiType.ASK,
          requestPayload: {},
          responsePayload: {
            threadId: 102,
          },
        }),
      ).toBe('102');

      expect(
        resolveApiHistoryThreadId({
          apiType: ApiType.ASK,
          requestPayload: {
            id: 117,
          },
          responsePayload: {},
        }),
      ).toBe('117');

      expect(
        resolveApiHistoryThreadId({
          apiType: ApiType.ASK,
          requestPayload: {
            question: '新建线程问题',
          },
          responsePayload: {
            id: 118,
          },
        }),
      ).toBe('118');
    });
  });
});

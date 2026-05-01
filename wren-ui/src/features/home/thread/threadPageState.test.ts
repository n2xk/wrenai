import {
  AskingTaskStatus,
  AskingTaskType,
  ThreadResponseAnswerStatus,
  ThreadResponseKind,
} from '@/types/home';
import { getThreadResponseIsFinished } from './threadPageState';

describe('threadPageState getThreadResponseIsFinished', () => {
  it('keeps text-to-sql answer responses pollable after SQL arrives but before answer generation finishes', () => {
    expect(
      getThreadResponseIsFinished({
        id: 10,
        threadId: 1,
        question: '统计收入',
        responseKind: ThreadResponseKind.ANSWER,
        sql: 'select 1',
        askingTask: {
          candidates: [],
          status: AskingTaskStatus.FINISHED,
          type: AskingTaskType.TEXT_TO_SQL,
        },
        answerDetail: null,
        breakdownDetail: null,
        chartDetail: null,
      } as any),
    ).toBe(false);
  });

  it('settles text-to-sql answer responses after the text answer is finalized', () => {
    expect(
      getThreadResponseIsFinished({
        id: 10,
        threadId: 1,
        question: '统计收入',
        responseKind: ThreadResponseKind.ANSWER,
        sql: 'select 1',
        askingTask: {
          candidates: [],
          status: AskingTaskStatus.FINISHED,
          type: AskingTaskType.TEXT_TO_SQL,
        },
        answerDetail: {
          status: ThreadResponseAnswerStatus.FINISHED,
          content: '结果如下',
        },
        breakdownDetail: null,
        chartDetail: null,
      } as any),
    ).toBe(true);
  });

  it('still treats plain sql-only responses without an ask task as finished', () => {
    expect(
      getThreadResponseIsFinished({
        id: 11,
        threadId: 1,
        question: '手写 SQL',
        responseKind: ThreadResponseKind.ANSWER,
        sql: 'select 1',
        askingTask: null,
        answerDetail: null,
        breakdownDetail: null,
        chartDetail: null,
      } as any),
    ).toBe(true);
  });
});

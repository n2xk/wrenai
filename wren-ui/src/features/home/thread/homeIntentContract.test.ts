import {
  hydrateThreadResponseHomeIntent,
  hydrateThreadResponsesHomeIntent,
  resolveDefaultArtifactPlanForIntent,
  resolveDefaultConversationAidPlanForIntent,
  resolveRecommendedQuestionsHomeIntent,
  resolveResponseArtifactLineage,
  resolveResponseArtifactPlan,
  resolveResponseHomeIntent,
} from './homeIntentContract';

describe('homeIntentContract', () => {
  it('builds chart follow-up artifact plan with inherited preview/sql tabs', () => {
    const response = {
      id: 18,
      threadId: 3,
      responseKind: 'CHART_FOLLOWUP',
      sourceResponseId: 8,
      sql: 'select * from employees',
      chartDetail: {
        status: 'FINISHED',
        chartSchema: { mark: 'bar' },
      },
    };

    expect(resolveResponseArtifactPlan(response)).toEqual({
      teaserArtifacts: ['chart_teaser'],
      workbenchArtifacts: ['chart', 'preview', 'sql'],
      primaryTeaser: 'chart_teaser',
      primaryWorkbenchArtifact: 'chart',
    });
    expect(resolveResponseArtifactLineage(response)).toEqual({
      sourceResponseId: 8,
      inheritedWorkbenchArtifacts: ['preview', 'sql'],
    });
    expect(resolveResponseHomeIntent(response)).toMatchObject({
      kind: 'CHART',
      mode: 'FOLLOW_UP',
      target: 'THREAD_RESPONSE',
      sourceThreadId: 3,
      sourceResponseId: 8,
      conversationAidPlan: {
        responseAids: [
          { kind: 'TRIGGER_CHART_REFINE', sourceResponseId: 18 },
          { kind: 'TRIGGER_CHART_REFINE', sourceResponseId: 18 },
          { kind: 'TRIGGER_CHART_REFINE', sourceResponseId: 18 },
          {
            kind: 'TRIGGER_RECOMMEND_QUESTIONS',
            sourceResponseId: 18,
            suggestedIntent: 'RECOMMEND_QUESTIONS',
          },
        ],
      },
    });
  });

  it('treats finished number-card responses as chart artifacts', () => {
    const response = {
      id: 19,
      threadId: 3,
      responseKind: 'CHART_FOLLOWUP',
      sourceResponseId: 8,
      sql: 'select 5 as bet_user_count',
      chartDetail: {
        status: 'FINISHED',
        chartType: 'NUMBER',
        chartability: {
          recommendedDisplay: 'NUMBER_CARD',
        },
        renderHints: {
          displayType: 'number_card',
        },
      },
    };

    expect(resolveResponseArtifactPlan(response)).toMatchObject({
      teaserArtifacts: ['chart_teaser'],
      workbenchArtifacts: ['chart', 'preview', 'sql'],
      primaryWorkbenchArtifact: 'chart',
    });
  });

  it('maps general ask results to general-help intent without workbench artifacts', () => {
    const response = {
      threadId: 4,
      askingTask: {
        type: 'GENERAL',
      },
      answerDetail: {
        status: 'FINISHED',
      },
    };

    expect(resolveResponseArtifactPlan(response)).toEqual({
      teaserArtifacts: [],
      workbenchArtifacts: [],
      primaryTeaser: null,
      primaryWorkbenchArtifact: null,
    });
    expect(resolveResponseHomeIntent(response)).toMatchObject({
      kind: 'GENERAL_HELP',
      mode: 'NEW',
      source: 'classifier',
      conversationAidPlan: null,
    });
  });

  it('repairs stale persisted intent metadata when a response has SQL', () => {
    const response: any = {
      id: 31,
      threadId: 8,
      question: '查询充值金额',
      sql: 'select sum(amount) from deposits',
      resolvedIntent: {
        kind: 'GENERAL_HELP',
        mode: 'NEW',
        target: 'THREAD_RESPONSE',
        source: 'derived',
        sourceThreadId: 8,
        sourceResponseId: null,
        confidence: null,
        artifactPlan: {
          teaserArtifacts: [],
          workbenchArtifacts: [],
          primaryTeaser: null,
          primaryWorkbenchArtifact: null,
        },
        conversationAidPlan: null,
      },
    };

    expect(resolveResponseArtifactPlan(response)).toEqual({
      teaserArtifacts: ['preview_teaser'],
      workbenchArtifacts: ['preview', 'sql'],
      primaryTeaser: 'preview_teaser',
      primaryWorkbenchArtifact: 'preview',
    });
    expect(resolveResponseHomeIntent(response)).toMatchObject({
      kind: 'ASK',
      artifactPlan: {
        workbenchArtifacts: ['preview', 'sql'],
        primaryWorkbenchArtifact: 'preview',
      },
      conversationAidPlan: {
        responseAids: [
          { kind: 'TRIGGER_CHART_FOLLOWUP', sourceResponseId: 31 },
          { kind: 'TRIGGER_RECOMMEND_QUESTIONS', sourceResponseId: 31 },
        ],
      },
    });
  });

  it('exposes canonical default artifact plans and aids for composer/runtime handoff', () => {
    expect(resolveDefaultArtifactPlanForIntent('ASK')).toEqual({
      teaserArtifacts: ['preview_teaser'],
      workbenchArtifacts: ['preview', 'sql'],
      primaryTeaser: 'preview_teaser',
      primaryWorkbenchArtifact: 'preview',
    });

    expect(resolveDefaultArtifactPlanForIntent('CHART')).toEqual({
      teaserArtifacts: ['chart_teaser'],
      workbenchArtifacts: ['chart', 'preview', 'sql'],
      primaryTeaser: 'chart_teaser',
      primaryWorkbenchArtifact: 'chart',
    });

    expect(
      resolveDefaultConversationAidPlanForIntent('ASK', {
        id: 11,
        sql: 'select * from orders',
      }),
    ).toMatchObject({
      responseAids: [
        {
          kind: 'TRIGGER_CHART_FOLLOWUP',
          sourceResponseId: 11,
          suggestedIntent: 'CHART',
        },
        {
          kind: 'TRIGGER_RECOMMEND_QUESTIONS',
          sourceResponseId: 11,
          suggestedIntent: 'RECOMMEND_QUESTIONS',
        },
      ],
    });
  });

  it('does not offer chart follow-up when the answer result is known to be empty', () => {
    const intent = resolveResponseHomeIntent({
      id: 41,
      threadId: 9,
      sql: 'select * from orders where 1 = 0',
      askingTask: { type: 'TEXT_TO_SQL' },
      answerDetail: {
        status: 'FINISHED',
        numRowsUsedInLLM: 0,
      },
    });

    expect(intent?.conversationAidPlan?.responseAids).toEqual([
      expect.objectContaining({
        kind: 'TRIGGER_RECOMMEND_QUESTIONS',
        sourceResponseId: 41,
      }),
    ]);
  });

  it('does not offer chart follow-up when SQL generation failed', () => {
    const intent = resolveResponseHomeIntent({
      id: 43,
      threadId: 9,
      sql: null,
      askingTask: { type: 'TEXT_TO_SQL' },
      answerDetail: {
        status: 'FAILED',
        error: {
          code: 'TEXT_TO_SQL_SQL_MISSING',
          message: 'SQL 生成失败，未能生成可执行查询。',
        },
      },
    });

    expect(intent?.conversationAidPlan?.responseAids).toEqual([
      expect.objectContaining({
        kind: 'TRIGGER_RECOMMEND_QUESTIONS',
        sourceResponseId: 43,
      }),
    ]);
  });

  it('does not offer chart refine aids for chartability-blocked chart results', () => {
    const intent = resolveResponseHomeIntent({
      id: 42,
      threadId: 9,
      responseKind: 'CHART_FOLLOWUP',
      sourceResponseId: 41,
      sql: 'select * from orders where 1 = 0',
      chartDetail: {
        status: 'FAILED',
        chartability: {
          chartable: false,
          reasonCode: 'EMPTY_RESULT_SET',
          recommendedDisplay: null,
        },
      },
    });

    expect(intent?.conversationAidPlan?.responseAids).toEqual([
      expect.objectContaining({
        kind: 'TRIGGER_RECOMMEND_QUESTIONS',
        sourceResponseId: 42,
      }),
    ]);
  });

  it('hydrates unresolved responses with resolvedIntent and lineage', () => {
    const response = {
      id: 21,
      threadId: 6,
      question: '生成图表',
      responseKind: 'CHART_FOLLOWUP',
      sourceResponseId: 9,
      sql: 'select * from salaries',
      chartDetail: {
        status: 'FINISHED',
        chartSchema: { mark: 'line' },
      },
    };

    expect(hydrateThreadResponseHomeIntent(response)).toMatchObject({
      id: 21,
      resolvedIntent: {
        kind: 'CHART',
        mode: 'FOLLOW_UP',
        sourceThreadId: 6,
        sourceResponseId: 9,
        artifactPlan: {
          primaryWorkbenchArtifact: 'chart',
        },
      },
      artifactLineage: {
        sourceResponseId: 9,
        inheritedWorkbenchArtifacts: ['preview', 'sql'],
      },
    });
  });

  it('hydrates response collections without mutating resolved entries', () => {
    const hydratedResponses = hydrateThreadResponsesHomeIntent([
      {
        id: 11,
        threadId: 3,
        question: '平均薪资',
        sql: 'select * from salaries',
      },
      {
        id: 12,
        threadId: 3,
        question: '生成图表',
        responseKind: 'CHART_FOLLOWUP',
        sourceResponseId: 11,
        resolvedIntent: {
          kind: 'CHART',
          mode: 'FOLLOW_UP',
          target: 'THREAD_RESPONSE',
          source: 'derived',
          sourceThreadId: 3,
          sourceResponseId: 11,
          artifactPlan: {
            teaserArtifacts: ['chart_teaser'],
            workbenchArtifacts: ['chart', 'preview', 'sql'],
            primaryTeaser: 'chart_teaser',
            primaryWorkbenchArtifact: 'chart',
          },
          conversationAidPlan: null,
        },
        artifactLineage: {
          sourceResponseId: 11,
          inheritedWorkbenchArtifacts: ['preview', 'sql'],
        },
      },
    ]);

    expect(hydratedResponses[0].resolvedIntent).toMatchObject({
      kind: 'ASK',
      artifactPlan: {
        primaryWorkbenchArtifact: 'preview',
        teaserArtifacts: ['preview_teaser'],
      },
      conversationAidPlan: {
        responseAids: [
          { kind: 'TRIGGER_CHART_FOLLOWUP', sourceResponseId: 11 },
          { kind: 'TRIGGER_RECOMMEND_QUESTIONS', sourceResponseId: 11 },
        ],
      },
    });
    expect(hydratedResponses[1].resolvedIntent).toMatchObject({
      kind: 'CHART',
      sourceResponseId: 11,
    });
  });

  it('builds canonical intent metadata for recommendation follow-up responses', () => {
    expect(
      resolveRecommendedQuestionsHomeIntent({
        sourceThreadId: 3,
        sourceResponseId: 11,
      }),
    ).toEqual({
      kind: 'RECOMMEND_QUESTIONS',
      mode: 'FOLLOW_UP',
      target: 'THREAD_RESPONSE',
      source: 'derived',
      sourceThreadId: 3,
      sourceResponseId: 11,
      confidence: null,
      artifactPlan: {
        teaserArtifacts: [],
        workbenchArtifacts: [],
        primaryTeaser: null,
        primaryWorkbenchArtifact: null,
      },
      conversationAidPlan: null,
    });
  });
});

import {
  hasResponsePreviewArtifact,
  hasResponseSqlArtifact,
  resolvePrimaryWorkbenchArtifact,
  resolveWorkbenchArtifactOwnerResponse,
} from './threadWorkbenchState';

describe('threadWorkbenchState', () => {
  it('surfaces preview and SQL tabs for SQL responses with stale empty intent artifacts', () => {
    const response = {
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
    } as any;

    expect(hasResponsePreviewArtifact(response)).toBe(true);
    expect(hasResponseSqlArtifact(response)).toBe(true);
    expect(resolvePrimaryWorkbenchArtifact(response)).toBe('preview');
  });

  it('keeps chart follow-up chart artifact on the chart response itself', () => {
    const sourceResponse = {
      id: 11,
      threadId: 3,
      question: '各部门平均薪资是多少？',
      sql: 'select * from salaries',
      resolvedIntent: {
        kind: 'ASK',
        mode: 'NEW',
        target: 'THREAD_RESPONSE',
        source: 'classifier',
        artifactPlan: {
          teaserArtifacts: ['preview_teaser'],
          workbenchArtifacts: ['preview', 'sql'],
          primaryTeaser: 'preview_teaser',
          primaryWorkbenchArtifact: 'preview',
        },
      },
    } as any;
    const chartResponse = {
      id: 12,
      threadId: 3,
      question: '生成一张图表给我',
      responseKind: 'CHART_FOLLOWUP',
      sourceResponseId: 11,
      artifactLineage: {
        sourceResponseId: 11,
        inheritedWorkbenchArtifacts: ['preview', 'sql'],
      },
      resolvedIntent: {
        kind: 'CHART',
        mode: 'FOLLOW_UP',
        target: 'THREAD_RESPONSE',
        source: 'derived',
        sourceResponseId: 11,
        artifactPlan: {
          teaserArtifacts: ['chart_teaser'],
          workbenchArtifacts: ['chart', 'preview', 'sql'],
          primaryTeaser: 'chart_teaser',
          primaryWorkbenchArtifact: 'chart',
        },
      },
    } as any;

    expect(resolvePrimaryWorkbenchArtifact(chartResponse)).toBe('chart');
    expect(
      resolveWorkbenchArtifactOwnerResponse({
        artifact: 'chart',
        responses: [sourceResponse, chartResponse],
        selectedResponse: chartResponse,
      }),
    ).toBe(chartResponse);
  });

  it('routes inherited preview/sql artifacts back to the source response', () => {
    const sourceResponse = {
      id: 11,
      threadId: 3,
      question: '各部门平均薪资是多少？',
      sql: 'select * from salaries',
      resolvedIntent: {
        kind: 'ASK',
        mode: 'NEW',
        target: 'THREAD_RESPONSE',
        source: 'classifier',
        artifactPlan: {
          teaserArtifacts: ['preview_teaser'],
          workbenchArtifacts: ['preview', 'sql'],
          primaryTeaser: 'preview_teaser',
          primaryWorkbenchArtifact: 'preview',
        },
      },
    } as any;
    const chartResponse = {
      id: 12,
      threadId: 3,
      question: '生成一张图表给我',
      responseKind: 'CHART_FOLLOWUP',
      sourceResponseId: 11,
      artifactLineage: {
        sourceResponseId: 11,
        inheritedWorkbenchArtifacts: ['preview', 'sql'],
      },
      resolvedIntent: {
        kind: 'CHART',
        mode: 'FOLLOW_UP',
        target: 'THREAD_RESPONSE',
        source: 'derived',
        sourceResponseId: 11,
        artifactPlan: {
          teaserArtifacts: ['chart_teaser'],
          workbenchArtifacts: ['chart', 'preview', 'sql'],
          primaryTeaser: 'chart_teaser',
          primaryWorkbenchArtifact: 'chart',
        },
      },
    } as any;

    expect(
      resolveWorkbenchArtifactOwnerResponse({
        artifact: 'preview',
        responses: [sourceResponse, chartResponse],
        selectedResponse: chartResponse,
      }),
    ).toBe(sourceResponse);

    expect(
      resolveWorkbenchArtifactOwnerResponse({
        artifact: 'sql',
        responses: [sourceResponse, chartResponse],
        selectedResponse: chartResponse,
      }),
    ).toBe(sourceResponse);
  });
});

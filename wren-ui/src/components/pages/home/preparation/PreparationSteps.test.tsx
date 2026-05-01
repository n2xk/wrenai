import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PreparationSteps from './PreparationSteps';
import type { PreparationTimelineModel } from './preparationTimelineModel';

jest.mock('@/components/editor/MarkdownBlock', () => ({
  __esModule: true,
  default: ({ content }: { content: string }) => <div>{content}</div>,
}));

describe('PreparationSteps', () => {
  it('keeps long step detail collapsed by default', () => {
    const preparationModel: PreparationTimelineModel = {
      kind: 'ask',
      lifecycle: 'finished',
      preparedTask: {} as any,
      steps: [
        {
          description: '生成 SQL 前的简短说明',
          detailMarkdown: '这是一段很长的分析思路详情',
          key: 'reasoning',
          status: 'finished',
          title: '已组织分析思路',
        },
      ],
      title: '思考步骤',
      totalSteps: 1,
    };

    const markup = renderToStaticMarkup(
      <PreparationSteps data={{} as any} preparationModel={preparationModel} />,
    );

    expect(markup).toContain('已组织分析思路');
    expect(markup).toContain('生成 SQL 前的简短说明');
    expect(markup).toContain('详情');
    expect(markup).toContain('查看详情：已组织分析思路');
    expect(markup).not.toContain('这是一段很长的分析思路详情');
    expect(markup).not.toContain('收起：已组织分析思路');
  });

  it('collapses verbose descriptions and model tags by default', () => {
    const preparationModel: PreparationTimelineModel = {
      kind: 'ask',
      lifecycle: 'finished',
      preparedTask: {} as any,
      steps: [
        {
          description:
            '模板：统计租户平台990001下渠道990011在2026-04-01到2026-04-07按游戏类型分布的投注次数、有效投注、均次投注、输赢、杀率和投注占比。',
          key: 'ask.template_decision',
          status: 'finished',
          title: '已采用可信 SQL 参考',
        },
        {
          description: '优先使用最相关的数据模型回答当前问题',
          key: 'ask.candidate_models_selected',
          status: 'finished',
          tags: ['tidb_business_demo_dwd_bet_order'],
          title: '已匹配 1 个候选数据模型',
        },
      ],
      title: '思考步骤',
      totalSteps: 2,
    };

    const markup = renderToStaticMarkup(
      <PreparationSteps data={{} as any} preparationModel={preparationModel} />,
    );

    expect(markup).toContain('已采用可信 SQL 参考');
    expect(markup).toContain('已匹配 1 个候选数据模型');
    expect(markup).toContain('优先使用最相关的数据模型回答当前问题');
    expect(markup).toContain('详情');
    expect(markup).not.toContain('投注次数、有效投注');
    expect(markup).not.toContain('tidb_business_demo_dwd_bet_order');
  });
});

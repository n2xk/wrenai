import { buildModelingAssistantTaskSummaries } from './modelingAssistantStatus';

describe('buildModelingAssistantTaskSummaries', () => {
  it('marks semantics todo and relationships done when descriptions are missing but relations exist', () => {
    const summaries = buildModelingAssistantTaskSummaries({
      models: [
        {
          description: '',
          fields: [
            {
              description: 'Primary key',
            },
          ],
          relationFields: [{ relationId: 1 }],
        },
      ] as any,
      views: [],
    });

    expect(summaries).toEqual([
      {
        key: 'semantics',
        state: 'todo',
        countLabel: '1',
        detailLabel: '还有 1 项缺少描述',
      },
      {
        key: 'relationships',
        state: 'done',
        countLabel: '1',
        detailLabel: '模型中已有 1 条关联关系',
      },
    ]);
  });

  it('marks both tasks done when metadata is complete and relations exist', () => {
    const summaries = buildModelingAssistantTaskSummaries({
      models: [
        {
          description: 'Model description',
          fields: [
            {
              description: 'Field description',
            },
          ],
          relationFields: [{ relationId: 1 }],
        },
      ] as any,
      views: [
        {
          description: 'View description',
          fields: [{ description: 'View field description' }],
        },
      ] as any,
    });

    expect(summaries).toEqual([
      {
        key: 'semantics',
        state: 'done',
        countLabel: '1',
        detailLabel: '描述已补充完成',
      },
      {
        key: 'relationships',
        state: 'done',
        countLabel: '1',
        detailLabel: '模型中已有 1 条关联关系',
      },
    ]);
  });
});

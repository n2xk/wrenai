import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ResponseSpreadsheetSaveButton from './ResponseSpreadsheetSaveButton';

jest.mock('@/hooks/useRuntimeScopeNavigation', () => ({
  __esModule: true,
  default: () => ({
    selector: { workspaceId: 'ws-1', knowledgeBaseId: 'kb-1' },
    workspaceSelector: { workspaceId: 'ws-1' },
    push: jest.fn(),
  }),
}));

describe('ResponseSpreadsheetSaveButton', () => {
  const response = {
    id: 10,
    sql: 'select 1',
    workspaceId: 'ws-1',
    knowledgeBaseId: 'kb-1',
  } as any;

  it('disables saving with a clear reason when there are no result rows', () => {
    const markup = renderToStaticMarkup(
      <ResponseSpreadsheetSaveButton
        disabled
        disabledReason="当前查询没有返回数据，暂不能保存为数据表。"
        response={response}
      />,
    );

    expect(markup).toContain('保存为数据表');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>.*保存为数据表/s);
  });
});

import {
  buildSpreadsheetListUrl,
  clearSpreadsheetRestCache,
  createSpreadsheet,
  peekSpreadsheetListPayload,
  primeSpreadsheetListPayload,
} from './spreadsheetRest';

describe('spreadsheetRest cache', () => {
  const originalFetch = (global as any).fetch;

  beforeEach(() => {
    clearSpreadsheetRestCache();
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 9,
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        name: '新数据表',
        sql: 'select 1',
        currentVersion: 1,
        setting: null,
        history: [],
      }),
    } as Response);
  });

  afterEach(() => {
    (global as any).fetch = originalFetch;
    clearSpreadsheetRestCache();
  });

  it('updates the workspace-level list cache after creating from a knowledge-scoped selector', async () => {
    const workspaceSelector = { workspaceId: 'ws-1' };
    const knowledgeSelector = {
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
    };

    primeSpreadsheetListPayload({
      requestUrl: buildSpreadsheetListUrl(workspaceSelector),
      payload: [
        {
          id: 1,
          workspaceId: 'ws-1',
          name: '旧数据表',
          sql: 'select 0',
          currentVersion: 1,
        },
      ],
    });

    await createSpreadsheet(knowledgeSelector, { responseId: 101 });

    expect(
      peekSpreadsheetListPayload({ selector: workspaceSelector })?.map(
        (spreadsheet) => spreadsheet.name,
      ),
    ).toEqual(['新数据表', '旧数据表']);
  });
});

import { resolveThreadResponseSqlPreviewMode } from './threadResponseSqlMode';

describe('threadResponseSqlMode', () => {
  it('uses dialect preview for executable template SQL without missing parameters', () => {
    expect(
      resolveThreadResponseSqlPreviewMode({
        askingTask: {
          diagnostics: {
            templateDecision: {
              sqlSource: 'rendered_template',
              missingParameters: [],
            },
          },
        } as any,
      }),
    ).toBe('dialect');
  });

  it('keeps default preview mode for generated SQL or incomplete templates', () => {
    expect(
      resolveThreadResponseSqlPreviewMode({
        askingTask: {
          diagnostics: {
            templateDecision: {
              sqlSource: 'llm',
              missingParameters: [],
            },
          },
        } as any,
      }),
    ).toBeUndefined();

    expect(
      resolveThreadResponseSqlPreviewMode({
        askingTask: {
          diagnostics: {
            templateDecision: {
              sqlSource: 'anchored_template',
              missingParameters: ['start_date'],
            },
          },
        } as any,
      }),
    ).toBeUndefined();
  });
});

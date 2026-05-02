import {
  getPreviewSqlModeForTemplateCarrier,
  resolvePreviewSqlMode,
} from '../templateSqlExecution';

describe('templateSqlExecution', () => {
  it('stores response sqlMode ahead of template-decision inference', () => {
    expect(
      getPreviewSqlModeForTemplateCarrier({
        artifactLineage: { sqlMode: 'dialect' },
      }),
    ).toBe('dialect');
  });

  it('infers dialect mode from direct template SQL decisions', () => {
    expect(
      getPreviewSqlModeForTemplateCarrier({
        templateDecision: {
          sqlSource: 'anchored_template',
          missingParameters: [],
        } as any,
      }),
    ).toBe('dialect');
  });

  it('inherits source response sqlMode before falling back to source task decisions', () => {
    expect(
      resolvePreviewSqlMode(
        { artifactLineage: null },
        { artifactLineage: { sqlMode: 'dialect' } },
        null,
        {
          templateDecision: {
            sqlSource: 'generated',
            missingParameters: [],
          },
        } as any,
      ),
    ).toBe('dialect');
  });
});

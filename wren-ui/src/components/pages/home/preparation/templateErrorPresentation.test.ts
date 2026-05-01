import { resolveTemplateAwarePreparationError } from './templateErrorPresentation';

describe('resolveTemplateAwarePreparationError', () => {
  it('asks for period days instead of exposing template technical failures', () => {
    expect(
      resolveTemplateAwarePreparationError({
        error: {
          message: 'SQL correction changed the protected template core',
          shortMessage: 'Clarification needed',
        },
        diagnostics: {
          templateDecision: {
            fallbackReason: 'template_core_protection_rejected_correction',
            missingParameters: ['period_days'],
          },
        },
      }),
    ).toMatchObject({
      shortMessage: '缺少回收周期',
      message: expect.stringContaining('D7'),
    });
  });

  it('keeps template core protection readable when no missing slot is available', () => {
    expect(
      resolveTemplateAwarePreparationError({
        error: {
          message: 'SQL correction changed the protected template core',
        },
        diagnostics: {
          templateDecision: {
            fallbackReason: 'template_core_protection_rejected_correction',
          },
        },
      }),
    ).toEqual({
      message:
        '系统拒绝了一次可能改变业务口径的 SQL 修正。请补充查询条件后重新生成，或联系管理员检查模板。',
      shortMessage: 'SQL 修正被模板保护拦截',
    });
  });

  it('leaves unrelated errors unchanged for generic handling', () => {
    expect(
      resolveTemplateAwarePreparationError({
        error: {
          message: 'network timeout',
        },
        diagnostics: {},
      }),
    ).toBeUndefined();
  });
});

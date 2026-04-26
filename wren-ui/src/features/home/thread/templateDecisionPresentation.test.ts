import { getThreadWorkbenchMessages } from './threadWorkbenchMessages';
import {
  resolveTemplateDecisionBadge,
  resolveTemplateDecisionPresentation,
} from './templateDecisionPresentation';

describe('templateDecisionPresentation', () => {
  const messages = getThreadWorkbenchMessages('zh-CN').template;

  it('distinguishes anchored generation from direct anchored template reuse', () => {
    expect(
      resolveTemplateDecisionBadge(
        {
          mode: 'anchored_template',
          sqlSource: 'anchored_generated',
        },
        messages,
      ),
    ).toBe('已按业务口径约束生成');

    expect(
      resolveTemplateDecisionBadge(
        {
          mode: 'anchored_template',
          sqlSource: 'anchored_template',
        },
        messages,
      ),
    ).toBe('已按业务口径模板生成');
  });

  it('includes template title, fallback reason, missing parameters, and sql source', () => {
    const presentation = resolveTemplateDecisionPresentation(
      {
        fallbackReason: 'missing_template_parameters',
        missingParameters: ['start_date', 'end_date'],
        mode: 'anchored_template',
        sqlSource: 'anchored_generated',
        templateTitle: '首存用户日龄趋势',
      },
      messages,
    );

    expect(presentation).toMatchObject({
      badge: '已按业务口径约束生成',
      tagColor: 'magenta',
    });
    expect(presentation?.description).toContain('模板：首存用户日龄趋势');
    expect(presentation?.description).toContain(
      '模板必填参数不完整，已降级处理',
    );
    expect(presentation?.description).toContain(
      '缺少参数：start_date, end_date',
    );
    expect(presentation?.description).toContain('SQL 来源：按业务口径约束生成');
  });

  it('maps dry-run and schema fallback reasons to localized descriptions', () => {
    const dryRunPresentation = resolveTemplateDecisionPresentation(
      {
        fallbackReason: 'template_dry_run_failed',
        mode: 'anchored_template',
      },
      messages,
    );
    const schemaPresentation = resolveTemplateDecisionPresentation(
      {
        fallbackReason: 'template_schema_retrieval_insufficient',
        mode: 'anchored_template',
      },
      messages,
    );

    expect(dryRunPresentation?.description).toContain(
      '模板直执行未通过 dry-run 校验，已降级为约束生成',
    );
    expect(schemaPresentation?.description).toContain(
      '模板缺少足够的 schema 召回支撑，未直接套用',
    );
  });
});

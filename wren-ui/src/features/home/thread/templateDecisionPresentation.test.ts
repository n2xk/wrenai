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
        parameters: { channel_id: 990011, cohort_start_date: '2026-04-02' },
        requiredExternalDependencies: ['ad_spend'],
        historyBackedTemplateContinuity: true,
        sqlSource: 'anchored_generated',
        templateId: 'T04',
        templateTitle: '首存用户日龄趋势',
      },
      messages,
    );

    expect(presentation).toMatchObject({
      badge: '已按业务口径约束生成',
      tagColor: 'magenta',
    });
    expect(presentation?.description).toContain('模板：首存用户日龄趋势');
    expect(presentation?.description).toContain('模板 ID：T04');
    expect(presentation?.description).toContain('模式：anchored_template');
    expect(presentation?.description).toContain(
      '模板必填参数不完整，已降级处理',
    );
    expect(presentation?.description).toContain(
      '缺少参数：start_date, end_date',
    );
    expect(presentation?.description).toContain(
      '参数：channel_id=990011, cohort_start_date=2026-04-02',
    );
    expect(presentation?.description).toContain('外部依赖：ad_spend');
    expect(presentation?.description).toContain(
      '追问连续性：已匹配上一轮模板上下文',
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

  it('maps semantic route guard fallback reasons to localized descriptions', () => {
    const channelSummaryPresentation = resolveTemplateDecisionPresentation(
      {
        fallbackReason: 'template_guard_channel_period_summary_mismatch',
        mode: 'reference',
        sqlSource: 'generated',
      },
      messages,
    );
    const loginWithoutDepositPresentation = resolveTemplateDecisionPresentation(
      {
        fallbackReason: 'template_guard_login_without_deposit_mismatch',
        mode: 'reference',
        sqlSource: 'generated',
      },
      messages,
    );

    expect(channelSummaryPresentation?.description).toContain(
      '当前问题要求按渠道区间汇总，不适合直接套用日级或分层等其他粒度模板',
    );
    expect(loginWithoutDepositPresentation?.description).toContain(
      '当前问题是登录未充值反查，不适合直接套用充值或首存模板',
    );
  });

  it('uses business-knowledge wording for GENERAL answers without implying SQL generation', () => {
    const presentation = resolveTemplateDecisionPresentation(
      {
        decisionReason: 'no_sql_pair_candidates',
        instructionCount: 11,
        mode: 'reference',
        sqlSource: 'generated',
      },
      messages,
      { isSqlFlow: false },
    );

    expect(presentation).toMatchObject({
      badge: '已按业务知识回答',
      tagColor: 'default',
    });
    expect(presentation?.description).toContain('未命中 SQL 模板/参考样例');
    expect(presentation?.description).toContain('分析规则：已命中 11 条');
    expect(presentation?.description).toContain('未进入 SQL 生成');
    expect(presentation?.description).not.toContain('SQL 来源：');
    expect(presentation?.description).not.toContain('LLM 参考生成');
  });

  it('highlights missing external data for GENERAL answers that cannot enter SQL generation', () => {
    const presentation = resolveTemplateDecisionPresentation(
      {
        decisionReason: 'explicit_business_template_selected',
        instructionCount: 1,
        mode: 'anchored_template',
        requiredExternalDependencies: ['ad_spend'],
        sqlSource: 'anchored_template',
        templateTitle: '渠道 ROI',
      },
      messages,
      { isSqlFlow: false },
    );

    expect(presentation).toMatchObject({
      badge: '需要补充外部数据',
      tagColor: 'warning',
    });
    expect(presentation?.description).toContain('模板：渠道 ROI');
    expect(presentation?.description).toContain(
      '当前问题依赖外部数据，已转为补充数据提示',
    );
    expect(presentation?.description).toContain('外部依赖：ad_spend');
    expect(presentation?.description).toContain('未进入 SQL 生成');
    expect(presentation?.description).not.toContain('SQL 来源：');
  });

  it('does not call no-sql-candidate SQL flows SQL-reference generation', () => {
    const presentation = resolveTemplateDecisionPresentation(
      {
        decisionReason: 'no_sql_pair_candidates',
        instructionCount: 0,
        mode: 'reference',
        sqlSource: 'generated',
      },
      messages,
      { isSqlFlow: true },
    );

    expect(presentation?.badge).toBe('未命中模板，直接生成 SQL');
    expect(presentation?.description).toContain('SQL 模板/参考：未命中');
    expect(presentation?.description).toContain('分析规则：未命中');
    expect(presentation?.description).toContain('SQL 来源：LLM 直接生成');
    expect(presentation?.description).not.toContain('降级原因：');
  });
});

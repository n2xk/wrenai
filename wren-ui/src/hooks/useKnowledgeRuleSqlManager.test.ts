import type { Instruction } from '@/types/knowledge';
import {
  buildSqlTemplateFormValues,
  buildSqlTemplatePayload,
  parseInstructionDraft,
  shouldUseRuleSqlListCache,
} from './knowledgeRuleSqlManagerUtils';

const buildInstruction = (
  overrides: Partial<Instruction> = {},
): Instruction => ({
  __typename: 'Instruction',
  id: 1,
  instruction: '',
  isDefault: false,
  questions: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('useKnowledgeRuleSqlManager helpers', () => {
  it('parses structured instruction blocks', () => {
    const instruction = buildInstruction({
      isDefault: true,
      instruction: '【规则描述】输出规范\n【规则内容】先输出结论，再解释原因',
    });

    expect(parseInstructionDraft(instruction)).toEqual({
      summary: '输出规范',
      scope: 'all',
      content: '先输出结论，再解释原因',
      relatedBusinessTermsText: '',
      relatedExternalDependenciesText: '',
      runtimeUsageJson: '',
    });
  });

  it('falls back to question and raw content for legacy instructions', () => {
    const instruction = buildInstruction({
      instruction: '按月统计销售额',
      questions: ['月度销售趋势'],
    });

    expect(parseInstructionDraft(instruction)).toEqual({
      summary: '月度销售趋势',
      scope: 'matched',
      content: '按月统计销售额',
      relatedBusinessTermsText: '',
      relatedExternalDependenciesText: '',
      runtimeUsageJson: '',
    });
  });

  it('returns empty draft when instruction is empty', () => {
    const instruction = buildInstruction({
      instruction: '   ',
      isDefault: false,
    });

    expect(parseInstructionDraft(instruction)).toEqual({
      summary: '',
      scope: 'matched',
      content: '',
      relatedBusinessTermsText: '',
      relatedExternalDependenciesText: '',
      runtimeUsageJson: '',
    });
  });

  it('uses cached rule/sql list only when cache is fresh and no force refresh', () => {
    expect(
      shouldUseRuleSqlListCache({
        forceRefresh: false,
        lastLoadedAt: 1_000,
        currentScopeKey: 'scope-a',
        lastLoadedScopeKey: 'scope-a',
        now: 5_000,
        ttlMs: 10_000,
      }),
    ).toBe(true);

    expect(
      shouldUseRuleSqlListCache({
        forceRefresh: true,
        lastLoadedAt: 1_000,
        currentScopeKey: 'scope-a',
        lastLoadedScopeKey: 'scope-a',
        now: 5_000,
        ttlMs: 10_000,
      }),
    ).toBe(false);

    expect(
      shouldUseRuleSqlListCache({
        forceRefresh: false,
        lastLoadedAt: 1_000,
        currentScopeKey: 'scope-a',
        lastLoadedScopeKey: 'scope-a',
        now: 5_000,
        ttlMs: 10_000,
      }),
    ).toBe(true);

    expect(
      shouldUseRuleSqlListCache({
        forceRefresh: false,
        lastLoadedAt: 1_000,
        currentScopeKey: 'scope-a',
        lastLoadedScopeKey: 'scope-a',
        now: 20_000,
        ttlMs: 10_000,
      }),
    ).toBe(false);
  });

  it('invalidates the cached rule/sql list when the runtime scope changes', () => {
    expect(
      shouldUseRuleSqlListCache({
        forceRefresh: false,
        lastLoadedAt: 1_000,
        lastLoadedScopeKey: 'workspace-a|kb-a|snap-a',
        currentScopeKey: 'workspace-b|kb-b|snap-b',
        now: 5_000,
        ttlMs: 10_000,
      }),
    ).toBe(false);
  });

  it('maps simple SQL template fields to parameter schema and business signature', () => {
    expect(
      buildSqlTemplatePayload({
        scope: 'all',
        description: '渠道日汇总',
        templateMode: 'executable_template',
        sql: 'select * from daily_channel',
        requiredSlotsText: 'tenant_plat_id\nstart_date\nend_date',
        expectedGrain: 'biz_date + channel_id',
        positiveScenariosText: '渠道日基础汇总',
        negativeScenariosText: '单玩家充值明细',
        externalDependenciesText: 'ad_spend',
        parameterSchemaJson:
          '{"properties":{"tenant_plat_id":{"type":"string"}}}',
        businessSignatureJson: '{"features":["channel_summary"]}',
      }),
    ).toMatchObject({
      assetKind: 'sql_template',
      templateLevel: 'L3',
      templateMode: 'executable_template',
      parameterSchema: {
        properties: { tenant_plat_id: { type: 'string' } },
        required: ['tenant_plat_id', 'start_date', 'end_date'],
      },
      businessSignature: {
        features: ['channel_summary'],
        expectedGrain: 'biz_date + channel_id',
        positiveCues: ['渠道日基础汇总'],
        negativeCues: ['单玩家充值明细'],
        externalDependencies: ['ad_spend'],
      },
    });
  });

  it('hydrates SQL template simple fields from existing metadata', () => {
    expect(
      buildSqlTemplateFormValues({
        id: 1,
        question: '渠道日汇总',
        sql: 'select 1',
        assetKind: 'sql_template',
        templateMode: 'anchored_template',
        parameterSchema: { required: ['tenant_plat_id'] },
        businessSignature: {
          expectedGrain: 'biz_date + channel_id',
          positiveCues: ['渠道日基础汇总'],
          negativeCues: ['单玩家充值明细'],
          externalDependencies: ['ad_spend'],
        },
      }),
    ).toMatchObject({
      templateMode: 'anchored_template',
      requiredSlotsText: 'tenant_plat_id',
      expectedGrain: 'biz_date + channel_id',
      positiveScenariosText: '渠道日基础汇总',
      negativeScenariosText: '单玩家充值明细',
      externalDependenciesText: 'ad_spend',
    });
  });
});

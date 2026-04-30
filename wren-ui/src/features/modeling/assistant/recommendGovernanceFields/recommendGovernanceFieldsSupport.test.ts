import {
  buildGovernanceFieldDrafts,
  countGovernanceDrafts,
  inferGovernanceRequiredSlots,
} from './recommendGovernanceFieldsSupport';

describe('recommendGovernanceFieldsSupport', () => {
  it('infers common required slots from governance prompts', () => {
    expect(
      inferGovernanceRequiredSlots(
        '租户平台下按渠道和日期统计首存 cohort 的 ROI',
      ),
    ).toEqual([
      'tenant_plat_id',
      'channel_id',
      'date_range',
      'cohort_date_range',
    ]);
  });

  it('builds business term and external dependency drafts for ROI prompts', () => {
    const drafts = buildGovernanceFieldDrafts(
      '按首存 cohort、续存和渠道 ROI 推荐治理字段',
    );

    expect(drafts.businessTerms.map((item) => item.title)).toEqual([
      '首存 / 首充',
      'ROI / 投放回收',
    ]);
    expect(drafts.externalDependencies[0]).toMatchObject({
      title: '投放金额',
      expectedGrain: 'biz_date + channel_id',
    });
    expect(countGovernanceDrafts(drafts)).toBeGreaterThan(0);
  });

  it('falls back to a reference example draft when no specific cue is found', () => {
    const drafts = buildGovernanceFieldDrafts('查询普通玩家明细');

    expect(drafts.sqlTemplates).toEqual([
      expect.objectContaining({
        title: '参考样例治理字段',
      }),
    ]);
  });
});

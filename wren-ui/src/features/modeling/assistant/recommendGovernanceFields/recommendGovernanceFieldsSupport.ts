export type GovernanceDraftItem = {
  title: string;
  description: string;
  requiredSlots: string[];
  applicableScenarios: string[];
  notApplicableScenarios: string[];
  expectedGrain?: string;
};

export type GovernanceFieldDrafts = {
  businessTerms: GovernanceDraftItem[];
  sqlTemplates: GovernanceDraftItem[];
  externalDependencies: GovernanceDraftItem[];
};

const unique = (values: string[]) =>
  values.filter((value, index) => value && values.indexOf(value) === index);

const hasAny = (text: string, keywords: string[]) =>
  keywords.some((keyword) => text.includes(keyword.toLowerCase()));

export const inferGovernanceRequiredSlots = (text: string) => {
  const normalized = text.toLowerCase();
  const slots: string[] = [];

  if (hasAny(normalized, ['租户', '平台', 'tenant'])) {
    slots.push('tenant_plat_id');
  }
  if (hasAny(normalized, ['渠道', 'channel'])) {
    slots.push('channel_id');
  }
  if (hasAny(normalized, ['日期', '时间', '周期', '日报', '趋势', 'cohort'])) {
    slots.push('date_range');
  }
  if (hasAny(normalized, ['cohort', '首存', '首充', '续存', '复存'])) {
    slots.push('cohort_date_range');
  }

  return unique(slots);
};

export const buildGovernanceFieldDrafts = (
  prompt: string,
): GovernanceFieldDrafts => {
  const normalized = prompt.toLowerCase();
  const requiredSlots = inferGovernanceRequiredSlots(prompt);
  const businessTerms: GovernanceDraftItem[] = [];
  const sqlTemplates: GovernanceDraftItem[] = [];
  const externalDependencies: GovernanceDraftItem[] = [];

  if (hasAny(normalized, ['首存', '首充', '首次存款', 'cohort'])) {
    businessTerms.push({
      title: '首存 / 首充',
      description: '首次成功充值用户口径，通常要求充值状态成功且充值次数为 1。',
      requiredSlots: unique(['tenant_plat_id', 'date_range', ...requiredSlots]),
      applicableScenarios: ['首存人数', '首存金额', '首存 cohort', '续存转化'],
      notApplicableScenarios: ['普通充值汇总', '单玩家充值明细'],
      expectedGrain: 'tenant_plat_id + first_deposit_date + channel_id',
    });
  }

  if (hasAny(normalized, ['roi', '投放', '回本', '首存成本', '首充成本'])) {
    businessTerms.push({
      title: 'ROI / 投放回收',
      description:
        '以投放金额为外部成本，计算首存 cohort 在指定周期内的回收表现。',
      requiredSlots: unique([
        'tenant_plat_id',
        'channel_id',
        'cohort_date_range',
        ...requiredSlots,
      ]),
      applicableScenarios: ['ROI', '投放回收', '首存成本', '回本周期'],
      notApplicableScenarios: ['没有投放成本的数据集', '玩家明细查询'],
      expectedGrain: 'tenant_plat_id + channel_id + cohort_date',
    });
    externalDependencies.push({
      title: '投放金额',
      description: 'ROI 和首存成本计算需要按日期、渠道补充投放金额。',
      requiredSlots: ['tenant_plat_id', 'channel_id', 'date_range'],
      applicableScenarios: ['ROI', '投放回收', '首存成本'],
      notApplicableScenarios: ['仅查询充值、投注等内部事实表指标'],
      expectedGrain: 'biz_date + channel_id',
    });
  }

  if (hasAny(normalized, ['pv', 'uv', '流量', '访问量', '下载点击'])) {
    externalDependencies.push({
      title: '渠道流量指标',
      description: '渠道日报中的 PV、UV、下载点击 UV 等通常来自外部流量数据。',
      requiredSlots: ['tenant_plat_id', 'channel_id', 'date_range'],
      applicableScenarios: [
        'PV',
        'UV',
        '下载点击 UV',
        'UV 下载率',
        'UV 注册率',
      ],
      notApplicableScenarios: ['只需要订单、玩家或投注事实指标'],
      expectedGrain: 'biz_date + channel_id',
    });
  }

  if (hasAny(normalized, ['日报', '综合日报', '渠道'])) {
    sqlTemplates.push({
      title: '渠道综合日报模板',
      description: '适合渠道 + 日期粒度的综合指标汇总。',
      requiredSlots: unique(['tenant_plat_id', 'channel_id', 'date_range']),
      applicableScenarios: ['渠道日报', '每日综合指标', '充值/投注/注册汇总'],
      notApplicableScenarios: ['玩家明细', '首存 cohort', '明确要求不用模板'],
      expectedGrain: 'biz_date + channel_id',
    });
  }

  if (sqlTemplates.length === 0) {
    sqlTemplates.push({
      title: '参考样例治理字段',
      description:
        '建议先作为参考样例保存，积累稳定问法后再提升为业务口径模板。',
      requiredSlots,
      applicableScenarios: prompt.trim() ? [prompt.trim()] : ['相近普通问数'],
      notApplicableScenarios: ['与样例业务主体、粒度或指标不一致的问题'],
      expectedGrain: requiredSlots.includes('date_range')
        ? 'biz_date'
        : undefined,
    });
  }

  return {
    businessTerms,
    sqlTemplates,
    externalDependencies,
  };
};

export const countGovernanceDrafts = (drafts: GovernanceFieldDrafts) =>
  drafts.businessTerms.length +
  drafts.sqlTemplates.length +
  drafts.externalDependencies.length;

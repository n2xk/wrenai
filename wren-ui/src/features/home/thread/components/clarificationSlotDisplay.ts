const slotLabels: Record<string, string> = {
  tenant_plat_id: '租户平台',
  channel_id: '渠道',
  date_range: '统计周期',
  start_date: '开始日期',
  end_date: '结束日期',
  cohort_start_date: 'Cohort 开始日期',
  cohort_end_date: 'Cohort 结束日期',
  metric_focus: '指标方向',
  channel_performance_context: '分析口径',
};

export const slotPlaceholders: Record<string, string> = {
  tenant_plat_id: '例如：990001',
  channel_id: '例如：990011',
  date_range: '例如：2026-04-01 到 2026-04-07',
  start_date: '例如：2026-04-01',
  end_date: '例如：2026-04-07',
  cohort_start_date: '例如：2026-04-01',
  cohort_end_date: '例如：2026-04-07',
  metric_focus: '例如：充值人数、充值金额、成功率',
  channel_performance_context: '例如：充值表现、注册转化、留存表现',
};

export const normalizeClarificationSlotLabel = (slot: string) =>
  slotLabels[slot] || slot;

const formatSlotValue = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.filter(Boolean).join('、');
  }

  if (value == null) {
    return '';
  }

  return String(value).trim();
};

export const formatClarificationSlotValues = (
  slotValues?: Record<string, unknown> | null,
) =>
  Object.entries(slotValues || {})
    .map(([slot, value]) => {
      const formattedValue = formatSlotValue(value);
      return formattedValue
        ? `${normalizeClarificationSlotLabel(slot)}=${formattedValue}`
        : null;
    })
    .filter((item): item is string => Boolean(item))
    .join('，');

export const appendClarificationSlotSummary = ({
  question,
  slotValues,
}: {
  question: string;
  slotValues?: Record<string, unknown> | null;
}) => {
  const formattedSlotValues = formatClarificationSlotValues(slotValues);
  return formattedSlotValues
    ? `${question}（已补充：${formattedSlotValues}）`
    : question;
};

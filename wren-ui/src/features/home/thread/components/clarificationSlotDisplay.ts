const slotLabels: Record<string, string> = {
  tenant_plat_id: '租户平台',
  channel_id: '渠道',
  date_range: '统计周期',
  start_date: '开始日期',
  end_date: '结束日期',
  cohort_start_date: 'Cohort 开始日期',
  cohort_end_date: 'Cohort 结束日期',
  n_days: '统计日龄',
  period_days: '回收周期',
  metric_focus: '指标方向',
  channel_performance_context: '分析口径',
};

const externalDependencyLabels: Record<string, string> = {
  ad_spend: '投放金额',
  access_pv: '访问 PV',
  access_uv: '访问 UV',
  download_click_uv: '下载点击 UV',
};

export const getExternalDependencyIdFromSlot = (slot: string) => {
  const prefixes = [
    'external_dependency:',
    'external_dependency.',
    'external_dependencies.',
  ];
  const matchedPrefix = prefixes.find((prefix) => slot.startsWith(prefix));
  return matchedPrefix ? slot.slice(matchedPrefix.length).trim() : '';
};

export const isExternalDependencySlot = (slot: string) =>
  Boolean(getExternalDependencyIdFromSlot(slot));

export const slotPlaceholders: Record<string, string> = {
  tenant_plat_id: '例如：72',
  channel_id: '例如：1932',
  date_range: '例如：2026-04-10 到 2026-04-16',
  start_date: '例如：2026-04-10',
  end_date: '例如：2026-04-16',
  cohort_start_date: '例如：2026-04-10',
  cohort_end_date: '例如：2026-04-16',
  n_days: '例如：7 或 D7',
  period_days: '例如：7、30 或 D7',
  metric_focus: '例如：充值人数、充值金额、成功率',
  channel_performance_context: '例如：充值表现、注册转化、留存表现',
};

export const normalizeClarificationSlotLabel = (slot: string) =>
  isExternalDependencySlot(slot)
    ? externalDependencyLabels[getExternalDependencyIdFromSlot(slot)] ||
      getExternalDependencyIdFromSlot(slot)
    : slotLabels[slot] || slot;

export const resolveClarificationSlotPlaceholder = (slot: string) => {
  if (isExternalDependencySlot(slot)) {
    return [
      '可粘贴 CSV，例如：',
      'date,channel_id,ad_spend,access_pv,access_uv,download_click_uv',
      '2026-04-10,1932,1120,12000,3000,800',
    ].join('\n');
  }
  return slotPlaceholders[slot] || '请输入补充信息';
};

const formatSlotValue = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value.filter(Boolean).join('、');
  }

  if (value && typeof value === 'object') {
    const slotValue = value as Record<string, unknown>;
    const startDate = formatSlotValue(slotValue.start_date);
    const endDate = formatSlotValue(slotValue.end_date);
    const singleDate = formatSlotValue(slotValue.date);
    if (startDate && endDate) {
      return `${startDate} 到 ${endDate}`;
    }
    if (singleDate) {
      return singleDate;
    }
    return Object.entries(slotValue)
      .map(([key, nestedValue]) => {
        const formattedNestedValue = formatSlotValue(nestedValue);
        return formattedNestedValue ? `${key}=${formattedNestedValue}` : null;
      })
      .filter(Boolean)
      .join('，');
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

export const mergeClarificationSlotValues = (
  resolvedSlots?: Record<string, unknown> | null,
  nextSlotValues?: Record<string, unknown> | null,
) =>
  Object.fromEntries(
    Object.entries({
      ...(resolvedSlots || {}),
      ...(nextSlotValues || {}),
    }).filter(([, value]) => formatSlotValue(value) !== ''),
  );

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const slotValuePatterns: Record<string, RegExp> = {
  tenant_plat_id: /^[A-Za-z0-9_-]{2,32}$/,
  channel_id: /^[A-Za-z0-9_-]{2,32}$/,
  start_date: /^\d{4}[-/]?\d{2}[-/]?\d{2}$/,
  end_date: /^\d{4}[-/]?\d{2}[-/]?\d{2}$/,
  cohort_start_date: /^\d{4}[-/]?\d{2}[-/]?\d{2}$/,
  cohort_end_date: /^\d{4}[-/]?\d{2}[-/]?\d{2}$/,
  date_range:
    /^\d{4}[-/]?\d{2}[-/]?\d{2}\s*(?:到|至|~|-|—|–)\s*\d{4}[-/]?\d{2}[-/]?\d{2}$/,
};

const extractExplicitSlotValue = (text: string, slot: string) => {
  const aliases = [slot, normalizeClarificationSlotLabel(slot)].filter(Boolean);
  for (const alias of aliases) {
    const pattern = new RegExp(
      `${escapeRegExp(alias)}\\s*(?:为|是|=|:|：)?\\s*([^，,；;\\s]+)`,
      'i',
    );
    const matched = text.match(pattern)?.[1]?.trim();
    if (matched) {
      return matched;
    }
  }

  return null;
};

const coerceSingleSlotValue = (text: string, slot: string) => {
  const explicitValue = extractExplicitSlotValue(text, slot);
  if (explicitValue) {
    return explicitValue;
  }

  const normalizedText = text.trim();
  if (!normalizedText) {
    return null;
  }
  if (isExternalDependencySlot(slot)) {
    return normalizedText.length <= 12000 ? normalizedText : null;
  }
  if (/生成.*图表|推荐.*问题/i.test(normalizedText)) {
    return null;
  }

  const slotPattern = slotValuePatterns[slot];
  if (slotPattern) {
    return slotPattern.test(normalizedText) ? normalizedText : null;
  }

  return normalizedText.length <= 40 ? normalizedText : null;
};

export const coerceClarificationSlotValuesFromText = ({
  pendingSlots,
  text,
}: {
  pendingSlots?: string[] | null;
  text: string;
}) => {
  const slots = Array.from(new Set((pendingSlots || []).filter(Boolean)));
  const normalizedText = text.trim();
  if (!slots.length || !normalizedText) {
    return null;
  }

  const explicitValues = slots.reduce<Record<string, string>>(
    (result, slot) => {
      const value = extractExplicitSlotValue(normalizedText, slot);
      if (value) {
        result[slot] = value;
      }
      return result;
    },
    {},
  );

  if (Object.keys(explicitValues).length === slots.length) {
    return explicitValues;
  }

  if (slots.every(isExternalDependencySlot) && normalizedText.length <= 12000) {
    return Object.fromEntries(slots.map((slot) => [slot, normalizedText]));
  }

  if (slots.length === 1) {
    const value = coerceSingleSlotValue(normalizedText, slots[0]);
    return value ? { [slots[0]]: value } : null;
  }

  return null;
};

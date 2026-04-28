import type { PreviewDataResponse } from './queryService';

export type ChartabilityReasonCode =
  | 'EMPTY_RESULT_SET'
  | 'INSUFFICIENT_NUMERIC_FIELDS'
  | 'INSUFFICIENT_DATA_VARIATION'
  | 'UNSUPPORTED_RESULT_SHAPE';

export type ChartabilityRecommendedDisplay = 'CHART' | 'NUMBER_CARD';

export type ChartabilityResult = {
  chartable: boolean;
  recommendedDisplay?: ChartabilityRecommendedDisplay | null;
  reasonCode?: ChartabilityReasonCode | null;
  message?: string | null;
};

const NUMERIC_TYPE_PATTERN =
  /(int|integer|bigint|smallint|decimal|numeric|double|float|real|number)/i;
const NUMERIC_VALUE_PATTERN = /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;

const isNumericType = (type?: string | null) =>
  typeof type === 'string' && NUMERIC_TYPE_PATTERN.test(type);

const isNumericLikeValue = (value: unknown) => {
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value !== 'string') {
    return false;
  }

  const normalized = value.trim().replaceAll(',', '');
  return Boolean(normalized) && NUMERIC_VALUE_PATTERN.test(normalized);
};

const columnHasNumericValues = (rows: unknown[][], columnIndex: number) => {
  const sampledValues = rows
    .map((row) => row?.[columnIndex])
    .filter((value) => value !== null && value !== undefined && value !== '')
    .slice(0, 20);

  if (!sampledValues.length) {
    return false;
  }

  const numericValues = sampledValues.filter(isNumericLikeValue).length;
  return numericValues >= Math.max(1, Math.ceil(sampledValues.length * 0.6));
};

const getUniqueValueCount = (rows: unknown[][], columnIndex: number) =>
  new Set(rows.map((row) => row?.[columnIndex] ?? null)).size;

export const evaluateChartability = (
  previewData?: PreviewDataResponse | null,
): ChartabilityResult => {
  const payload: Partial<PreviewDataResponse> = previewData ?? {};
  const rows = Array.isArray(payload.data) ? (payload.data as unknown[][]) : [];
  const columns = Array.isArray(payload.columns) ? payload.columns : [];

  if (rows.length === 0) {
    return {
      chartable: false,
      reasonCode: 'EMPTY_RESULT_SET',
      message: '当前查询结果为空，暂时无法生成图表。',
    };
  }

  const numericColumns = columns.filter(
    (column, index) =>
      isNumericType(column.type) || columnHasNumericValues(rows, index),
  );
  if (numericColumns.length === 0) {
    return {
      chartable: false,
      reasonCode: 'INSUFFICIENT_NUMERIC_FIELDS',
      message: '当前结果缺少可用于图表展示的数值字段。',
    };
  }

  if (rows.length === 1) {
    return {
      chartable: true,
      recommendedDisplay: 'NUMBER_CARD',
      reasonCode: null,
      message: '当前结果为单行汇总指标，已切换为指标卡展示。',
    };
  }

  if (columns.length < 2) {
    return {
      chartable: false,
      reasonCode: 'UNSUPPORTED_RESULT_SHAPE',
      message: '当前结果更适合以表格方式查看。',
    };
  }

  const hasDimensionVariation = columns.some(
    (_, index) => getUniqueValueCount(rows, index) >= 2,
  );

  if (!hasDimensionVariation) {
    return {
      chartable: false,
      reasonCode: 'INSUFFICIENT_DATA_VARIATION',
      message: '当前结果缺少足够的维度变化，暂时不适合直接生成图表。',
    };
  }

  return {
    chartable: true,
    recommendedDisplay: 'CHART',
    reasonCode: null,
    message: null,
  };
};

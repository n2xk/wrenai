import styled from 'styled-components';

type NumberCardColumn = {
  name: string;
  type?: string | null;
};

export type NumberCardMetric = {
  key: string;
  label: string;
  value: string;
  rawValue: unknown;
};

const NUMERIC_TYPE_PATTERN =
  /(int|integer|bigint|smallint|decimal|numeric|double|float|real|number)/i;
const NUMERIC_VALUE_PATTERN = /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;

const isNumericType = (type?: string | null) =>
  typeof type === 'string' && NUMERIC_TYPE_PATTERN.test(type);

const normalizeNumericString = (value: string) =>
  value.trim().replaceAll(',', '');

const isNumericLikeValue = (value: unknown) => {
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value !== 'string') {
    return false;
  }

  const normalized = normalizeNumericString(value);
  return Boolean(normalized) && NUMERIC_VALUE_PATTERN.test(normalized);
};

const toNumericValue = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = normalizeNumericString(value);
  if (!NUMERIC_VALUE_PATTERN.test(normalized)) {
    return null;
  }

  const numericValue = Number(normalized);
  return Number.isFinite(numericValue) ? numericValue : null;
};

const getFractionDigits = (value: unknown, numericValue: number) => {
  if (typeof value === 'string' && value.includes('.')) {
    const decimals = value.split('.')[1]?.replace(/0+$/, '').length || 0;
    return Math.min(Math.max(decimals, 2), 4);
  }

  return Number.isInteger(numericValue) ? 0 : 2;
};

const formatMetricValue = (value: unknown) => {
  const numericValue = toNumericValue(value);
  if (numericValue == null) {
    return value == null || value === '' ? '—' : String(value);
  }

  const fractionDigits = getFractionDigits(value, numericValue);
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(numericValue);
};

const formatMetricLabel = (name: string) => {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return '指标';
  }

  return trimmedName.replace(/_/g, ' ');
};

export const isNumberCardChartDetail = (
  chartDetail?: {
    chartType?: string | null;
    chartability?: {
      recommendedDisplay?: string | null;
    } | null;
    renderHints?: Record<string, unknown> | null;
  } | null,
) =>
  String(chartDetail?.chartType || '').toUpperCase() === 'NUMBER' ||
  chartDetail?.chartability?.recommendedDisplay === 'NUMBER_CARD' ||
  chartDetail?.renderHints?.displayType === 'number_card';

export const buildNumberCardMetrics = ({
  columns,
  rows,
}: {
  columns?: NumberCardColumn[] | null;
  rows?: Array<Record<string, unknown>> | null;
}): NumberCardMetric[] => {
  const firstRow = rows?.[0] || null;
  if (!firstRow) {
    return [];
  }

  const candidateColumns: NumberCardColumn[] = columns?.length
    ? columns
    : Object.keys(firstRow).map((name) => ({ name }));

  return candidateColumns
    .filter((column) => {
      const value = firstRow[column.name];
      return isNumericType(column.type) || isNumericLikeValue(value);
    })
    .map((column) => ({
      key: column.name,
      label: formatMetricLabel(column.name),
      rawValue: firstRow[column.name],
      value: formatMetricValue(firstRow[column.name]),
    }));
};

const NumberCardShell = styled.div<{ $variant: 'default' | 'pinned' }>`
  display: grid;
  grid-template-columns: ${({ $variant }) =>
    $variant === 'pinned'
      ? 'repeat(auto-fit, minmax(130px, 1fr))'
      : 'repeat(auto-fit, minmax(180px, 1fr))'};
  gap: ${({ $variant }) => ($variant === 'pinned' ? '10px' : '12px')};
  width: 100%;
`;

const NumberMetricCard = styled.div<{ $variant: 'default' | 'pinned' }>`
  min-width: 0;
  border: 1px solid rgba(111, 71, 255, 0.12);
  border-radius: ${({ $variant }) => ($variant === 'pinned' ? '16px' : '18px')};
  padding: ${({ $variant }) => ($variant === 'pinned' ? '12px' : '18px')};
  background:
    radial-gradient(
      circle at 100% 0%,
      rgba(111, 71, 255, 0.08),
      transparent 34%
    ),
    linear-gradient(180deg, #ffffff 0%, #fbfaff 100%);
`;

const NumberMetricLabel = styled.div<{ $variant: 'default' | 'pinned' }>`
  color: var(--gray-7);
  font-size: ${({ $variant }) => ($variant === 'pinned' ? '11px' : '12px')};
  font-weight: 500;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const NumberMetricValue = styled.div<{ $variant: 'default' | 'pinned' }>`
  color: var(--gray-10);
  font-size: ${({ $variant }) => ($variant === 'pinned' ? '28px' : '38px')};
  font-weight: 650;
  letter-spacing: -0.04em;
  line-height: 1.1;
  margin-top: ${({ $variant }) => ($variant === 'pinned' ? '10px' : '14px')};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const NumberCardEmpty = styled.div`
  color: var(--gray-6);
  font-size: 13px;
  padding: 24px;
  text-align: center;
`;

export default function NumberCardGroup(props: {
  columns?: NumberCardColumn[] | null;
  rows?: Array<Record<string, unknown>> | null;
  variant?: 'default' | 'pinned';
}) {
  const { columns, rows, variant = 'default' } = props;
  const metrics = buildNumberCardMetrics({ columns, rows });

  if (!metrics.length) {
    return <NumberCardEmpty>暂无可展示的指标数据</NumberCardEmpty>;
  }

  return (
    <NumberCardShell $variant={variant}>
      {metrics.map((metric) => (
        <NumberMetricCard key={metric.key} $variant={variant}>
          <NumberMetricLabel $variant={variant} title={metric.label}>
            {metric.label}
          </NumberMetricLabel>
          <NumberMetricValue $variant={variant} title={metric.value}>
            {metric.value}
          </NumberMetricValue>
        </NumberMetricCard>
      ))}
    </NumberCardShell>
  );
}

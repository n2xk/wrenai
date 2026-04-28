export const stripTrailingSpreadsheetSqlSemicolon = (sql: string) =>
  sql.trim().replace(/;\s*$/, '');

export const quoteSpreadsheetIdentifier = (value: string) =>
  `"${value.replace(/"/g, '""')}"`;

const trimTerminalPunctuation = (value: string) =>
  value.trim().replace(/[，。,.]$/, '');

export const normalizeSpreadsheetSqlLiteral = (value: string) => {
  const trimmed = trimTerminalPunctuation(value);
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return `'${trimmed.slice(1, -1).replace(/'/g, "''")}'`;
  }

  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return trimmed;
  }

  return `'${trimmed.replace(/'/g, "''")}'`;
};

const VALUE_TOKEN_PATTERN = String.raw`('[^']+'|"[^"]+"|[\p{L}\p{N}_./:\-]+)`;
const COLUMN_PATTERN = String.raw`([A-Za-z_][A-Za-z0-9_]*)`;

const normalizeConditionSegment = (segment: string) =>
  segment
    .trim()
    .replace(/^[，,;；\s]+|[，,;；\s]+$/g, '')
    .replace(/^(?:只保留|仅保留|保留|筛选|过滤)\s*/u, '')
    .replace(/\s*(?:的)?(?:记录|数据|行)$/u, '');

const splitConditionSegments = (instruction: string) =>
  instruction
    .split(/\s*(?:且|并且|同时|以及|and)\s*/iu)
    .map(normalizeConditionSegment)
    .filter(Boolean);

const splitLiteralList = (value: string) =>
  value
    .split(/[、，,]/)
    .map((item) => trimTerminalPunctuation(item))
    .filter(Boolean);

export const resolveSpreadsheetComparisonOperator = (operator: string) => {
  const normalized = operator.trim().toLowerCase();
  if (normalized === '大于' || normalized === '>') {
    return '>';
  }
  if (normalized === '小于' || normalized === '<') {
    return '<';
  }
  if (['大于等于', '不小于', '>='].includes(normalized)) {
    return '>=';
  }
  if (['小于等于', '不大于', '<='].includes(normalized)) {
    return '<=';
  }
  if (['不等于', '!=', '<>'].includes(normalized)) {
    return '<>';
  }
  return '=';
};

const parseOneStructuredFilterSegment = (segment: string) => {
  const nullMatch = segment.match(
    new RegExp(
      String.raw`^${COLUMN_PATTERN}\s*(不为空|非空|为空|是空|not\s+null|null)$`,
      'iu',
    ),
  );
  if (nullMatch) {
    const [, column, operator] = nullMatch;
    return `${quoteSpreadsheetIdentifier(column)} ${/不为空|非空|not\s+null/iu.test(operator) ? 'IS NOT NULL' : 'IS NULL'}`;
  }

  const betweenMatch = segment.match(
    new RegExp(
      String.raw`^${COLUMN_PATTERN}\s*(?:为|等于|从|在|介于|between)?\s*${VALUE_TOKEN_PATTERN}\s*(?:到|至|~|～)\s*${VALUE_TOKEN_PATTERN}$`,
      'iu',
    ),
  );
  if (betweenMatch) {
    const [, column, startValue, endValue] = betweenMatch;
    return `${quoteSpreadsheetIdentifier(column)} BETWEEN ${normalizeSpreadsheetSqlLiteral(
      startValue,
    )} AND ${normalizeSpreadsheetSqlLiteral(endValue)}`;
  }

  const inMatch = segment.match(
    new RegExp(
      String.raw`^${COLUMN_PATTERN}\s*(?:为|等于|属于|in|在)\s*(${VALUE_TOKEN_PATTERN}(?:\s*[、，,]\s*${VALUE_TOKEN_PATTERN})+)$`,
      'iu',
    ),
  );
  if (inMatch) {
    const [, column, rawValues] = inMatch;
    const values = splitLiteralList(rawValues);
    if (values.length > 1) {
      return `${quoteSpreadsheetIdentifier(column)} IN (${values
        .map(normalizeSpreadsheetSqlLiteral)
        .join(', ')})`;
    }
  }

  const containsMatch = segment.match(
    new RegExp(
      String.raw`^${COLUMN_PATTERN}\s*(?:包含|含有|like)\s*${VALUE_TOKEN_PATTERN}$`,
      'iu',
    ),
  );
  if (containsMatch) {
    const [, column, value] = containsMatch;
    const normalizedValue = trimTerminalPunctuation(value).replace(
      /^['"]|['"]$/g,
      '',
    );
    return `${quoteSpreadsheetIdentifier(column)} LIKE ${normalizeSpreadsheetSqlLiteral(
      `%${normalizedValue}%`,
    )}`;
  }

  const comparisonMatch = segment.match(
    new RegExp(
      String.raw`^${COLUMN_PATTERN}\s*(大于等于|小于等于|不小于|不大于|不等于|>=|<=|!=|<>|大于|小于|>|<)\s*${VALUE_TOKEN_PATTERN}$`,
      'iu',
    ),
  );
  if (comparisonMatch) {
    const [, column, operator, value] = comparisonMatch;
    return `${quoteSpreadsheetIdentifier(column)} ${resolveSpreadsheetComparisonOperator(
      operator,
    )} ${normalizeSpreadsheetSqlLiteral(value)}`;
  }

  const equalityMatch = segment.match(
    new RegExp(
      String.raw`^${COLUMN_PATTERN}\s*(?:为|等于|=)\s*${VALUE_TOKEN_PATTERN}$`,
      'iu',
    ),
  );
  if (equalityMatch) {
    const [, column, value] = equalityMatch;
    return `${quoteSpreadsheetIdentifier(column)} = ${normalizeSpreadsheetSqlLiteral(value)}`;
  }

  return null;
};

export const resolveStructuredSpreadsheetFilterCondition = (
  instruction: string,
) => {
  const normalizedInstruction = instruction.trim();
  const rawWhereMatch = normalizedInstruction.match(
    /^(?:where|条件[:：])\s+(.+)$/i,
  );
  if (rawWhereMatch?.[1]) {
    return rawWhereMatch[1].trim().replace(/;\s*$/, '');
  }

  const segments = splitConditionSegments(normalizedInstruction);
  if (segments.length === 0) {
    return null;
  }

  const parsedSegments = segments.map(parseOneStructuredFilterSegment);
  if (parsedSegments.some((condition) => !condition)) {
    return null;
  }

  return parsedSegments.join(' AND ');
};

const resolveStructuredSpreadsheetEnrichmentSelect = ({
  instruction,
  sqlMode,
}: {
  instruction: string;
  sqlMode?: string | null;
}) => {
  if (!/(工作日|周末|weekday|weekend)/iu.test(instruction)) {
    return null;
  }

  const explicitColumnMatch = instruction.match(
    /\b([A-Za-z_][A-Za-z0-9_]*)\b/iu,
  );
  const dateColumn = explicitColumnMatch?.[1] || 'biz_date';
  const qualifiedDateColumn = `spreadsheet_source.${quoteSpreadsheetIdentifier(
    dateColumn,
  )}`;
  const dayOfWeekExpression =
    sqlMode === 'dialect'
      ? `DAYOFWEEK(CAST(${qualifiedDateColumn} AS DATE)) IN (1, 7)`
      : `day_of_week(CAST(${qualifiedDateColumn} AS date)) IN (6, 7)`;

  return `spreadsheet_source.*, CASE WHEN ${dayOfWeekExpression} THEN '周末' ELSE '工作日' END AS ${quoteSpreadsheetIdentifier(
    'day_type',
  )}`;
};

export const buildStructuredSpreadsheetOperationSql = ({
  operationType,
  instruction,
  sql,
  sqlMode,
}: {
  operationType: string;
  instruction: string;
  sql: string;
  sqlMode?: string | null;
}) => {
  const sourceSql = stripTrailingSpreadsheetSqlSemicolon(sql);

  if (operationType === 'FILTER') {
    const condition = resolveStructuredSpreadsheetFilterCondition(instruction);
    if (!condition) {
      return null;
    }

    return `SELECT * FROM (${sourceSql}) AS spreadsheet_source WHERE ${condition}`;
  }

  if (operationType === 'ENRICHMENT') {
    const selectProjection = resolveStructuredSpreadsheetEnrichmentSelect({
      instruction,
      sqlMode,
    });
    if (!selectProjection) {
      return null;
    }

    return `SELECT ${selectProjection} FROM (${sourceSql}) AS spreadsheet_source`;
  }

  return null;
};

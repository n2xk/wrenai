import type {
  DashboardQueryControls,
  DashboardTimeFilterAiProposal,
  DashboardTimeFilterAnchor,
  DashboardTimeFilterCandidate,
  DashboardTimeFilterControl,
  DashboardTimeFilterMode,
  DashboardTimeFilterSqlBinding,
  DashboardTimeFilterSqlBindingKind,
} from '@/types/home';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SQL_DATE_LITERAL_VALUE_PATTERN =
  '\\d{4}-\\d{2}-\\d{2}(?:[ T]\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?)?';
const SQL_DATE_LITERAL_PATTERN = `(?:DATE\\s+)?'(${SQL_DATE_LITERAL_VALUE_PATTERN})'`;
const SQL_CAST_DATE_LITERAL_PATTERN = `CAST\\s*\\(\\s*(?:DATE\\s+)?'(${SQL_DATE_LITERAL_VALUE_PATTERN})'\\s+AS\\s+(?:DATE|TIMESTAMP(?:\\s+WITH\\s+TIME\\s+ZONE)?)\\s*\\)`;
const SQL_DIRECT_OR_CAST_DATE_LITERAL_PATTERN = `(?:${SQL_DATE_LITERAL_PATTERN}|${SQL_CAST_DATE_LITERAL_PATTERN})`;
const SQL_DATE_ADD_DAY_LITERAL_PATTERN = `(?:DATE_ADD\\s*\\(\\s*(?:DATE\\s+)?'(${SQL_DATE_LITERAL_VALUE_PATTERN})'\\s*,\\s*INTERVAL\\s+1\\s+DAY\\s*\\)|DATE_ADD\\s*\\(\\s*'day'\\s*,\\s*1\\s*,\\s*(?:DATE\\s+)?'(${SQL_DATE_LITERAL_VALUE_PATTERN})'\\s*\\))`;
const IDENTIFIER_PART = '(?:"[^"]+"|`[^`]+`|\\[[^\\]]+\\]|[A-Za-z_][\\w$]*)';
const FIELD_PATTERN = `${IDENTIFIER_PART}(?:\\s*\\.\\s*${IDENTIFIER_PART})*`;
const FIELD_EXPRESSION_PATTERN = `(?:${FIELD_PATTERN}|DATE\\s*\\(\\s*${FIELD_PATTERN}\\s*\\)|CAST\\s*\\(\\s*${FIELD_PATTERN}\\s+AS\\s+(?:DATE|TIMESTAMP(?:\\s+WITH\\s+TIME\\s+ZONE)?)\\s*\\))`;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const QUERY_CONTROLS_VERSION = 'dashboard-query-controls-v1' as const;
const DEFAULT_TIME_FILTER_ID = 'time_filter_1';
const MAX_ROLLING_WINDOW_DAYS = 3660;

type DateWindow = {
  endDate: string;
  startDate: string;
};

const normalizeField = (field: string) =>
  field
    .trim()
    .replace(/\s*\.\s*/g, '.')
    .replace(/\s+/g, ' ')
    .replace(/^DATE\s*\(\s*(.+?)\s*\)$/i, 'DATE($1)')
    .replace(
      /^CAST\s*\(\s*(.+?)\s+AS\s+(DATE|TIMESTAMP(?:\s+WITH\s+TIME\s+ZONE)?)\s*\)$/i,
      (_match, fieldExpression: string, type: string) =>
        `CAST(${fieldExpression} AS ${type.toUpperCase().replace(/\s+/g, ' ')})`,
    );

const parseDateToUtcTime = (date: string) =>
  Date.parse(`${date}T00:00:00.000Z`);

const isValidDateLiteral = (value: unknown): value is string => {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    return false;
  }

  const timestamp = parseDateToUtcTime(value);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
  );
};

const extractDateFromSqlLiteral = (literal: unknown) => {
  if (typeof literal !== 'string') {
    return null;
  }

  const match = new RegExp(`^(${SQL_DATE_LITERAL_VALUE_PATTERN})$`).exec(
    literal,
  );
  const date = match?.[1]?.slice(0, 10) || null;
  return date && isValidDateLiteral(date) ? date : null;
};

const isValidSqlDateLiteral = (literal: unknown): literal is string =>
  Boolean(extractDateFromSqlLiteral(literal));

const diffDays = (startDate: string, endDate: string) =>
  Math.round(
    (parseDateToUtcTime(endDate) - parseDateToUtcTime(startDate)) / MS_PER_DAY,
  );

export const addDaysToIsoDate = (date: string, days: number) => {
  const timestamp = parseDateToUtcTime(date);
  if (!Number.isFinite(timestamp)) {
    return date;
  }

  return new Date(timestamp + days * MS_PER_DAY).toISOString().slice(0, 10);
};

export const resolveDashboardQueryControlTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch (_error) {
    return 'UTC';
  }
};

export const hasDashboardSqlDateLiteral = (sql?: string | null) =>
  Boolean(
    sql &&
    new RegExp(`['"]${SQL_DATE_LITERAL_VALUE_PATTERN}['"]`, 'i').test(sql),
  );

const formatDateInTimezone = (date: Date, timezone?: string | null) => {
  const resolvedTimezone = timezone || 'UTC';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      day: '2-digit',
      month: '2-digit',
      timeZone: resolvedTimezone,
      year: 'numeric',
    }).formatToParts(date);
    const values = parts.reduce<Record<string, string>>((result, part) => {
      if (part.type !== 'literal') {
        result[part.type] = part.value;
      }
      return result;
    }, {});

    if (values.year && values.month && values.day) {
      return `${values.year}-${values.month}-${values.day}`;
    }
  } catch (_error) {
    // fall through to UTC formatting
  }

  return date.toISOString().slice(0, 10);
};

const isValidWindow = (
  startDate: string,
  endDate: string,
  kind: DashboardTimeFilterSqlBindingKind,
) => {
  const dayCount = diffDays(startDate, endDate);
  if (!Number.isFinite(dayCount)) {
    return false;
  }

  return kind === 'gte_lt' ? dayCount > 0 : dayCount >= 0;
};

const createCandidate = ({
  endLiteral,
  endLiteralOffsetDays = 0,
  field,
  kind,
  timezone,
  startLiteral,
}: {
  endLiteral: string;
  endLiteralOffsetDays?: number;
  field: string;
  kind: DashboardTimeFilterSqlBindingKind;
  startLiteral: string;
  timezone: string;
}): DashboardTimeFilterCandidate | null => {
  const startDate = extractDateFromSqlLiteral(startLiteral);
  const rawEndDate = extractDateFromSqlLiteral(endLiteral);
  const endDate =
    rawEndDate && endLiteralOffsetDays
      ? addDaysToIsoDate(rawEndDate, endLiteralOffsetDays)
      : rawEndDate;
  if (!isValidDateLiteral(startDate) || !isValidDateLiteral(endDate)) {
    return null;
  }
  if (!isValidWindow(startDate, endDate, kind)) {
    return null;
  }

  const rawWindowDays = diffDays(startDate, endDate);
  const windowDays = kind === 'gte_lt' ? rawWindowDays : rawWindowDays + 1;
  if (windowDays < 1 || windowDays > MAX_ROLLING_WINDOW_DAYS) {
    return null;
  }

  return {
    field: normalizeField(field),
    originalEndDate: endDate,
    originalStartDate: startDate,
    sqlBinding: {
      ...(endLiteralOffsetDays ? { endLiteralOffsetDays } : {}),
      kind,
      startLiteral,
      endLiteral,
    },
    timezone,
    windowDays,
  };
};

export const detectDashboardTimeFilterCandidate = (
  sql?: string | null,
  timezone = resolveDashboardQueryControlTimezone(),
): DashboardTimeFilterCandidate | null => {
  if (!sql || typeof sql !== 'string') {
    return null;
  }

  const betweenPattern = new RegExp(
    `(${FIELD_EXPRESSION_PATTERN})\\s+BETWEEN\\s+${SQL_DIRECT_OR_CAST_DATE_LITERAL_PATTERN}\\s+AND\\s+${SQL_DIRECT_OR_CAST_DATE_LITERAL_PATTERN}`,
    'gi',
  );
  const candidates: DashboardTimeFilterCandidate[] = [];
  let betweenMatch: RegExpExecArray | null = null;
  while ((betweenMatch = betweenPattern.exec(sql))) {
    const candidate = createCandidate({
      field: betweenMatch[1],
      startLiteral: betweenMatch[2] || betweenMatch[3],
      endLiteral: betweenMatch[4] || betweenMatch[5],
      kind: 'between',
      timezone,
    });
    if (candidate) {
      candidates.push(candidate);
    }
  }

  const rangePattern = new RegExp(
    `(${FIELD_EXPRESSION_PATTERN})\\s*>=\\s*${SQL_DIRECT_OR_CAST_DATE_LITERAL_PATTERN}\\s+AND\\s+(${FIELD_EXPRESSION_PATTERN})\\s*(<=|<)\\s*${SQL_DIRECT_OR_CAST_DATE_LITERAL_PATTERN}`,
    'gi',
  );
  let rangeMatch: RegExpExecArray | null = null;
  while ((rangeMatch = rangePattern.exec(sql))) {
    const startField = normalizeField(rangeMatch[1]);
    const endField = normalizeField(rangeMatch[4]);
    if (startField.toLowerCase() !== endField.toLowerCase()) {
      continue;
    }

    const candidate = createCandidate({
      field: startField,
      startLiteral: rangeMatch[2] || rangeMatch[3],
      endLiteral: rangeMatch[6] || rangeMatch[7],
      kind: rangeMatch[5] === '<' ? 'gte_lt' : 'gte_lte',
      timezone,
    });
    if (candidate) {
      candidates.push(candidate);
    }
  }

  const dateAddRangePattern = new RegExp(
    `(${FIELD_EXPRESSION_PATTERN})\\s*>=\\s*${SQL_DIRECT_OR_CAST_DATE_LITERAL_PATTERN}\\s+AND\\s+(${FIELD_EXPRESSION_PATTERN})\\s*<\\s*${SQL_DATE_ADD_DAY_LITERAL_PATTERN}`,
    'gi',
  );
  let dateAddRangeMatch: RegExpExecArray | null = null;
  while ((dateAddRangeMatch = dateAddRangePattern.exec(sql))) {
    const startField = normalizeField(dateAddRangeMatch[1]);
    const endField = normalizeField(dateAddRangeMatch[4]);
    if (startField.toLowerCase() !== endField.toLowerCase()) {
      continue;
    }

    const candidate = createCandidate({
      field: startField,
      startLiteral: dateAddRangeMatch[2] || dateAddRangeMatch[3],
      endLiteral: dateAddRangeMatch[5] || dateAddRangeMatch[6],
      endLiteralOffsetDays: 1,
      kind: 'gte_lt',
      timezone,
    });
    if (candidate) {
      candidates.push(candidate);
    }
  }

  return resolveDetectedTimeFilterCandidate(candidates);
};

const isDashboardTimeFilterAiProposal = (
  value: unknown,
): value is DashboardTimeFilterAiProposal => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<DashboardTimeFilterAiProposal>;
  const binding = candidate.sqlBinding as
    | Partial<DashboardTimeFilterSqlBinding>
    | undefined;
  return Boolean(
    typeof candidate.field === 'string' &&
    binding &&
    isValidSqlBindingKind(binding.kind) &&
    typeof binding.startLiteral === 'string' &&
    typeof binding.endLiteral === 'string',
  );
};

export const buildDashboardQueryControls = ({
  anchor = 'last_complete_day',
  candidate,
  mode,
}: {
  anchor?: DashboardTimeFilterAnchor;
  candidate: DashboardTimeFilterCandidate;
  mode: DashboardTimeFilterMode;
}): DashboardQueryControls => ({
  version: QUERY_CONTROLS_VERSION,
  timeFilters: [
    {
      anchor,
      field: candidate.field,
      id: DEFAULT_TIME_FILTER_ID,
      mode,
      originalEndDate: candidate.originalEndDate,
      originalStartDate: candidate.originalStartDate,
      sqlBinding: candidate.sqlBinding,
      timezone: candidate.timezone || resolveDashboardQueryControlTimezone(),
      windowDays: candidate.windowDays,
    },
  ],
});

const isValidSqlBindingKind = (
  value: unknown,
): value is DashboardTimeFilterSqlBindingKind =>
  value === 'between' || value === 'gte_lte' || value === 'gte_lt';

const isValidMode = (value: unknown): value is DashboardTimeFilterMode =>
  value === 'fixed' || value === 'rolling_window';

const isValidAnchor = (value: unknown): value is DashboardTimeFilterAnchor =>
  value === 'today' || value === 'last_complete_day';

export const normalizeDashboardQueryControls = (
  value: unknown,
): DashboardQueryControls | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<DashboardQueryControls>;
  if (candidate.version !== QUERY_CONTROLS_VERSION) {
    return null;
  }

  const normalizedFilters = (candidate.timeFilters || [])
    .map((filter): DashboardTimeFilterControl | null => {
      if (!filter || typeof filter !== 'object') {
        return null;
      }
      const item = filter as Partial<DashboardTimeFilterControl>;
      const sqlBinding = (item.sqlBinding ||
        {}) as Partial<DashboardTimeFilterSqlBinding>;
      const windowDays = Number(item.windowDays);
      const endLiteralOffsetDays = Number(sqlBinding.endLiteralOffsetDays || 0);

      if (
        typeof item.id !== 'string' ||
        typeof item.field !== 'string' ||
        item.field.trim().length === 0 ||
        item.field.length > 200 ||
        !isValidMode(item.mode) ||
        !isValidAnchor(item.anchor) ||
        !isValidDateLiteral(item.originalStartDate) ||
        !isValidDateLiteral(item.originalEndDate) ||
        !Number.isInteger(windowDays) ||
        windowDays < 1 ||
        windowDays > MAX_ROLLING_WINDOW_DAYS ||
        typeof item.timezone !== 'string' ||
        item.timezone.trim().length === 0 ||
        item.timezone.length > 100 ||
        !isValidSqlBindingKind(sqlBinding.kind) ||
        !isValidSqlDateLiteral(sqlBinding.startLiteral) ||
        !isValidSqlDateLiteral(sqlBinding.endLiteral) ||
        !Number.isInteger(endLiteralOffsetDays) ||
        endLiteralOffsetDays < 0 ||
        endLiteralOffsetDays > 1
      ) {
        return null;
      }

      return {
        anchor: item.anchor,
        field: item.field.trim(),
        id: item.id,
        mode: item.mode,
        originalEndDate: item.originalEndDate,
        originalStartDate: item.originalStartDate,
        sqlBinding: {
          ...(endLiteralOffsetDays ? { endLiteralOffsetDays } : {}),
          kind: sqlBinding.kind,
          startLiteral: sqlBinding.startLiteral,
          endLiteral: sqlBinding.endLiteral,
        },
        timezone: item.timezone,
        windowDays,
      };
    })
    .filter((filter): filter is DashboardTimeFilterControl => Boolean(filter));

  if ((candidate.timeFilters || []).length !== normalizedFilters.length) {
    return null;
  }

  return {
    version: QUERY_CONTROLS_VERSION,
    ...(normalizedFilters.length ? { timeFilters: normalizedFilters } : {}),
  };
};

export const getDashboardTimeFilterDisplayEndDate = ({
  endDate,
  kind,
}: {
  endDate: string;
  kind: DashboardTimeFilterSqlBindingKind;
}) => (kind === 'gte_lt' ? addDaysToIsoDate(endDate, -1) : endDate);

export const formatDashboardQueryControlsLabel = (
  queryControls?: DashboardQueryControls | null,
) => {
  const normalizedControls = normalizeDashboardQueryControls(queryControls);
  const filter = normalizedControls?.timeFilters?.[0];
  if (!filter) {
    return null;
  }

  if (filter.mode === 'rolling_window') {
    const anchorLabel =
      filter.anchor === 'today'
        ? '到今天'
        : filter.anchor === 'last_complete_day'
          ? '到昨天'
          : '';
    return `日期策略：滚动 ${filter.windowDays} 天${
      anchorLabel ? ` · ${anchorLabel}` : ''
    }`;
  }

  const displayEndDate = getDashboardTimeFilterDisplayEndDate({
    endDate: filter.originalEndDate,
    kind: filter.sqlBinding.kind,
  });
  return `日期策略：固定 ${filter.originalStartDate} 至 ${displayEndDate}`;
};

export const calculateDashboardTimeFilterWindow = (
  filter: DashboardTimeFilterControl,
  now = new Date(),
): DateWindow => {
  if (filter.mode === 'fixed') {
    return {
      startDate: filter.originalStartDate,
      endDate: filter.originalEndDate,
    };
  }

  const anchorDate = formatDateInTimezone(now, filter.timezone);
  const inclusiveEndDate =
    filter.anchor === 'last_complete_day'
      ? addDaysToIsoDate(anchorDate, -1)
      : anchorDate;

  if (filter.sqlBinding.kind === 'gte_lt') {
    const endDate = addDaysToIsoDate(inclusiveEndDate, 1);
    return {
      startDate: addDaysToIsoDate(endDate, -filter.windowDays),
      endDate,
    };
  }

  return {
    startDate: addDaysToIsoDate(inclusiveEndDate, -(filter.windowDays - 1)),
    endDate: inclusiveEndDate,
  };
};

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const findQuotedLiteral = ({
  literal,
  sql,
  startIndex = 0,
}: {
  literal: string;
  sql: string;
  startIndex?: number;
}) => {
  const pattern = new RegExp(`(['"])${escapeRegExp(literal)}\\1`, 'g');
  pattern.lastIndex = startIndex;
  return pattern.exec(sql);
};

const hasOrderedSqlDateLiterals = ({
  endLiteral,
  sql,
  startLiteral,
}: {
  endLiteral: string;
  sql: string;
  startLiteral: string;
}) => {
  const startMatch = findQuotedLiteral({ literal: startLiteral, sql });
  if (!startMatch) {
    return false;
  }

  const endMatch = findQuotedLiteral({
    literal: endLiteral,
    sql,
    startIndex: startMatch.index + startMatch[0].length,
  });
  return Boolean(endMatch);
};

const getCandidateDateWindowKey = (candidate: DashboardTimeFilterCandidate) =>
  JSON.stringify({
    endLiteral: candidate.sqlBinding.endLiteral,
    endLiteralOffsetDays: candidate.sqlBinding.endLiteralOffsetDays || 0,
    kind: candidate.sqlBinding.kind,
    originalEndDate: candidate.originalEndDate,
    originalStartDate: candidate.originalStartDate,
    startLiteral: candidate.sqlBinding.startLiteral,
    timezone: candidate.timezone,
    windowDays: candidate.windowDays,
  });

const resolveDetectedTimeFilterCandidate = (
  candidates: DashboardTimeFilterCandidate[],
) => {
  if (candidates.length <= 1) {
    return candidates[0] || null;
  }

  const firstCandidateKey = getCandidateDateWindowKey(candidates[0]);
  return candidates.every(
    (candidate) => getCandidateDateWindowKey(candidate) === firstCandidateKey,
  )
    ? candidates[0]
    : null;
};

const applyDateToSqlLiteral = (literal: string, replacementDate: string) =>
  literal.replace(/^\d{4}-\d{2}-\d{2}/, replacementDate);

const replaceQuotedLiteralMatch = ({
  match,
  replacement,
  sql,
}: {
  match: RegExpExecArray;
  replacement: string;
  sql: string;
}) =>
  `${sql.slice(0, match.index)}${match[1]}${replacement}${match[1]}${sql.slice(
    match.index + match[0].length,
  )}`;

const replaceOrderedQuotedLiteralPairs = ({
  endLiteral,
  endReplacement,
  sql,
  startLiteral,
  startReplacement,
}: {
  endLiteral: string;
  endReplacement: string;
  sql: string;
  startLiteral: string;
  startReplacement: string;
}) => {
  let nextSql = sql;
  let searchIndex = 0;
  let replaced = false;

  while (searchIndex < nextSql.length) {
    const startMatch = findQuotedLiteral({
      literal: startLiteral,
      sql: nextSql,
      startIndex: searchIndex,
    });
    if (!startMatch) {
      break;
    }

    const endMatch = findQuotedLiteral({
      literal: endLiteral,
      sql: nextSql,
      startIndex: startMatch.index + startMatch[0].length,
    });
    if (!endMatch) {
      break;
    }

    const endReplacementText = `${endMatch[1]}${endReplacement}${endMatch[1]}`;
    const startReplacementText = `${startMatch[1]}${startReplacement}${startMatch[1]}`;
    const startDelta = startReplacementText.length - startMatch[0].length;

    nextSql = replaceQuotedLiteralMatch({
      match: endMatch,
      replacement: endReplacement,
      sql: nextSql,
    });
    nextSql = replaceQuotedLiteralMatch({
      match: startMatch,
      replacement: startReplacement,
      sql: nextSql,
    });
    searchIndex = endMatch.index + startDelta + endReplacementText.length;
    replaced = true;
  }

  return replaced ? nextSql : sql;
};

export const compileDashboardItemSql = ({
  now = new Date(),
  queryControls,
  sql,
}: {
  now?: Date;
  queryControls?: DashboardQueryControls | null;
  sql: string;
}) => {
  const normalizedControls = normalizeDashboardQueryControls(queryControls);
  if (!normalizedControls?.timeFilters?.length) {
    return sql;
  }

  return normalizedControls.timeFilters.reduce((currentSql, filter) => {
    if (filter.mode !== 'rolling_window') {
      return currentSql;
    }

    const window = calculateDashboardTimeFilterWindow(filter, now);
    const endLiteralOffsetDays = filter.sqlBinding.endLiteralOffsetDays || 0;
    return replaceOrderedQuotedLiteralPairs({
      sql: currentSql,
      startLiteral: filter.sqlBinding.startLiteral,
      endLiteral: filter.sqlBinding.endLiteral,
      startReplacement: applyDateToSqlLiteral(
        filter.sqlBinding.startLiteral,
        window.startDate,
      ),
      endReplacement: applyDateToSqlLiteral(
        filter.sqlBinding.endLiteral,
        endLiteralOffsetDays
          ? addDaysToIsoDate(window.endDate, -endLiteralOffsetDays)
          : window.endDate,
      ),
    });
  }, sql);
};

export const normalizeDashboardTimeFilterAiProposal = ({
  proposal,
  sql,
  timezone = resolveDashboardQueryControlTimezone(),
}: {
  proposal: unknown;
  sql: string;
  timezone?: string;
}): DashboardTimeFilterCandidate | null => {
  if (!isDashboardTimeFilterAiProposal(proposal)) {
    return null;
  }

  const sqlBinding = proposal.sqlBinding;
  const candidate = createCandidate({
    field: proposal.field,
    startLiteral: sqlBinding.startLiteral,
    endLiteral: sqlBinding.endLiteral,
    endLiteralOffsetDays: sqlBinding.endLiteralOffsetDays || 0,
    kind: sqlBinding.kind,
    timezone,
  });
  if (!candidate) {
    return null;
  }

  if (
    !hasOrderedSqlDateLiterals({
      sql,
      startLiteral: candidate.sqlBinding.startLiteral,
      endLiteral: candidate.sqlBinding.endLiteral,
    })
  ) {
    return null;
  }

  const compiledSql = compileDashboardItemSql({
    sql,
    queryControls: buildDashboardQueryControls({
      candidate,
      mode: 'rolling_window',
      anchor: 'last_complete_day',
    }),
    now: new Date('2030-01-15T00:00:00.000Z'),
  });

  return compiledSql !== sql ? candidate : null;
};

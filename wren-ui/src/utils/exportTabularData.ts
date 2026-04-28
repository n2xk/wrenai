type PreviewColumn = {
  name: string;
  type?: string | null;
};

type PreviewDataLike = {
  columns?: PreviewColumn[] | null;
  data?: unknown[][] | null;
};

const UTF8_BOM = '\uFEFF';

const EXPORT_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export const hasExportablePreviewData = (
  previewData?: PreviewDataLike | null,
) => Boolean(previewData?.columns?.length && previewData?.data?.length);

const formatExportValue = (value: unknown): string => {
  if (value == null) {
    return '';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (_error) {
      return String(value);
    }
  }
  return String(value);
};

export const escapeCsvCell = (value: unknown): string => {
  const text = formatExportValue(value);
  const escaped = text.replace(/"/g, '""');
  return /[",\r\n]/.test(escaped) ? `"${escaped}"` : escaped;
};

export const buildCsvContent = (
  columns: PreviewColumn[] = [],
  data: unknown[][] = [],
) => {
  const rows = [
    columns.map((column) => escapeCsvCell(column.name)),
    ...data.map((row) =>
      columns.map((_, columnIndex) => escapeCsvCell(row?.[columnIndex])),
    ),
  ];

  return `${UTF8_BOM}${rows.map((row) => row.join(',')).join('\r\n')}`;
};

const escapeHtml = (value: unknown): string =>
  formatExportValue(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const buildExcelHtmlContent = (
  columns: PreviewColumn[] = [],
  data: unknown[][] = [],
  title = '查询结果',
) => {
  const header = columns
    .map((column) => `<th>${escapeHtml(column.name)}</th>`)
    .join('');
  const body = data
    .map(
      (row) =>
        `<tr>${columns
          .map((_, columnIndex) => `<td>${escapeHtml(row?.[columnIndex])}</td>`)
          .join('')}</tr>`,
    )
    .join('');

  return `${UTF8_BOM}<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"><style>table{border-collapse:collapse;}th,td{border:1px solid #d9d9d9;padding:4px 8px;font-family:Arial,'Microsoft YaHei',sans-serif;font-size:12px;}th{background:#f5f5f5;font-weight:600;}</style></head><body><table><caption>${escapeHtml(
    title,
  )}</caption><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></body></html>`;
};

const sanitizeFileName = (fileName: string) => {
  const normalized = fileName
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

  return normalized || 'query-result';
};

export const buildExportFileName = (
  baseName = 'query-result',
  extension: 'csv' | 'xls',
  now = new Date(),
) => {
  const timestamp = EXPORT_TIMESTAMP_FORMATTER.format(now)
    .replace(', ', '-')
    .replace(/[/:]/g, '')
    .replace(/\s+/g, '');
  return `${sanitizeFileName(baseName)}-${timestamp}.${extension}`;
};

export const downloadTextFile = (
  fileName: string,
  content: string,
  mimeType: string,
) => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }

  const blob = new Blob([content], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
  return true;
};

export const exportPreviewDataCsv = (
  previewData: PreviewDataLike,
  fileNameBase?: string,
) =>
  downloadTextFile(
    buildExportFileName(fileNameBase, 'csv'),
    buildCsvContent(previewData.columns || [], previewData.data || []),
    'text/csv;charset=utf-8',
  );

export const exportPreviewDataExcel = (
  previewData: PreviewDataLike,
  fileNameBase?: string,
) =>
  downloadTextFile(
    buildExportFileName(fileNameBase, 'xls'),
    buildExcelHtmlContent(
      previewData.columns || [],
      previewData.data || [],
      fileNameBase || '查询结果',
    ),
    'application/vnd.ms-excel;charset=utf-8',
  );

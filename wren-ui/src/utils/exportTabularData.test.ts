import {
  buildCsvContent,
  buildExcelHtmlContent,
  buildExportFileName,
  escapeCsvCell,
  hasExportablePreviewData,
} from './exportTabularData';

describe('exportTabularData', () => {
  it('escapes CSV values with commas, quotes and newlines', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('a"b')).toBe('"a""b"');
    expect(escapeCsvCell('a\nb')).toBe('"a\nb"');
    expect(escapeCsvCell(null)).toBe('');
  });

  it('builds UTF-8 BOM CSV content from preview columns and rows', () => {
    const csv = buildCsvContent(
      [{ name: '日期' }, { name: '渠道,名称' }, { name: '备注' }],
      [
        ['2026-04-01', '官网', '正常'],
        ['2026-04-02', '直播间', '含"引号"\n换行'],
      ],
    );

    expect(csv).toBe(
      '\uFEFF日期,"渠道,名称",备注\r\n2026-04-01,官网,正常\r\n2026-04-02,直播间,"含""引号""\n换行"',
    );
  });

  it('builds an Excel-compatible HTML table with escaped cells', () => {
    const html = buildExcelHtmlContent(
      [{ name: '渠道' }, { name: 'GMV' }],
      [['官网', '<100>']],
      '经营报表',
    );

    expect(html).toContain('<caption>经营报表</caption>');
    expect(html).toContain('<th>渠道</th>');
    expect(html).toContain('<td>&lt;100&gt;</td>');
  });

  it('detects exportable preview data', () => {
    expect(
      hasExportablePreviewData({
        columns: [{ name: '日期' }],
        data: [['2026-04-01']],
      }),
    ).toBe(true);
    expect(
      hasExportablePreviewData({ columns: [{ name: '日期' }], data: [] }),
    ).toBe(false);
  });

  it('generates safe timestamped file names', () => {
    expect(
      buildExportFileName(
        '经营/报表:预览',
        'csv',
        new Date('2026-04-27T01:02:03Z'),
      ),
    ).toMatch(/^经营-报表-预览-\d{4}-\d{2}-\d{2}-\d{6}\.csv$/);
  });
});

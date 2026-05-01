import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PreviewData from './PreviewData';

jest.mock('./PreviewDataContent', () => ({
  __esModule: true,
  default: () => <div>PreviewDataContent</div>,
}));

describe('PreviewData', () => {
  it('keeps export actions visible but disabled when the query returns no rows', () => {
    const markup = renderToStaticMarkup(
      <PreviewData
        loading={false}
        previewData={{ columns: [{ name: '日期', type: 'DATE' }], data: [] }}
      />,
    );

    expect(markup).toContain('导出 CSV');
    expect(markup).toContain('导出 Excel');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>.*导出 CSV/s);
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>.*导出 Excel/s);
  });

  it('enables export actions when preview rows exist', () => {
    const markup = renderToStaticMarkup(
      <PreviewData
        loading={false}
        previewData={{
          columns: [{ name: '日期', type: 'DATE' }],
          data: [['2026-04-01']],
        }}
      />,
    );

    expect(markup).toContain('导出 CSV');
    expect(markup).toContain('导出 Excel');
    expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*>.*导出 CSV/s);
  });
});

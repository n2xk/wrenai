import {
  buildHistoryVirtualSpacerStyle,
  normalizeHistoryDisplayTitle,
} from './DolaShellHistoryPane';

describe('normalizeHistoryDisplayTitle', () => {
  it('removes generated trailing ellipsis for display only', () => {
    expect(normalizeHistoryDisplayTitle('查询租户平台990001渠...')).toBe(
      '查询租户平台990001渠',
    );
    expect(normalizeHistoryDisplayTitle('查询租户平台990001渠…')).toBe(
      '查询租户平台990001渠',
    );
  });

  it('keeps non-ellipsis titles unchanged', () => {
    expect(normalizeHistoryDisplayTitle('1111')).toBe('1111');
    expect(normalizeHistoryDisplayTitle('...')).toBe('...');
  });

  it('prevents virtual spacer from shrinking inside the flex scroller', () => {
    expect(buildHistoryVirtualSpacerStyle(320)).toEqual({
      flex: '0 0 auto',
      height: 320,
      minHeight: 320,
    });
  });
});

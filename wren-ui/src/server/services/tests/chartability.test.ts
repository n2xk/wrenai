import { evaluateChartability } from '../chartability';

describe('evaluateChartability', () => {
  it('allows charts when a varying numeric identifier column is present', () => {
    expect(
      evaluateChartability({
        columns: [
          { name: 'channel_id', type: 'BIGINT' },
          { name: 'player_count', type: 'BIGINT' },
          { name: 'ratio', type: 'DOUBLE' },
        ],
        data: [
          [990011, 6, 0.8571],
          [990012, 1, 0.1429],
        ],
      } as any),
    ).toEqual({
      chartable: true,
      recommendedDisplay: 'CHART',
      reasonCode: null,
      message: null,
    });
  });

  it('keeps blocking empty result sets', () => {
    expect(
      evaluateChartability({
        columns: [
          { name: 'channel_id', type: 'BIGINT' },
          { name: 'player_count', type: 'BIGINT' },
        ],
        data: [],
      } as any),
    ).toEqual({
      chartable: false,
      reasonCode: 'EMPTY_RESULT_SET',
      message: '当前查询结果为空，暂时无法生成图表。',
    });
  });

  it('treats numeric-like string measures as chartable fields', () => {
    expect(
      evaluateChartability({
        columns: [
          { name: 'user_segment', type: 'string' },
          { name: 'deposit_amount', type: 'string' },
          { name: 'withdrawal_amount', type: 'string' },
        ],
        data: [
          ['ALL', '3248.0000', '160.0000'],
          ['TOP3', '1160.0000', '60.0000'],
          ['NON_TOP3', '2088.0000', '100.0000'],
        ],
      } as any),
    ).toEqual({
      chartable: true,
      recommendedDisplay: 'CHART',
      reasonCode: null,
      message: null,
    });
  });

  it('routes single-row numeric summaries to number cards', () => {
    expect(
      evaluateChartability({
        columns: [
          { name: 'bet_user_count', type: 'BIGINT' },
          { name: 'bet_order_count', type: 'BIGINT' },
          { name: 'total_valid_bet_amount', type: 'DECIMAL' },
        ],
        data: [[5, 13, '7300.00']],
      } as any),
    ).toEqual({
      chartable: true,
      recommendedDisplay: 'NUMBER_CARD',
      reasonCode: null,
      message: '当前结果为单行汇总指标，已切换为指标卡展示。',
    });
  });
});

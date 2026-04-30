import {
  appendClarificationSlotSummary,
  formatClarificationSlotValues,
} from './clarificationSlotDisplay';

describe('clarificationSlotDisplay', () => {
  it('formats known slot values with user-facing labels', () => {
    expect(
      formatClarificationSlotValues({
        tenant_plat_id: '990001',
        channel_id: '990011',
      }),
    ).toBe('租户平台=990001，渠道=990011');
  });

  it('appends filled slot summary to the display question', () => {
    expect(
      appendClarificationSlotSummary({
        question: '统计渠道990011首充表现',
        slotValues: { tenant_plat_id: '990001' },
      }),
    ).toBe('统计渠道990011首充表现（已补充：租户平台=990001）');
  });

  it('keeps the original question when slot values are empty', () => {
    expect(
      appendClarificationSlotSummary({
        question: '统计渠道990011首充表现',
        slotValues: {},
      }),
    ).toBe('统计渠道990011首充表现');
  });
});

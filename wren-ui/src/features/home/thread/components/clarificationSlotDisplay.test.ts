import {
  appendClarificationSlotSummary,
  coerceClarificationSlotValuesFromText,
  formatClarificationSlotValues,
  mergeClarificationSlotValues,
} from './clarificationSlotDisplay';

describe('clarificationSlotDisplay', () => {
  it('formats known slot values with user-facing labels', () => {
    expect(
      formatClarificationSlotValues({
        tenant_plat_id: '990001',
        channel_id: '990011',
        date_range: {
          start_date: '2026-04-01',
          end_date: '2026-04-07',
        },
      }),
    ).toBe('租户平台=990001，渠道=990011，统计周期=2026-04-01 到 2026-04-07');
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

  it('merges previous and current slot values for multi-turn clarification', () => {
    expect(
      mergeClarificationSlotValues(
        {
          tenant_plat_id: '990001',
          channel_id: '990011',
        },
        {
          date_range: '2026-04-01 到 2026-04-07',
        },
      ),
    ).toEqual({
      tenant_plat_id: '990001',
      channel_id: '990011',
      date_range: '2026-04-01 到 2026-04-07',
    });
  });

  it('keeps previous slot values in the displayed question when a later turn adds new values', () => {
    const mergedSlotValues = mergeClarificationSlotValues(
      {
        tenant_plat_id: '990001',
      },
      {
        period_days: '7',
      },
    );

    expect(mergedSlotValues).toEqual({
      tenant_plat_id: '990001',
      period_days: '7',
    });
    expect(
      appendClarificationSlotSummary({
        question: '统计渠道990011的投放回收',
        slotValues: mergedSlotValues,
      }),
    ).toBe('统计渠道990011的投放回收（已补充：租户平台=990001，回收周期=7）');
  });

  it('coerces a direct single-slot reply into slot values', () => {
    expect(
      coerceClarificationSlotValuesFromText({
        pendingSlots: ['tenant_plat_id'],
        text: '990001',
      }),
    ).toEqual({ tenant_plat_id: '990001' });
  });

  it('extracts explicit slot values from a full sentence', () => {
    expect(
      coerceClarificationSlotValuesFromText({
        pendingSlots: ['tenant_plat_id'],
        text: '统计渠道990011首充用户，租户平台990001',
      }),
    ).toEqual({ tenant_plat_id: '990001' });
  });

  it('does not treat a new natural-language question as an id slot reply', () => {
    expect(
      coerceClarificationSlotValuesFromText({
        pendingSlots: ['tenant_plat_id'],
        text: '推荐几个问题给我',
      }),
    ).toBeNull();
  });
});

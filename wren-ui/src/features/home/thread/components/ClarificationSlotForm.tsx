import { useEffect, useMemo } from 'react';
import { Button, Form, Input, Typography } from 'antd';
import styled from 'styled-components';
import type { AskClarificationState } from '@/types/home';
import {
  formatClarificationSlotValues,
  isExternalDependencySlot,
  normalizeClarificationSlotLabel,
  resolveClarificationSlotPlaceholder,
} from './clarificationSlotDisplay';

const ClarificationPanel = styled.div`
  margin-bottom: 12px;
  border-radius: var(--nova-radius-card);
  border: 1px solid rgba(123, 87, 232, 0.16);
  background: linear-gradient(180deg, #ffffff 0%, #fbfaff 100%);
  box-shadow: var(--nova-shadow-soft);
  padding: 12px 14px;
  min-width: 0;
  overflow: hidden;

  .clarification-slot-form__header {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 8px;
  }

  .clarification-slot-form__title {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .clarification-slot-form__title-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }

  .clarification-slot-form__eyebrow {
    display: inline-flex;
    width: fit-content;
    align-items: center;
    border-radius: var(--nova-radius-chip);
    border: 1px solid rgba(123, 87, 232, 0.18);
    background: var(--nova-primary-soft);
    color: var(--nova-primary-strong);
    font-size: 12px;
    font-weight: 600;
    line-height: 1;
    padding: 5px 9px;
  }

  .clarification-slot-form__headline {
    color: var(--nova-text-primary);
    font-size: 14px;
    line-height: 1.35;
  }

  .clarification-slot-form__description {
    color: var(--nova-text-secondary);
    font-size: 12px;
    line-height: 1.5;
  }

  .clarification-slot-form__slot-summary {
    color: var(--nova-text-muted);
    font-size: 12px;
    line-height: 1.5;
  }

  .clarification-slot-form__question {
    display: flex;
    gap: 6px;
    margin-bottom: 10px;
    border-radius: var(--nova-radius-control);
    border: 1px solid var(--nova-outline-soft);
    background: rgba(255, 255, 255, 0.72);
    padding: 7px 9px;
    color: var(--nova-text-secondary);
    font-size: 12px;
    line-height: 1.5;
  }

  .clarification-slot-form__question-label {
    flex: 0 0 auto;
    color: var(--nova-text-muted);
  }

  .clarification-slot-form__question-text {
    min-width: 0;
    overflow: hidden;
    color: var(--nova-text-primary);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .clarification-slot-form__resolved {
    color: var(--nova-text-secondary);
    font-size: 12px;
    line-height: 1.5;
  }

  .clarification-slot-form__fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(210px, 100%), 1fr));
    gap: 8px 10px;
    align-items: start;
    max-height: min(42vh, 360px);
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-right: 4px;
  }

  .clarification-slot-form__field--external {
    grid-column: 1 / -1;
  }

  &.clarification-slot-form--multi-external
    .clarification-slot-form__field--external {
    grid-column: auto;
  }

  .clarification-slot-form__field--external textarea.ant-input {
    min-height: 58px;
    font-size: 12px;
    line-height: 1.45;
  }

  .ant-form-item {
    margin-bottom: 0;
  }

  .ant-form-item-label {
    padding-bottom: 4px;
  }

  .ant-form-item-label > label {
    height: 20px;
    color: var(--nova-text-primary);
    font-size: 12px;
    font-weight: 600;
  }

  .clarification-slot-form__quick-fills {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
  }

  .clarification-slot-form__quick-fills-label {
    color: var(--nova-text-muted);
    font-size: 12px;
    line-height: 26px;
  }

  .clarification-slot-form__quick-fill {
    height: 26px;
    border-color: var(--nova-outline-soft);
    border-radius: var(--nova-radius-chip);
    background: #ffffff;
    color: var(--nova-text-secondary);
    font-size: 12px;
    padding: 0 10px;
  }

  .clarification-slot-form__quick-fill:hover {
    border-color: rgba(123, 87, 232, 0.32);
    color: var(--nova-primary-strong);
  }

  .clarification-slot-form__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 10px;
  }

  .clarification-slot-form__submit {
    flex: 0 0 auto;
    height: 36px;
    min-width: 116px;
    padding-inline: 16px;
  }

  @media (max-width: 640px) {
    .clarification-slot-form__header {
      flex-direction: column;
    }

    .clarification-slot-form__fields {
      grid-template-columns: 1fr;
      max-height: min(36vh, 300px);
    }

    &.clarification-slot-form--multi-external
      .clarification-slot-form__field--external {
      grid-column: 1 / -1;
    }

    .clarification-slot-form__footer {
      align-items: stretch;
      flex-direction: column;
    }

    .clarification-slot-form__submit {
      width: 100%;
    }
  }
`;

type ClarificationSlotFormProps = {
  clarificationState?: AskClarificationState | null;
  loading?: boolean;
  onSubmit: (slotValues: Record<string, string>) => Promise<void>;
};

type QuickFillPreset = {
  label: string;
  values: Record<string, string>;
};

const buildQuickFillPresets = (pendingSlots: string[]): QuickFillPreset[] => {
  const slotSet = new Set(pendingSlots);
  const presets: QuickFillPreset[] = [];

  if (slotSet.has('start_date') && slotSet.has('end_date')) {
    presets.push({
      label: '示例周期 4/10–4/16',
      values: {
        start_date: '2026-04-10',
        end_date: '2026-04-16',
      },
    });
  }

  if (slotSet.has('cohort_start_date') && slotSet.has('cohort_end_date')) {
    presets.push({
      label: 'Cohort 4/10–4/16',
      values: {
        cohort_start_date: '2026-04-10',
        cohort_end_date: '2026-04-16',
      },
    });
  }

  if (slotSet.has('date_range')) {
    presets.push({
      label: '示例周期 4/10–4/16',
      values: {
        date_range: '2026-04-10 到 2026-04-16',
      },
    });
  }

  if (slotSet.has('tenant_plat_id')) {
    presets.push({
      label: '示例租户 72',
      values: {
        tenant_plat_id: '72',
      },
    });
  }

  if (slotSet.has('channel_id')) {
    presets.push({
      label: '示例渠道 1932',
      values: {
        channel_id: '1932',
      },
    });
  }

  return presets;
};

export default function ClarificationSlotForm({
  clarificationState,
  loading = false,
  onSubmit,
}: ClarificationSlotFormProps) {
  const [form] = Form.useForm<Record<string, string>>();
  const pendingSlots = useMemo(
    () =>
      Array.from(
        new Set((clarificationState?.pendingSlots || []).filter(Boolean)),
      ),
    [clarificationState?.pendingSlots],
  );
  const resolvedSlotSummary = useMemo(
    () => formatClarificationSlotValues(clarificationState?.resolvedSlots),
    [clarificationState?.resolvedSlots],
  );
  const quickFillPresets = useMemo(
    () => buildQuickFillPresets(pendingSlots),
    [pendingSlots],
  );
  const externalSlotCount = useMemo(
    () => pendingSlots.filter(isExternalDependencySlot).length,
    [pendingSlots],
  );

  useEffect(() => {
    form.setFieldsValue(
      Object.fromEntries(
        pendingSlots
          .map((slot) => [slot, clarificationState?.resolvedSlots?.[slot]])
          .filter(([, value]) => value != null && String(value).trim() !== ''),
      ),
    );
  }, [clarificationState?.resolvedSlots, form, pendingSlots]);

  if (
    clarificationState?.status !== 'needs_clarification' ||
    !clarificationState.clarificationSessionId ||
    pendingSlots.length === 0
  ) {
    return null;
  }

  const submit = async () => {
    const values = await form.validateFields();
    await onSubmit(values);
    form.resetFields();
  };

  const pendingSlotCountText = `需要补充 ${pendingSlots.length} 个查询条件`;
  const pendingSlotLabelText = pendingSlots
    .map((slot) => normalizeClarificationSlotLabel(slot))
    .join('、');
  const originalQuestion = clarificationState.originalQuestion?.trim();
  const panelClassName =
    externalSlotCount > 1
      ? 'clarification-slot-form clarification-slot-form--multi-external'
      : 'clarification-slot-form';

  return (
    <ClarificationPanel className={panelClassName}>
      <div className="clarification-slot-form__header">
        <div className="clarification-slot-form__title">
          <div className="clarification-slot-form__title-row">
            <span className="clarification-slot-form__eyebrow">
              需要补充信息
            </span>
            <Typography.Text
              strong
              className="clarification-slot-form__headline"
            >
              {pendingSlotCountText}
            </Typography.Text>
          </div>
          <Typography.Text className="clarification-slot-form__description">
            补充后，系统会继续处理上一条问题。
          </Typography.Text>
        </div>
        <Typography.Text className="clarification-slot-form__slot-summary">
          待补充：{pendingSlotLabelText}
        </Typography.Text>
      </div>
      {originalQuestion ? (
        <div className="clarification-slot-form__question">
          <span className="clarification-slot-form__question-label">
            将继续处理
          </span>
          <span
            className="clarification-slot-form__question-text"
            title={originalQuestion}
          >
            {originalQuestion}
          </span>
        </div>
      ) : null}
      <Form form={form} layout="vertical" requiredMark={false}>
        <div className="clarification-slot-form__fields">
          {pendingSlots.map((slot) => (
            <Form.Item
              key={slot}
              className={
                isExternalDependencySlot(slot)
                  ? 'clarification-slot-form__field--external'
                  : undefined
              }
              name={slot}
              label={normalizeClarificationSlotLabel(slot)}
              rules={[
                {
                  required: true,
                  message: `请填写${normalizeClarificationSlotLabel(slot)}`,
                },
              ]}
            >
              {isExternalDependencySlot(slot) ? (
                <Input.TextArea
                  allowClear
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  placeholder={resolveClarificationSlotPlaceholder(slot)}
                />
              ) : (
                <Input
                  allowClear
                  placeholder={resolveClarificationSlotPlaceholder(slot)}
                />
              )}
            </Form.Item>
          ))}
        </div>
        {quickFillPresets.length ? (
          <div className="clarification-slot-form__quick-fills">
            <span className="clarification-slot-form__quick-fills-label">
              快捷填充
            </span>
            {quickFillPresets.map((preset) => (
              <Button
                key={preset.label}
                type="default"
                size="small"
                disabled={loading}
                className="clarification-slot-form__quick-fill"
                onClick={() => form.setFieldsValue(preset.values)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
        ) : null}
        <div className="clarification-slot-form__footer">
          <div className="clarification-slot-form__resolved">
            {resolvedSlotSummary
              ? `已保留：${resolvedSlotSummary}`
              : '这些条件只会用于继续当前问题，不会新开对话。'}
          </div>
          <Button
            type="primary"
            loading={loading}
            onClick={submit}
            className="clarification-slot-form__submit"
          >
            补充并继续
          </Button>
        </div>
      </Form>
    </ClarificationPanel>
  );
}

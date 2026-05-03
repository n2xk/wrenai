import { useEffect, useMemo } from 'react';
import { Button, Form, Input, Space, Tag, Typography } from 'antd';
import styled from 'styled-components';
import type { AskClarificationState } from '@/types/home';
import {
  formatClarificationSlotValues,
  normalizeClarificationSlotLabel,
  slotPlaceholders,
} from './clarificationSlotDisplay';

const ClarificationPanel = styled.div`
  margin-bottom: 12px;
  border-radius: var(--nova-radius-card);
  border: 1px solid rgba(217, 171, 64, 0.28);
  background: #fffdf5;
  box-shadow: 0 8px 24px rgba(148, 104, 12, 0.08);
  padding: 14px;

  .clarification-slot-form__header {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  .clarification-slot-form__title {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .clarification-slot-form__title-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .clarification-slot-form__description {
    color: #6b7280;
    font-size: 12px;
    line-height: 1.5;
  }

  .clarification-slot-form__resolved {
    margin-bottom: 12px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.72);
    padding: 8px 10px;
    color: #6b7280;
    font-size: 12px;
    line-height: 1.5;
  }

  .clarification-slot-form__fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)) auto;
    gap: 10px;
    align-items: end;
  }

  .ant-form-item {
    margin-bottom: 0;
  }

  .ant-form-item-label {
    padding-bottom: 4px;
  }

  .ant-form-item-label > label {
    height: 20px;
    color: #374151;
    font-size: 12px;
    font-weight: 500;
  }

  .clarification-slot-form__submit {
    margin-bottom: 0;
    min-width: 96px;
  }

  @media (max-width: 640px) {
    .clarification-slot-form__header {
      flex-direction: column;
    }

    .clarification-slot-form__fields {
      grid-template-columns: 1fr;
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

  return (
    <ClarificationPanel className="clarification-slot-form">
      <div className="clarification-slot-form__header">
        <div className="clarification-slot-form__title">
          <div className="clarification-slot-form__title-row">
            <Tag color="gold">需要补充信息</Tag>
            <Typography.Text strong>完善查询条件</Typography.Text>
          </div>
          <Typography.Text className="clarification-slot-form__description">
            系统会带着补充信息继续处理原问题
          </Typography.Text>
        </div>
        <Space size={4} wrap>
          {pendingSlots.map((slot) => (
            <Tag key={slot}>{normalizeClarificationSlotLabel(slot)}</Tag>
          ))}
        </Space>
      </div>
      {resolvedSlotSummary ? (
        <div className="clarification-slot-form__resolved">
          已保留：{resolvedSlotSummary}
        </div>
      ) : null}
      <Form form={form} layout="vertical" requiredMark={false}>
        <div className="clarification-slot-form__fields">
          {pendingSlots.map((slot) => (
            <Form.Item
              key={slot}
              name={slot}
              label={normalizeClarificationSlotLabel(slot)}
              rules={[
                {
                  required: true,
                  message: `请填写${normalizeClarificationSlotLabel(slot)}`,
                },
              ]}
            >
              <Input
                allowClear
                placeholder={slotPlaceholders[slot] || '请输入补充信息'}
              />
            </Form.Item>
          ))}
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

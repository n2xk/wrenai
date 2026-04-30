import { useMemo } from 'react';
import { Button, Form, Input, Space, Tag, Typography } from 'antd';
import styled from 'styled-components';
import type { AskClarificationState } from '@/types/home';
import {
  normalizeClarificationSlotLabel,
  slotPlaceholders,
} from './clarificationSlotDisplay';

const ClarificationPanel = styled.div`
  margin-bottom: 10px;
  border-radius: var(--nova-radius-card);
  border: 1px solid rgba(217, 171, 64, 0.24);
  background: rgba(255, 251, 235, 0.72);
  padding: 10px 12px 8px;

  .clarification-slot-form__header {
    margin-bottom: 8px;
  }

  .clarification-slot-form__fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)) auto;
    gap: 8px;
    align-items: end;
  }

  .ant-form-item {
    margin-bottom: 0;
  }

  .ant-form-item-label {
    padding-bottom: 3px;
  }

  .ant-form-item-label > label {
    height: 18px;
    color: #6b7280;
    font-size: 12px;
  }

  .clarification-slot-form__submit {
    margin-bottom: 0;
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
        <Space size={6} wrap>
          <Tag color="gold">需要补充信息</Tag>
          <Typography.Text type="secondary">
            系统会带着补充信息继续处理原问题
          </Typography.Text>
        </Space>
      </div>
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
                size="small"
                placeholder={slotPlaceholders[slot] || '请输入补充信息'}
              />
            </Form.Item>
          ))}
          <Button
            type="primary"
            size="small"
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

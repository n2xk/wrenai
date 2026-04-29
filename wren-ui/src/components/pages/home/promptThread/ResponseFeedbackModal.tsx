import { useEffect, useState } from 'react';
import { Button, Input, Modal } from 'antd';
import styled from 'styled-components';
import {
  THREAD_RESPONSE_FEEDBACK_REASON_OPTIONS,
  type ThreadResponseFeedbackData,
  type ThreadResponseFeedbackReason,
} from '@/utils/threadResponseFeedbackRest';

const ModalBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

const QuestionLabel = styled.div`
  color: #1f2937;
  font-size: 13px;
  font-weight: 600;
`;

const RequiredMark = styled.span`
  color: #ef4444;
  margin-right: 4px;
`;

const SectionLabel = styled.div`
  color: #667085;
  font-size: 12px;
  font-weight: 500;
`;

const ReasonGrid = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;

const ReasonButton = styled.button<{ $selected?: boolean }>`
  border: 1px solid
    ${(props) =>
      props.$selected ? 'rgba(111, 71, 255, 0.36)' : 'rgba(15, 23, 42, 0.08)'};
  border-radius: var(--nova-radius-chip);
  background: ${(props) =>
    props.$selected ? 'rgba(111, 71, 255, 0.1)' : '#fff'};
  color: ${(props) => (props.$selected ? '#5b36d7' : '#344054')};
  min-height: 30px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    background 0.18s ease,
    color 0.18s ease;

  &:hover {
    border-color: rgba(111, 71, 255, 0.32);
    color: #5b36d7;
  }
`;

const TextareaLabel = styled.div`
  color: #344054;
  font-size: 12px;
  font-weight: 500;
`;

export interface ResponseFeedbackModalProps {
  open: boolean;
  submitting?: boolean;
  feedback?: ThreadResponseFeedbackData | null;
  onClose: () => void;
  onSubmit: (payload: {
    reasonCodes: ThreadResponseFeedbackReason[];
    comment?: string | null;
  }) => Promise<unknown>;
}

export default function ResponseFeedbackModal({
  open,
  submitting,
  feedback,
  onClose,
  onSubmit,
}: ResponseFeedbackModalProps) {
  const [selectedReasons, setSelectedReasons] = useState<
    ThreadResponseFeedbackReason[]
  >([]);
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (!open) return;
    setSelectedReasons(feedback?.reasonCodes || []);
    setComment(feedback?.comment || '');
  }, [feedback?.comment, feedback?.reasonCodes, open]);

  const toggleReason = (reason: ThreadResponseFeedbackReason) => {
    setSelectedReasons((current) =>
      current.includes(reason)
        ? current.filter((item) => item !== reason)
        : [...current, reason],
    );
  };

  const canSubmit = selectedReasons.length > 0 && !submitting;

  return (
    <Modal
      centered
      destroyOnClose
      footer={[
        <Button key="close" onClick={onClose}>
          关闭
        </Button>,
        <Button
          key="submit"
          type="primary"
          loading={submitting}
          disabled={!canSubmit}
          onClick={async () => {
            if (!canSubmit) return;
            await onSubmit({
              reasonCodes: selectedReasons,
              comment,
            });
          }}
        >
          提交反馈
        </Button>,
      ]}
      open={open}
      title="提供更多反馈"
      width={560}
      onCancel={onClose}
    >
      <ModalBody>
        <QuestionLabel>
          <RequiredMark>*</RequiredMark>
          哪些地方不符合预期？
        </QuestionLabel>
        <div>
          <SectionLabel>回答结果</SectionLabel>
          <ReasonGrid className="mt-2">
            {THREAD_RESPONSE_FEEDBACK_REASON_OPTIONS.map((option) => (
              <ReasonButton
                key={option.value}
                $selected={selectedReasons.includes(option.value)}
                type="button"
                onClick={() => toggleReason(option.value)}
              >
                {option.label}
              </ReasonButton>
            ))}
          </ReasonGrid>
        </div>
        <div>
          <TextareaLabel className="mb-2">
            可以补充说明你的期望或问题
          </TextareaLabel>
          <Input.TextArea
            autoSize={{ minRows: 3, maxRows: 6 }}
            placeholder="例如：期望的业务口径、数据范围、SQL 逻辑或图表表现。"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
        </div>
      </ModalBody>
    </Modal>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Button, Input, type InputRef, Modal, Space, Typography } from 'antd';
import PlusOutlined from '@ant-design/icons/PlusOutlined';
import type {
  DashboardQueryControls,
  DashboardTimeFilterAnchor,
  DashboardTimeFilterCandidate,
  DashboardTimeFilterMode,
} from '@/types/home';
import { buildDashboardQueryControls } from '@/utils/dashboardQueryControls';
import ChartAnswerPinTimeControlOptions from './ChartAnswerPinTimeControlOptions';

export default function ChartAnswerPinModal({
  artifactLabel = '当前图表',
  detectedTimeFilter,
  open,
  submitting,
  onCancel,
  onSubmit,
}: {
  artifactLabel?: string;
  detectedTimeFilter?: DashboardTimeFilterCandidate | null;
  open: boolean;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (
    dashboardName: string,
    queryControls?: DashboardQueryControls | null,
  ) => void | Promise<void>;
}) {
  const [dashboardName, setDashboardName] = useState('');
  const [timeFilterMode, setTimeFilterMode] =
    useState<DashboardTimeFilterMode>('fixed');
  const [timeFilterAnchor, setTimeFilterAnchor] =
    useState<DashboardTimeFilterAnchor>('last_complete_day');
  const inputRef = useRef<InputRef>(null);

  useEffect(() => {
    if (!open) {
      setDashboardName('');
      setTimeFilterMode('fixed');
      setTimeFilterAnchor('last_complete_day');
      return;
    }

    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 0);

    return () => clearTimeout(timer);
  }, [open]);

  const canSubmit = dashboardName.trim().length > 0 && !submitting;
  const resolveQueryControls = () =>
    detectedTimeFilter
      ? buildDashboardQueryControls({
          candidate: detectedTimeFilter,
          mode: timeFilterMode,
          anchor: timeFilterAnchor,
        })
      : null;

  return (
    <Modal
      title="新建看板并固定"
      open={open}
      onCancel={onCancel}
      footer={null}
      destroyOnHidden
    >
      <Space orientation="vertical" size={14} style={{ width: '100%' }}>
        <Typography.Text type="secondary">
          创建一个新的工作空间看板，并在创建后立即固定{artifactLabel}。
        </Typography.Text>
        <Input
          ref={inputRef}
          value={dashboardName}
          disabled={submitting}
          placeholder="输入新看板名称，例如：本周经营复盘"
          onChange={(event) => setDashboardName(event.target.value)}
          onPressEnter={() => {
            if (!canSubmit) {
              return;
            }
            void onSubmit(dashboardName, resolveQueryControls());
          }}
        />
        {detectedTimeFilter ? (
          <ChartAnswerPinTimeControlOptions
            anchor={timeFilterAnchor}
            candidate={detectedTimeFilter}
            disabled={submitting}
            mode={timeFilterMode}
            onAnchorChange={setTimeFilterAnchor}
            onModeChange={setTimeFilterMode}
          />
        ) : (
          <Typography.Text type="secondary">
            未识别到可安全滚动的日期范围，本次固定后将按当前 SQL 固定刷新。
          </Typography.Text>
        )}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
          }}
        >
          <Button disabled={submitting} onClick={onCancel}>
            取消
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            loading={submitting}
            disabled={!canSubmit}
            onClick={() => {
              void onSubmit(dashboardName, resolveQueryControls());
            }}
          >
            新建并固定
          </Button>
        </div>
      </Space>
    </Modal>
  );
}

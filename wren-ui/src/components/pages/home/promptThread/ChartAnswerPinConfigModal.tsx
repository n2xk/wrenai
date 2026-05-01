import { useEffect, useState } from 'react';
import { Button, Modal, Space, Typography } from 'antd';
import PushPinOutlined from '@ant-design/icons/PushpinOutlined';
import type {
  DashboardQueryControls,
  DashboardTimeFilterAnchor,
  DashboardTimeFilterCandidate,
  DashboardTimeFilterMode,
} from '@/types/home';
import { buildDashboardQueryControls } from '@/utils/dashboardQueryControls';
import ChartAnswerPinTimeControlOptions from './ChartAnswerPinTimeControlOptions';

export default function ChartAnswerPinConfigModal({
  artifactLabel = '当前图表',
  dashboardName,
  detectedTimeFilter,
  open,
  submitting,
  onCancel,
  onSubmit,
}: {
  artifactLabel?: string;
  dashboardName?: string | null;
  detectedTimeFilter: DashboardTimeFilterCandidate | null;
  open: boolean;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (queryControls: DashboardQueryControls) => void | Promise<void>;
}) {
  const [timeFilterMode, setTimeFilterMode] =
    useState<DashboardTimeFilterMode>('rolling_window');
  const [timeFilterAnchor, setTimeFilterAnchor] =
    useState<DashboardTimeFilterAnchor>('last_complete_day');

  useEffect(() => {
    if (!open) {
      return;
    }
    setTimeFilterMode('rolling_window');
    setTimeFilterAnchor('last_complete_day');
  }, [detectedTimeFilter, open]);

  const canSubmit = Boolean(detectedTimeFilter) && !submitting;

  return (
    <Modal
      title="固定到看板"
      open={open}
      onCancel={onCancel}
      footer={null}
      destroyOnHidden
    >
      <Space orientation="vertical" size={14} style={{ width: '100%' }}>
        <Typography.Text type="secondary">
          将{artifactLabel}
          {dashboardName ? `固定到看板「${dashboardName}」` : '固定到看板'}
          ，并设置看板刷新时的日期行为。
        </Typography.Text>

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
            icon={<PushPinOutlined />}
            loading={submitting}
            disabled={!canSubmit}
            onClick={() => {
              if (!detectedTimeFilter) {
                return;
              }
              void onSubmit(
                buildDashboardQueryControls({
                  candidate: detectedTimeFilter,
                  mode: timeFilterMode,
                  anchor: timeFilterAnchor,
                }),
              );
            }}
          >
            固定到看板
          </Button>
        </div>
      </Space>
    </Modal>
  );
}

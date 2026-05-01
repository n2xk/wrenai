import { Radio, Space, Typography } from 'antd';
import type {
  DashboardTimeFilterAnchor,
  DashboardTimeFilterCandidate,
  DashboardTimeFilterMode,
} from '@/types/home';
import {
  buildDashboardQueryControls,
  calculateDashboardTimeFilterWindow,
  getDashboardTimeFilterDisplayEndDate,
} from '@/utils/dashboardQueryControls';

export default function ChartAnswerPinTimeControlOptions({
  anchor,
  candidate,
  disabled,
  mode,
  onAnchorChange,
  onModeChange,
}: {
  anchor: DashboardTimeFilterAnchor;
  candidate: DashboardTimeFilterCandidate;
  disabled?: boolean;
  mode: DashboardTimeFilterMode;
  onAnchorChange: (anchor: DashboardTimeFilterAnchor) => void;
  onModeChange: (mode: DashboardTimeFilterMode) => void;
}) {
  const originalDisplayEndDate = getDashboardTimeFilterDisplayEndDate({
    endDate: candidate.originalEndDate,
    kind: candidate.sqlBinding.kind,
  });
  const previewFilter = buildDashboardQueryControls({
    candidate,
    mode: 'rolling_window',
    anchor,
  }).timeFilters?.[0];
  const rollingWindow = previewFilter
    ? calculateDashboardTimeFilterWindow(previewFilter)
    : null;
  const rollingDisplayEndDate = rollingWindow
    ? getDashboardTimeFilterDisplayEndDate({
        endDate: rollingWindow.endDate,
        kind: candidate.sqlBinding.kind,
      })
    : null;

  return (
    <Space orientation="vertical" size={12} style={{ width: '100%' }}>
      <Typography.Text strong>数据时间范围</Typography.Text>
      <Radio.Group
        disabled={disabled}
        value={mode}
        onChange={(event) => onModeChange(event.target.value)}
      >
        <Space orientation="vertical" size={12}>
          <Radio value="fixed">
            <Space orientation="vertical" size={2}>
              <Typography.Text>固定当前日期范围</Typography.Text>
              <Typography.Text type="secondary">
                始终查询 {candidate.originalStartDate} 至{' '}
                {originalDisplayEndDate}
              </Typography.Text>
            </Space>
          </Radio>
          <Radio value="rolling_window">
            <Space orientation="vertical" size={2}>
              <Typography.Text>随时间自动滚动</Typography.Text>
              <Typography.Text type="secondary">
                保持 {candidate.windowDays} 天窗口，随看板刷新自动后移。
              </Typography.Text>
            </Space>
          </Radio>
        </Space>
      </Radio.Group>

      {mode === 'rolling_window' ? (
        <Space orientation="vertical" size={8} style={{ width: '100%' }}>
          <Typography.Text strong>滚动基准</Typography.Text>
          <Radio.Group
            disabled={disabled}
            value={anchor}
            onChange={(event) => onAnchorChange(event.target.value)}
          >
            <Radio.Button value="last_complete_day">到昨天</Radio.Button>
            <Radio.Button value="today">到今天</Radio.Button>
          </Radio.Group>
          {rollingWindow && rollingDisplayEndDate ? (
            <Typography.Text type="secondary">
              预览：本次刷新会查询 {rollingWindow.startDate} 至{' '}
              {rollingDisplayEndDate}
            </Typography.Text>
          ) : null}
        </Space>
      ) : null}
    </Space>
  );
}

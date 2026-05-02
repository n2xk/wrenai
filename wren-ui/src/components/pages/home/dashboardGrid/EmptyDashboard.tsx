import { Empty } from 'antd';
import styled from 'styled-components';

const EmptyDashboardShell = styled.div`
  height: 100%;
  min-height: 360px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  box-sizing: border-box;

  .ant-empty {
    margin: 0;
  }

  .ant-empty-description {
    color: #667085;
  }
`;

const EmptyDashboardDescription = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: center;
`;

const EmptyDashboardTitle = styled.div`
  color: #2b3140;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.45;
`;

const EmptyDashboardHint = styled.div`
  color: #667085;
  font-size: 13px;
  line-height: 1.55;
`;

const EmptyDashboard = (props: {
  show: boolean;
  children: React.ReactNode;
}) => {
  const { show, children } = props;
  if (show) {
    return (
      <EmptyDashboardShell>
        <Empty
          description={
            <EmptyDashboardDescription>
              <EmptyDashboardTitle>还没有加入任何图表</EmptyDashboardTitle>
              <EmptyDashboardHint>
                可在对话中生成图表，然后使用“固定到看板”保存到这里。
              </EmptyDashboardHint>
            </EmptyDashboardDescription>
          }
        />
      </EmptyDashboardShell>
    );
  }
  return <>{children}</>;
};

export default EmptyDashboard;

import { Button, Space, Tooltip } from 'antd';
import CloseOutlined from '@ant-design/icons/CloseOutlined';
import styled from 'styled-components';
import type { WorkbenchArtifactKind } from '@/features/home/thread/threadWorkbenchState';
import { useThreadWorkbenchMessages } from '@/features/home/thread/threadWorkbenchMessages';

export type ThreadWorkbenchHeaderActionModel = {
  showCloseOnly: boolean;
};

export const resolveThreadWorkbenchHeaderActionModel = ({
  activeArtifact,
}: {
  activeArtifact: WorkbenchArtifactKind;
}): ThreadWorkbenchHeaderActionModel => ({
  showCloseOnly:
    activeArtifact === 'preview' ||
    activeArtifact === 'sql' ||
    activeArtifact === 'chart',
});

const HeaderActionShell = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;

  .thread-workbench-action-btn {
    width: 30px;
    height: 30px;
    min-width: 30px;
    color: #4b5563;
    border-radius: var(--nova-radius-chip);
  }
`;

export default function ThreadWorkbenchHeaderActions(props: {
  activeArtifact: WorkbenchArtifactKind;
  onClose: () => void;
}) {
  const { activeArtifact, onClose } = props;
  const messages = useThreadWorkbenchMessages();
  const closeButton = (
    <Tooltip title={messages.close}>
      <Button
        aria-label={messages.close}
        className="thread-workbench-action-btn"
        icon={<CloseOutlined />}
        shape="circle"
        type="text"
        onClick={onClose}
      />
    </Tooltip>
  );

  if (activeArtifact === 'preview') {
    return (
      <HeaderActionShell>
        <Space size={8}>{closeButton}</Space>
      </HeaderActionShell>
    );
  }

  if (activeArtifact === 'sql') {
    return (
      <HeaderActionShell>
        <Space size={8}>{closeButton}</Space>
      </HeaderActionShell>
    );
  }

  return (
    <HeaderActionShell>
      <Space size={8}>{closeButton}</Space>
    </HeaderActionShell>
  );
}

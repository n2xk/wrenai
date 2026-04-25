import { useCallback } from 'react';
import { appModal } from '@/utils/antdAppBridge';

const DEFAULT_TITLE = '返回建模页面？';
const DEFAULT_DESCRIPTION =
  '离开当前页面后，未保存的进度将会丢失，且无法恢复。';

export default function useModelingAssistantLeaveGuard({
  onLeave,
}: {
  onLeave: () => void | Promise<void>;
}) {
  const confirmLeave = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        appModal.confirm({
          title: DEFAULT_TITLE,
          content: DEFAULT_DESCRIPTION,
          okText: '返回',
          cancelText: '取消',
          onOk: async () => {
            await onLeave();
            resolve(true);
          },
          onCancel: () => resolve(false),
        });
      }),
    [onLeave],
  );

  const onBackClick = useCallback(() => {
    void confirmLeave();
  }, [confirmLeave]);

  return {
    confirmLeave,
    onBackClick,
  };
}

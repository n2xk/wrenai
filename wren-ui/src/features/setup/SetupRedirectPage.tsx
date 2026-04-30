import { useEffect } from 'react';
import { Spin, Typography } from 'antd';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { Path } from '@/utils/enum';
import { buildKnowledgeWorkbenchParams } from '@/utils/knowledgeWorkbench';

type SetupRedirectPageProps = {
  openAssetWizard?: boolean;
};

export default function SetupRedirectPage({
  openAssetWizard = false,
}: SetupRedirectPageProps) {
  const { replace } = useRuntimeScopeNavigation();

  useEffect(() => {
    replace(
      Path.Knowledge,
      openAssetWizard
        ? { openAssetWizard: true }
        : buildKnowledgeWorkbenchParams('modeling'),
    ).catch(() => null);
  }, [openAssetWizard, replace]);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
      }}
    >
      <Spin />
      <Typography.Text type="secondary">正在进入知识库工作台…</Typography.Text>
    </div>
  );
}

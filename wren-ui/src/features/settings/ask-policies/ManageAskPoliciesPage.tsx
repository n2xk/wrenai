import { useEffect } from 'react';
import { Spin } from 'antd';

import DirectShellPageFrame from '@/components/reference/DirectShellPageFrame';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { Path } from '@/utils/enum';

export default function RedirectAskPoliciesPage() {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const runtimeScopePage = useProtectedRuntimeScopePage();

  useEffect(() => {
    if (runtimeScopePage.guarding) {
      return;
    }

    runtimeScopeNavigation
      .replace(Path.Knowledge, { section: 'askPolicies' })
      .catch(() => null);
  }, [runtimeScopeNavigation, runtimeScopePage.guarding]);

  return (
    <DirectShellPageFrame activeNav="knowledge" stretchContent>
      <div
        style={{
          minHeight: 280,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Spin tip="正在打开知识库问数策略" />
      </div>
    </DirectShellPageFrame>
  );
}

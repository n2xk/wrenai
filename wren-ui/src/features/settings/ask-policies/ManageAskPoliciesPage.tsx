import { useMemo } from 'react';
import { useRouter } from 'next/router';

import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
import AskPoliciesManager from '@/features/askPolicies/AskPoliciesManager';
import useAuthSession from '@/hooks/useAuthSession';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { readRuntimeScopeSelectorFromObject } from '@/runtime/client/runtimeScope';
import { buildSettingsConsoleShellProps } from '@/features/settings/settingsShell';
import { resolvePlatformManagementFromAuthSession } from '@/features/settings/settingsPageCapabilities';

export default function ManageAskPoliciesPage() {
  const router = useRouter();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const authSession = useAuthSession();
  const showPlatformManagement = resolvePlatformManagementFromAuthSession(
    authSession.data,
  );
  const runtimeScopeSelector = useMemo(
    () => readRuntimeScopeSelectorFromObject(router.query),
    [router.query],
  );
  const shellProps = {
    title: '问数策略',
    ...buildSettingsConsoleShellProps({
      activeKey: 'settingsAskPolicies',
      onNavigate: runtimeScopeNavigation.pushWorkspace,
      showPlatformAdmin: showPlatformManagement,
    }),
  } as const;

  return (
    <ConsoleShellLayout {...shellProps}>
      <AskPoliciesManager
        runtimeScopeSelector={runtimeScopeSelector}
        hasRuntimeScope={runtimeScopePage.hasRuntimeScope}
        routerReady={router.isReady}
      />
    </ConsoleShellLayout>
  );
}

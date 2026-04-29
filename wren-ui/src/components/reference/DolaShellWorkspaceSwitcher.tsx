import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { Popover } from 'antd';
import CheckOutlined from '@ant-design/icons/CheckOutlined';
import DownOutlined from '@ant-design/icons/DownOutlined';
import styled from 'styled-components';
import useRuntimeScopeTransition from '@/hooks/useRuntimeScopeTransition';
import useRuntimeSelectorState from '@/hooks/useRuntimeSelectorState';
import {
  buildRuntimeScopeSelectorFromRuntimeSelectorState,
  buildRuntimeScopeUrl,
  omitRuntimeScopeQuery,
  type ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import {
  buildRuntimeSelectorStateUrl,
  fetchRuntimeSelectorState,
  type RuntimeSelectorState,
} from '@/hooks/runtimeSelectorStateRequest';
import { Path } from '@/utils/enum';
import { getReferenceDisplayWorkspaceName } from '@/utils/referenceDemoKnowledge';

const SidebarWorkspaceSwitcher = styled.div`
  width: 100%;
  min-width: 0;
  padding: 0;
`;

const WorkspaceTrigger = styled.button<{
  $disabled?: boolean;
  $open?: boolean;
}>`
  width: 100%;
  min-width: 0;
  min-height: 42px;
  box-sizing: border-box;
  border: 0;
  border-radius: var(--nova-radius-control);
  background: ${(props) =>
    props.$open ? 'rgba(123, 87, 232, 0.055)' : 'transparent'};
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 9px;
  text-align: left;
  cursor: ${(props) => (props.$disabled ? 'default' : 'pointer')};
  overflow: hidden;
  transition:
    background 0.18s ease,
    color 0.18s ease;

  &:hover,
  &:focus-visible {
    outline: none;
    background: ${(props) =>
      props.$disabled ? 'transparent' : 'rgba(241, 245, 249, 0.62)'};
  }
`;

const WorkspaceTriggerContent = styled.div`
  min-width: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
`;

const WorkspaceTriggerLabel = styled.span`
  display: block;
  max-width: 100%;
  color: #a3acba;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.04em;
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const WorkspaceTriggerTitle = styled.span`
  display: block;
  max-width: 100%;
  color: #334155;
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.22;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const WorkspacePopoverContent = styled.div`
  min-width: 236px;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const WorkspaceOption = styled.button<{ $active?: boolean }>`
  width: 100%;
  border: 1px solid
    ${(props) =>
      props.$active ? 'rgba(79, 70, 229, 0.24)' : 'rgba(15, 23, 42, 0.06)'};
  border-radius: var(--nova-radius-card);
  background: ${(props) =>
    props.$active ? 'rgba(79, 70, 229, 0.06)' : '#ffffff'};
  padding: 10px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  cursor: ${(props) => (props.$active ? 'default' : 'pointer')};
  text-align: left;
  transition:
    background 0.18s ease,
    border-color 0.18s ease;

  &:hover,
  &:focus-visible {
    outline: none;
    border-color: rgba(79, 70, 229, 0.18);
    background: rgba(79, 70, 229, 0.04);
  }
`;

const WorkspaceOptionText = styled.div`
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
`;

const WorkspaceOptionTitle = styled.span`
  display: block;
  max-width: 100%;
  color: #111827;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const WorkspaceOptionCheck = styled.span`
  color: #4338ca;
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
`;

export const resolveWorkspaceSwitchTargetPath = (pathname: string) =>
  pathname === Path.Thread
    ? Path.Home
    : pathname === Path.HomeSpreadsheet
      ? Path.HomeSpreadsheets
      : pathname;

export const shouldDropWorkspaceSwitchRouteParams = (pathname: string) =>
  pathname === Path.HomeDashboard || pathname === Path.HomeSpreadsheet;

export const resolveWorkspaceSwitchTargetParams = ({
  pathname,
  targetPath,
  baseParams,
}: {
  pathname: string;
  targetPath: string;
  baseParams: Record<string, any>;
}) => {
  if (shouldDropWorkspaceSwitchRouteParams(pathname)) {
    return {};
  }

  return targetPath === pathname ? baseParams : {};
};

export const buildWorkspaceRuntimeSelectorFromState = ({
  workspaceId,
  runtimeSelectorState,
}: {
  workspaceId: string;
  runtimeSelectorState?: RuntimeSelectorState | null;
}): ClientRuntimeScopeSelector => {
  const fallbackSelector = { workspaceId };

  if (runtimeSelectorState?.currentWorkspace?.id !== workspaceId) {
    return fallbackSelector;
  }

  const selectorFromState =
    buildRuntimeScopeSelectorFromRuntimeSelectorState(runtimeSelectorState);

  return selectorFromState.workspaceId === workspaceId
    ? selectorFromState
    : fallbackSelector;
};

export const shouldUseStableWorkspaceSelectorState = ({
  selectorState,
  stableSelectorState,
}: {
  selectorState?: RuntimeSelectorState | null;
  stableSelectorState?: RuntimeSelectorState | null;
}) => !selectorState?.currentWorkspace && Boolean(stableSelectorState);

export default function DolaShellWorkspaceSwitcher() {
  const router = useRouter();
  const runtimeScopeTransition = useRuntimeScopeTransition();
  const runtimeSelector = useRuntimeSelectorState();
  const selectorState = runtimeSelector.runtimeSelectorState;
  const stableSelectorStateRef = useRef<RuntimeSelectorState | null>(null);
  const pendingWorkspaceSelectorAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const [resolvingWorkspaceId, setResolvingWorkspaceId] = useState<
    string | null
  >(null);
  const displaySelectorState = shouldUseStableWorkspaceSelectorState({
    selectorState,
    stableSelectorState: stableSelectorStateRef.current,
  })
    ? stableSelectorStateRef.current
    : selectorState;
  const currentWorkspace = displaySelectorState?.currentWorkspace;
  const workspaces = displaySelectorState?.workspaces || [];
  const baseParams = useMemo(
    () => omitRuntimeScopeQuery(router.query),
    [router.query],
  );
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (selectorState?.currentWorkspace) {
      stableSelectorStateRef.current = selectorState;
    }
  }, [selectorState]);

  useEffect(
    () => () => {
      mountedRef.current = false;
      pendingWorkspaceSelectorAbortRef.current?.abort();
    },
    [],
  );

  const resolveWorkspaceSwitchSelector = useCallback(
    async (workspaceId: string): Promise<ClientRuntimeScopeSelector> => {
      const fallbackSelector = { workspaceId };

      pendingWorkspaceSelectorAbortRef.current?.abort();
      const abortController = new AbortController();
      pendingWorkspaceSelectorAbortRef.current = abortController;
      setResolvingWorkspaceId(workspaceId);

      try {
        const runtimeSelectorState = await fetchRuntimeSelectorState({
          requestUrl: buildRuntimeSelectorStateUrl(fallbackSelector),
          signal: abortController.signal,
        });

        return buildWorkspaceRuntimeSelectorFromState({
          workspaceId,
          runtimeSelectorState,
        });
      } catch (_error) {
        return fallbackSelector;
      } finally {
        if (
          mountedRef.current &&
          pendingWorkspaceSelectorAbortRef.current === abortController
        ) {
          pendingWorkspaceSelectorAbortRef.current = null;
          setResolvingWorkspaceId(null);
        }
      }
    },
    [],
  );

  if (!displaySelectorState || !currentWorkspace) {
    return null;
  }

  const selectorRefreshing =
    selectorState !== displaySelectorState || !selectorState?.currentWorkspace;
  const disabled =
    selectorRefreshing ||
    runtimeSelector.initialLoading ||
    runtimeScopeTransition.transitioning ||
    Boolean(resolvingWorkspaceId) ||
    workspaces.length <= 1;
  const currentWorkspaceName = getReferenceDisplayWorkspaceName(
    currentWorkspace.name,
  );

  const handleWorkspaceSelect = async (workspaceId: string) => {
    if (!workspaceId || workspaceId === currentWorkspace.id || disabled) {
      setOpen(false);
      return;
    }

    setOpen(false);
    const workspaceSelector = await resolveWorkspaceSwitchSelector(workspaceId);
    if (!mountedRef.current) {
      return;
    }

    const targetPath = resolveWorkspaceSwitchTargetPath(router.pathname);
    const targetParams = resolveWorkspaceSwitchTargetParams({
      pathname: router.pathname,
      targetPath,
      baseParams,
    });
    const nextUrl = buildRuntimeScopeUrl(
      targetPath,
      targetParams,
      workspaceSelector,
    );
    void runtimeScopeTransition.transitionTo(nextUrl);
  };

  return (
    <SidebarWorkspaceSwitcher data-testid="shell-workspace-switcher">
      <Popover
        trigger="click"
        placement="bottomLeft"
        open={disabled ? false : open}
        onOpenChange={(nextOpen) => {
          if (!disabled) {
            setOpen(nextOpen);
          }
        }}
        content={
          <WorkspacePopoverContent>
            {workspaces.map((workspace) => {
              const workspaceName = getReferenceDisplayWorkspaceName(
                workspace.name,
              );
              const active = workspace.id === currentWorkspace.id;

              return (
                <WorkspaceOption
                  key={workspace.id}
                  type="button"
                  $active={active}
                  aria-label={`切换到 ${workspaceName}`}
                  title={workspaceName}
                  onClick={() => {
                    void handleWorkspaceSelect(workspace.id);
                  }}
                >
                  <WorkspaceOptionText>
                    <WorkspaceOptionTitle>{workspaceName}</WorkspaceOptionTitle>
                  </WorkspaceOptionText>
                  {active ? (
                    <WorkspaceOptionCheck>
                      <CheckOutlined />
                    </WorkspaceOptionCheck>
                  ) : null}
                </WorkspaceOption>
              );
            })}
          </WorkspacePopoverContent>
        }
      >
        <WorkspaceTrigger
          type="button"
          $disabled={disabled}
          $open={open}
          aria-label="切换工作空间"
          aria-expanded={open}
          aria-disabled={disabled}
          title={currentWorkspaceName}
        >
          <WorkspaceTriggerContent>
            <WorkspaceTriggerLabel>当前工作空间</WorkspaceTriggerLabel>
            <WorkspaceTriggerTitle>
              {currentWorkspaceName}
            </WorkspaceTriggerTitle>
          </WorkspaceTriggerContent>
          <DownOutlined
            style={{
              color: '#9ca3af',
              flexShrink: 0,
              fontSize: 10.5,
              transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.18s ease',
            }}
          />
        </WorkspaceTrigger>
      </Popover>
    </SidebarWorkspaceSwitcher>
  );
}

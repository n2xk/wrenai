import {
  buildWorkspaceRuntimeSelectorFromState,
  resolveWorkspaceSwitchTargetPath,
  resolveWorkspaceSwitchTargetParams,
  shouldUseStableWorkspaceSelectorState,
} from './DolaShellWorkspaceSwitcher';

jest.mock('antd', () => ({
  Popover: ({ children }: any) => children,
}));

describe('DolaShellWorkspaceSwitcher helpers', () => {
  it('leaves workspace switches on the current page except thread routes', () => {
    expect(resolveWorkspaceSwitchTargetPath('/knowledge')).toBe('/knowledge');
    expect(resolveWorkspaceSwitchTargetPath('/home/[id]')).toBe('/home');
    expect(resolveWorkspaceSwitchTargetPath('/home/spreadsheets/[id]')).toBe(
      '/home/spreadsheets',
    );
  });

  it('drops stale asset ids when switching workspace from asset pages', () => {
    expect(
      resolveWorkspaceSwitchTargetParams({
        pathname: '/home/dashboard',
        targetPath: '/home/dashboard',
        baseParams: { dashboardId: '8' },
      }),
    ).toEqual({});

    expect(
      resolveWorkspaceSwitchTargetParams({
        pathname: '/home/spreadsheets/[id]',
        targetPath: '/home/spreadsheets',
        baseParams: { id: '19' },
      }),
    ).toEqual({});

    expect(
      resolveWorkspaceSwitchTargetParams({
        pathname: '/knowledge',
        targetPath: '/knowledge',
        baseParams: { section: 'sqlTemplates' },
      }),
    ).toEqual({ section: 'sqlTemplates' });
  });

  it('builds a full runtime selector from the resolved workspace state', () => {
    expect(
      buildWorkspaceRuntimeSelectorFromState({
        workspaceId: 'ws-2',
        runtimeSelectorState: {
          currentWorkspace: {
            id: 'ws-2',
            slug: 'workspace-2',
            name: 'Workspace 2',
          },
          workspaces: [],
          currentKnowledgeBase: {
            id: 'kb-2',
            slug: 'knowledge-2',
            name: 'Knowledge 2',
          },
          currentKbSnapshot: {
            id: 'snap-2',
            snapshotKey: 'snapshot-2',
            displayName: 'Snapshot 2',
            deployHash: 'deploy-2',
            status: 'active',
          },
          knowledgeBases: [],
          kbSnapshots: [],
        },
      }),
    ).toEqual({
      workspaceId: 'ws-2',
      knowledgeBaseId: 'kb-2',
      kbSnapshotId: 'snap-2',
      deployHash: 'deploy-2',
    });
  });

  it('falls back to workspace-only selector when fetched state is missing or mismatched', () => {
    expect(
      buildWorkspaceRuntimeSelectorFromState({
        workspaceId: 'ws-2',
        runtimeSelectorState: null,
      }),
    ).toEqual({ workspaceId: 'ws-2' });

    expect(
      buildWorkspaceRuntimeSelectorFromState({
        workspaceId: 'ws-2',
        runtimeSelectorState: {
          currentWorkspace: {
            id: 'ws-1',
            slug: 'workspace-1',
            name: 'Workspace 1',
          },
          workspaces: [],
          currentKnowledgeBase: null,
          currentKbSnapshot: null,
          knowledgeBases: [],
          kbSnapshots: [],
        },
      }),
    ).toEqual({ workspaceId: 'ws-2' });
  });

  it('uses the last stable selector state while the current selector is refreshing', () => {
    expect(
      shouldUseStableWorkspaceSelectorState({
        selectorState: null,
        stableSelectorState: {
          currentWorkspace: {
            id: 'ws-1',
            slug: 'workspace-1',
            name: 'Workspace 1',
          },
          workspaces: [],
          currentKnowledgeBase: null,
          currentKbSnapshot: null,
          knowledgeBases: [],
          kbSnapshots: [],
        },
      }),
    ).toBe(true);

    expect(
      shouldUseStableWorkspaceSelectorState({
        selectorState: {
          currentWorkspace: {
            id: 'ws-2',
            slug: 'workspace-2',
            name: 'Workspace 2',
          },
          workspaces: [],
          currentKnowledgeBase: null,
          currentKbSnapshot: null,
          knowledgeBases: [],
          kbSnapshots: [],
        },
        stableSelectorState: null,
      }),
    ).toBe(false);
  });
});

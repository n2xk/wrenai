import { AskingService } from '../askingService';

describe('AskingService', () => {
  describe('createAskingTask', () => {
    it('fails fast when canonical first asks have neither deployHash nor a legacy project bridge', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadRepository = {
        findOneBy: jest.fn(),
      };
      service.askingTaskTracker = {
        createAskingTask: jest.fn(),
      };
      service.getAskingHistory = jest.fn();
      service.getDeployId =
        AskingService.prototype['getDeployId'].bind(service);
      service.resolveAskingRuntimeIdentity =
        AskingService.prototype['resolveAskingRuntimeIdentity'].bind(service);
      service.buildPersistedRuntimeIdentityPatch =
        AskingService.prototype['buildPersistedRuntimeIdentityPatch'].bind(
          service,
        );
      service.deployService = {
        getLastDeploymentByRuntimeIdentity: jest.fn().mockResolvedValue(null),
      };

      await expect(
        service.createAskingTask(
          { question: 'fresh ask without deploy hash' },
          {
            runtimeIdentity: {
              projectId: null,
              workspaceId: 'workspace-1',
              knowledgeBaseId: 'kb-1',
              kbSnapshotId: 'snapshot-1',
              deployHash: null,
              actorUserId: 'user-1',
            },
            language: 'en',
          },
        ),
      ).rejects.toThrow(
        'No deployment found, please deploy your project first',
      );

      expect(
        service.deployService.getLastDeploymentByRuntimeIdentity,
      ).toHaveBeenCalledWith({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: null,
        actorUserId: 'user-1',
      });
      expect(service.askingTaskTracker.createAskingTask).not.toHaveBeenCalled();
    });

    it('uses thread runtime identity to resolve deployment for follow-up asks without persisted deploy hash', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadRepository = {
        findOneBy: jest.fn().mockResolvedValue({
          id: 101,
          projectId: 42,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: null,
          actorUserId: 'user-1',
        }),
      };
      service.askingTaskTracker = {
        createAskingTask: jest.fn().mockResolvedValue({ queryId: 'query-3' }),
      };
      service.getAskingHistory = jest.fn().mockResolvedValue([]);
      service.getDeployId =
        AskingService.prototype['getDeployId'].bind(service);
      service.deployService = {
        getLastDeploymentByRuntimeIdentity: jest
          .fn()
          .mockResolvedValue({ hash: 'deploy-3' }),
      };

      await service.createAskingTask(
        { question: 'follow up without deploy hash' },
        {
          threadId: 101,
          runtimeIdentity: {
            projectId: 999,
            workspaceId: 'workspace-other',
            knowledgeBaseId: 'kb-other',
            kbSnapshotId: 'snapshot-other',
            deployHash: 'deploy-other',
            actorUserId: 'user-other',
          },
          language: 'en',
        },
      );

      expect(
        service.deployService.getLastDeploymentByRuntimeIdentity,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          actorUserId: 'user-1',
        }),
      );
      expect(service.askingTaskTracker.createAskingTask).toHaveBeenCalledWith(
        expect.objectContaining({
          deployId: 'deploy-3',
          runtimeIdentity: expect.objectContaining({
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            deployHash: 'deploy-3',
            actorUserId: 'user-1',
          }),
        }),
      );
    });

    it('includes compatible broader SQL history when scoped follow-up history is empty', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadRepository = {
        findOneBy: jest.fn().mockResolvedValue({
          id: 107,
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: null,
          kbSnapshotId: null,
          deployHash: 'deploy-5',
          actorUserId: 'user-1',
        }),
      };
      service.threadResponseRepository = {
        getResponsesWithThreadByScope: jest.fn().mockResolvedValue([]),
        getResponsesWithThread: jest.fn().mockResolvedValue([
          {
            id: 153,
            threadId: 107,
            question:
              '统计租户平台990001下渠道990011在2026-04-01到2026-04-03首存cohort从D1到D7的累计收入',
            sql: 'SELECT 42 AS cumulative_revenue',
            projectId: null,
            workspaceId: 'workspace-1',
            knowledgeBaseId: null,
            kbSnapshotId: null,
            deployHash: 'deploy-5',
            actorUserId: 'user-1',
          },
        ]),
      };
      service.askingTaskTracker = {
        createAskingTask: jest.fn().mockResolvedValue({ queryId: 'query-5' }),
      };
      service.getAskingHistory =
        AskingService.prototype['getAskingHistory'].bind(service);
      service.getDeployId =
        AskingService.prototype['getDeployId'].bind(service);
      service.deployService = {
        getLastDeploymentByRuntimeIdentity: jest
          .fn()
          .mockResolvedValue({ hash: 'deploy-5' }),
      };

      await service.createAskingTask(
        { question: '那只看 2026-04-02 的首存 cohort 呢？' },
        {
          threadId: 107,
          runtimeIdentity: {
            projectId: null,
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            deployHash: 'deploy-5',
            actorUserId: 'user-1',
          },
          language: 'en',
        },
      );

      expect(
        service.threadResponseRepository.getResponsesWithThread,
      ).toHaveBeenCalledWith(107, 10);
      expect(service.askingTaskTracker.createAskingTask).toHaveBeenCalledWith(
        expect.objectContaining({
          histories: [
            expect.objectContaining({
              id: 153,
              sql: 'SELECT 42 AS cumulative_revenue',
              question:
                '统计租户平台990001下渠道990011在2026-04-01到2026-04-03首存cohort从D1到D7的累计收入',
            }),
          ],
        }),
      );
    });

    it('falls back to payload runtime identity when follow-up thread uses legacy-null project bridge', async () => {
      const service = Object.create(AskingService.prototype) as any;
      service.threadRepository = {
        findOneBy: jest.fn().mockResolvedValue({
          id: 101,
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: null,
          actorUserId: null,
        }),
      };
      service.askingTaskTracker = {
        createAskingTask: jest.fn().mockResolvedValue({ queryId: 'query-4' }),
      };
      service.getAskingHistory = jest.fn().mockResolvedValue([]);
      service.getDeployId =
        AskingService.prototype['getDeployId'].bind(service);
      service.deployService = {
        getLastDeploymentByRuntimeIdentity: jest
          .fn()
          .mockResolvedValue({ hash: 'deploy-4' }),
      };

      await service.createAskingTask(
        { question: 'follow up through legacy-null thread project' },
        {
          threadId: 101,
          runtimeIdentity: {
            projectId: 42,
            workspaceId: 'workspace-fallback',
            knowledgeBaseId: 'kb-fallback',
            kbSnapshotId: 'snapshot-fallback',
            deployHash: null,
            actorUserId: 'user-fallback',
          },
          language: 'en',
        },
      );

      expect(
        service.deployService.getLastDeploymentByRuntimeIdentity,
      ).toHaveBeenCalledWith({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: null,
        actorUserId: 'user-fallback',
      });
      expect(service.askingTaskTracker.createAskingTask).toHaveBeenCalledWith(
        expect.objectContaining({
          deployId: 'deploy-4',
          runtimeScopeId: 'deploy-4',
          runtimeIdentity: {
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            deployHash: 'deploy-4',
            actorUserId: 'user-fallback',
          },
        }),
      );
    });
  });
});

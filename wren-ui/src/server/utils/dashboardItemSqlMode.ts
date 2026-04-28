import type { PersistedRuntimeIdentity } from '@server/context/runtimeScope';
import type { DashboardItem, ThreadResponse } from '@server/repositories';
import type { DashboardItemDetail } from '@server/repositories/dashboardItemRepository';
import type { AskTemplateDecision } from '@server/models/adaptor';
import { getPreviewSqlModeForTemplateCarrier } from '@server/utils/templateSqlExecution';

type DashboardItemSqlMode = DashboardItemDetail['sqlMode'];

type SqlModeAskingService = {
  getResponseScoped(
    responseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<ThreadResponse>;
  getAskingTaskById?(
    taskId: number,
  ): Promise<{ templateDecision?: AskTemplateDecision | null } | null>;
};

export const resolveThreadResponseSqlMode = async ({
  askingService,
  response,
  runtimeIdentity,
}: {
  askingService: SqlModeAskingService;
  response: ThreadResponse;
  runtimeIdentity: PersistedRuntimeIdentity;
}): Promise<DashboardItemSqlMode> => {
  const sourceResponse = response.sourceResponseId
    ? await askingService.getResponseScoped(
        response.sourceResponseId,
        runtimeIdentity,
      )
    : null;
  const sourceAskingTask =
    sourceResponse?.askingTaskId && askingService.getAskingTaskById
      ? await askingService.getAskingTaskById(sourceResponse.askingTaskId)
      : null;
  const askingTask =
    response.askingTaskId && askingService.getAskingTaskById
      ? await askingService.getAskingTaskById(response.askingTaskId)
      : null;

  return getPreviewSqlModeForTemplateCarrier(askingTask || sourceAskingTask);
};

export const resolveDashboardItemSqlMode = async ({
  askingService,
  item,
  runtimeIdentity,
}: {
  askingService: SqlModeAskingService;
  item: DashboardItem;
  runtimeIdentity: PersistedRuntimeIdentity;
}): Promise<DashboardItemSqlMode> => {
  if (item.detail.sqlMode) {
    return item.detail.sqlMode;
  }

  if (!item.detail.sourceResponseId) {
    return undefined;
  }

  const sourceRuntimeIdentity = item.detail.runtimeIdentity
    ? {
        ...runtimeIdentity,
        ...item.detail.runtimeIdentity,
      }
    : runtimeIdentity;
  const response = await askingService.getResponseScoped(
    item.detail.sourceResponseId,
    sourceRuntimeIdentity,
  );

  return resolveThreadResponseSqlMode({
    askingService,
    response,
    runtimeIdentity: sourceRuntimeIdentity,
  });
};

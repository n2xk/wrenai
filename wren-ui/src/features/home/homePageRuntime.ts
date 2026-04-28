import type { Thread } from '@/types/home';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import {
  hasLatestExecutableSnapshot,
  isHistoricalSnapshotReadonly,
} from '@/utils/runtimeSnapshot';

export const HOME_REFERENCE_PROMPT_PLACEHOLDER = '输入问题，@ 指定知识库';
export const HOME_KNOWLEDGE_PICKER_VIRTUALIZATION_THRESHOLD = 36;
export const HOME_KNOWLEDGE_PICKER_ITEM_ESTIMATED_HEIGHT = 62;
export const HOME_KNOWLEDGE_PICKER_VIRTUAL_OVERSCAN = 5;

export type AskRuntimeKnowledgeBase = {
  id: string;
  defaultKbSnapshotId?: string | null;
};

const compactRuntimeSelector = (
  selector: ClientRuntimeScopeSelector,
): ClientRuntimeScopeSelector => ({
  ...(selector.workspaceId ? { workspaceId: selector.workspaceId } : {}),
  ...(selector.knowledgeBaseId
    ? { knowledgeBaseId: selector.knowledgeBaseId }
    : {}),
  ...(selector.kbSnapshotId ? { kbSnapshotId: selector.kbSnapshotId } : {}),
  ...(selector.deployHash ? { deployHash: selector.deployHash } : {}),
  ...(selector.runtimeScopeId
    ? { runtimeScopeId: selector.runtimeScopeId }
    : {}),
});

export const resolveAskRuntimeSelector = ({
  currentSelector,
  selectedKnowledgeBaseIds,
  workspaceId,
}: {
  currentSelector: ClientRuntimeScopeSelector;
  selectedKnowledgeBaseIds: string[];
  workspaceId?: string | null;
}): ClientRuntimeScopeSelector => {
  const primaryKnowledgeBaseId = selectedKnowledgeBaseIds[0];

  if (!primaryKnowledgeBaseId) {
    return currentSelector;
  }

  if (primaryKnowledgeBaseId === currentSelector.knowledgeBaseId) {
    return currentSelector;
  }

  return {
    ...(workspaceId || currentSelector.workspaceId
      ? { workspaceId: workspaceId || currentSelector.workspaceId }
      : {}),
    knowledgeBaseId: primaryKnowledgeBaseId,
  };
};

export const resolveRecommendationRuntimeSelector = ({
  currentSelector,
  selectedKnowledgeBaseIds,
  knowledgeBases,
  currentKnowledgeBase,
  currentKbSnapshot,
  workspaceId,
}: {
  currentSelector: ClientRuntimeScopeSelector;
  selectedKnowledgeBaseIds: string[];
  knowledgeBases: AskRuntimeKnowledgeBase[];
  currentKnowledgeBase?: AskRuntimeKnowledgeBase | null;
  currentKbSnapshot?: { id?: string | null; deployHash?: string | null } | null;
  workspaceId?: string | null;
}): ClientRuntimeScopeSelector => {
  const primaryKnowledgeBaseId = selectedKnowledgeBaseIds[0];
  const selectedKnowledgeBase = primaryKnowledgeBaseId
    ? knowledgeBases.find(
        (knowledgeBase) => knowledgeBase.id === primaryKnowledgeBaseId,
      ) || null
    : null;
  const recommendationKnowledgeBase =
    selectedKnowledgeBase ||
    currentKnowledgeBase ||
    (currentSelector.knowledgeBaseId
      ? {
          id: currentSelector.knowledgeBaseId,
          defaultKbSnapshotId: currentSelector.kbSnapshotId,
        }
      : null);

  if (!recommendationKnowledgeBase?.id) {
    return compactRuntimeSelector(currentSelector);
  }

  const isCurrentSelectorKnowledgeBase =
    recommendationKnowledgeBase.id === currentSelector.knowledgeBaseId;
  const isCurrentRuntimeKnowledgeBase =
    recommendationKnowledgeBase.id === currentKnowledgeBase?.id;
  const snapshotId =
    (isCurrentSelectorKnowledgeBase ? currentSelector.kbSnapshotId : null) ||
    (isCurrentRuntimeKnowledgeBase ? currentKbSnapshot?.id : null) ||
    recommendationKnowledgeBase.defaultKbSnapshotId ||
    undefined;
  const deployHash =
    (isCurrentSelectorKnowledgeBase ? currentSelector.deployHash : null) ||
    (isCurrentRuntimeKnowledgeBase ? currentKbSnapshot?.deployHash : null) ||
    undefined;

  return compactRuntimeSelector({
    ...(workspaceId || currentSelector.workspaceId
      ? { workspaceId: workspaceId || currentSelector.workspaceId }
      : {}),
    knowledgeBaseId: recommendationKnowledgeBase.id,
    ...(snapshotId ? { kbSnapshotId: snapshotId } : {}),
    ...(deployHash ? { deployHash } : {}),
    ...(isCurrentSelectorKnowledgeBase && currentSelector.runtimeScopeId
      ? { runtimeScopeId: currentSelector.runtimeScopeId }
      : {}),
  });
};

export const resolveCreatedThreadRuntimeSelector = ({
  fallbackSelector,
  thread,
}: {
  fallbackSelector: ClientRuntimeScopeSelector;
  thread?: Partial<Thread> | null;
}): ClientRuntimeScopeSelector => {
  const workspaceId = thread?.workspaceId || fallbackSelector.workspaceId;
  const knowledgeBaseId =
    thread?.knowledgeBaseId || fallbackSelector.knowledgeBaseId;
  const kbSnapshotId = thread?.kbSnapshotId || fallbackSelector.kbSnapshotId;
  const deployHash = thread?.deployHash || fallbackSelector.deployHash;

  return {
    ...(workspaceId ? { workspaceId } : {}),
    ...(knowledgeBaseId ? { knowledgeBaseId } : {}),
    ...(kbSnapshotId ? { kbSnapshotId } : {}),
    ...(deployHash ? { deployHash } : {}),
  };
};

export const resolveAskRuntimeAvailability = ({
  currentSelector,
  selectedKnowledgeBaseIds,
  knowledgeBases,
  currentKnowledgeBase,
  currentKbSnapshot,
}: {
  currentSelector: ClientRuntimeScopeSelector;
  selectedKnowledgeBaseIds: string[];
  knowledgeBases: AskRuntimeKnowledgeBase[];
  currentKnowledgeBase?: AskRuntimeKnowledgeBase | null;
  currentKbSnapshot?: { id?: string | null; deployHash?: string | null } | null;
}) => {
  const primaryKnowledgeBaseId = selectedKnowledgeBaseIds[0];
  const selectedKnowledgeBase =
    (primaryKnowledgeBaseId
      ? knowledgeBases.find(
          (knowledgeBase) => knowledgeBase.id === primaryKnowledgeBaseId,
        )
      : null) ||
    currentKnowledgeBase ||
    null;
  const switchingKnowledgeBase = Boolean(
    primaryKnowledgeBaseId &&
    primaryKnowledgeBaseId !== currentSelector.knowledgeBaseId,
  );

  if (switchingKnowledgeBase) {
    return {
      hasExecutableRuntime: Boolean(selectedKnowledgeBase?.defaultKbSnapshotId),
      isHistoricalRuntimeReadonly: false,
    };
  }

  const selectorHasRuntime = Boolean(
    currentSelector.deployHash ||
    currentSelector.kbSnapshotId ||
    currentKbSnapshot?.deployHash ||
    currentKbSnapshot?.id,
  );

  return {
    hasExecutableRuntime: hasLatestExecutableSnapshot({
      selectorHasRuntime,
      currentKbSnapshotId: currentKbSnapshot?.id,
      defaultKbSnapshotId: selectedKnowledgeBase?.defaultKbSnapshotId,
    }),
    isHistoricalRuntimeReadonly: isHistoricalSnapshotReadonly({
      selectorHasRuntime,
      currentKbSnapshotId: currentKbSnapshot?.id,
      defaultKbSnapshotId: selectedKnowledgeBase?.defaultKbSnapshotId,
    }),
  };
};

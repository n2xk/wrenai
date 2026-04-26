import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import type { KnowledgeBaseRecord } from './types';

export type KnowledgeStateInput = {
  activeKnowledgeRuntimeSelector?: ClientRuntimeScopeSelector;
  activeKnowledgeBase?: KnowledgeBaseRecord | null;
  canCreateKnowledgeBase: boolean;
  createKnowledgeBaseBlockedReason: string | null;
  displayKnowledgeName: string;
  isKnowledgeMutationDisabled: boolean;
  isReadonlyKnowledgeBase: boolean;
  isSnapshotReadonlyKnowledgeBase: boolean;
  knowledgeBases: KnowledgeBaseRecord[];
  knowledgeDescription?: string | null;
  knowledgeMutationHint?: string | null;
  knowledgeSourceOptions: Array<any>;
  switchKnowledgeBase: (...args: any[]) => any;
};

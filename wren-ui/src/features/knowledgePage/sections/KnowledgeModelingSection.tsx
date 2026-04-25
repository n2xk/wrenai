import ModelingWorkspace from '@/components/pages/modeling/ModelingWorkspace';
import type { KnowledgeWorkbenchModelingSummary } from '@/features/knowledgePage/sections/knowledgeWorkbenchShared';

export type KnowledgeModelingSectionProps = {
  modelingSummary?: KnowledgeWorkbenchModelingSummary;
  modelingWorkspaceKey: string;
};

export default function KnowledgeModelingSection({
  modelingWorkspaceKey,
}: KnowledgeModelingSectionProps) {
  return <ModelingWorkspace key={modelingWorkspaceKey} embedded />;
}

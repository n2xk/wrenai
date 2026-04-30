import DirectShellPageFrame from '@/components/reference/DirectShellPageFrame';
import KnowledgeWorkbenchStage from './sections/KnowledgeWorkbenchStage';
import type {
  KnowledgeWorkbenchMainStageProps,
  KnowledgeWorkbenchOverlaysProps,
  KnowledgeWorkbenchSidebarProps,
} from './buildKnowledgeWorkbenchStageProps';

export default function KnowledgeWorkbenchPageFrame({
  loading,
  sidebarProps,
  mainStageProps,
  overlaysProps,
}: {
  loading: boolean;
  sidebarProps: KnowledgeWorkbenchSidebarProps;
  mainStageProps: KnowledgeWorkbenchMainStageProps;
  overlaysProps: KnowledgeWorkbenchOverlaysProps;
}) {
  return (
    <DirectShellPageFrame
      activeNav="knowledge"
      mainPadding="10px 16px 12px 10px"
      stretchContent
    >
      <KnowledgeWorkbenchStage
        loading={loading}
        sidebarProps={sidebarProps}
        mainStageProps={mainStageProps}
        overlaysProps={overlaysProps}
      />
    </DirectShellPageFrame>
  );
}

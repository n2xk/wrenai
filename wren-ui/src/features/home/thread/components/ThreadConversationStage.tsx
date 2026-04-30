import BookOutlined from '@ant-design/icons/BookOutlined';
import { Splitter } from 'antd';
import type { ComponentProps, ReactNode, RefObject } from 'react';
import Prompt from '@/components/pages/home/prompt';
import PromptThread from '@/components/pages/home/promptThread';
import ReferenceConversationPreview from '@/features/home/thread/components/ReferenceConversationPreview';
import {
  ComposerAssistRow,
  ComposerDock,
  ComposerFrame,
  ComposerHintText,
  ConversationRail,
  ComposerSelectedKnowledgeChip,
  ComposerSelectedScopeRow,
  ConversationBody,
  ConversationPane,
  ThreadScene,
  ThreadSplitStage,
  WorkbenchPane,
} from '@/features/home/thread/threadPageStyles';

type ThreadConversationStageProps = {
  promptRef: RefObject<{
    submit?: (value: string) => void;
    close?: () => void;
  } | null>;
  primaryQuestion: string;
  selectedKnowledgeBaseNames: string[];
  shouldUseReferencePreview: boolean;
  hasExecutableRuntime: boolean;
  readonlyHint: string;
  unavailableHint: string;
  isHistoricalRuntimeReadonly: boolean;
  onCreateResponse: ComponentProps<typeof Prompt>['onCreateResponse'];
  promptProps: Omit<ComponentProps<typeof Prompt>, 'ref' | 'onCreateResponse'>;
  composerContent?: ReactNode;
  workbench?: ReactNode;
};

export default function ThreadConversationStage({
  promptRef,
  primaryQuestion,
  selectedKnowledgeBaseNames,
  shouldUseReferencePreview,
  hasExecutableRuntime,
  readonlyHint,
  unavailableHint,
  isHistoricalRuntimeReadonly,
  onCreateResponse,
  promptProps,
  composerContent,
  workbench,
}: ThreadConversationStageProps) {
  const hasWorkbench = Boolean(workbench);
  const conversationStage = (
    <ConversationPane $withWorkbench={hasWorkbench}>
      <ConversationBody
        $withWorkbench={hasWorkbench}
        data-thread-scroll-container="true"
      >
        <ConversationRail $withWorkbench={hasWorkbench}>
          {shouldUseReferencePreview ? (
            <ReferenceConversationPreview
              question={primaryQuestion}
              onSelectSuggestedQuestion={(value) => {
                promptRef.current?.submit?.(value);
              }}
            />
          ) : (
            <PromptThread />
          )}
        </ConversationRail>
      </ConversationBody>

      <ComposerDock $withWorkbench={hasWorkbench}>
        <ConversationRail $withWorkbench={hasWorkbench}>
          <ComposerFrame>
            {selectedKnowledgeBaseNames.length > 0 ? (
              <ComposerSelectedScopeRow>
                {selectedKnowledgeBaseNames.map((knowledgeBaseName) => (
                  <ComposerSelectedKnowledgeChip key={knowledgeBaseName}>
                    <BookOutlined />
                    <span>{knowledgeBaseName}</span>
                  </ComposerSelectedKnowledgeChip>
                ))}
              </ComposerSelectedScopeRow>
            ) : null}
            {composerContent}
            {hasExecutableRuntime ? (
              <Prompt
                ref={promptRef as never}
                {...promptProps}
                onCreateResponse={onCreateResponse}
                variant="embedded"
                buttonMode="icon"
                showInlineResult={false}
              />
            ) : (
              <ComposerAssistRow>
                <ComposerHintText>
                  {isHistoricalRuntimeReadonly ? readonlyHint : unavailableHint}
                </ComposerHintText>
              </ComposerAssistRow>
            )}
          </ComposerFrame>
        </ConversationRail>
      </ComposerDock>
    </ConversationPane>
  );

  return (
    <ThreadScene $withWorkbench={hasWorkbench}>
      {workbench ? (
        <ThreadSplitStage
          lazy
          style={{ height: '100%' }}
          onResizeEnd={() => {
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new Event('resize'));
            }
          }}
        >
          <Splitter.Panel defaultSize="52%" min="40%">
            {conversationStage}
          </Splitter.Panel>
          <Splitter.Panel defaultSize="48%" min={420} max="60%">
            <WorkbenchPane>{workbench}</WorkbenchPane>
          </Splitter.Panel>
        </ThreadSplitStage>
      ) : (
        conversationStage
      )}
    </ThreadScene>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Skeleton, Typography } from 'antd';
import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import LoadingOutlined from '@ant-design/icons/LoadingOutlined';
import styled from 'styled-components';
import { BinocularsIcon } from '@/utils/icons';
import { nextTick } from '@/utils/time';
import {
  usePromptThreadActionsStore,
  usePromptThreadPreparationStore,
} from './store';
import useTextBasedAnswerStreamTask from '@/hooks/useTextBasedAnswerStreamTask';
import { Props as AnswerResultProps } from '@/components/pages/home/promptThread/AnswerResult';
import MarkdownBlock from '@/components/editor/MarkdownBlock';
import PreviewData from '@/components/dataPreview/PreviewData';
import {
  AskingTaskStatus,
  AskingTaskType,
  ThreadResponseAnswerStatus,
} from '@/types/home';

import useResponsePreviewData from '@/hooks/useResponsePreviewData';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import { getAnswerIsFinished } from './answerGeneration';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { resolveThreadResponseRuntimeSelector } from '@/features/home/thread/threadResponseRuntime';
import ResponseSpreadsheetSaveButton from './ResponseSpreadsheetSaveButton';
import { hasExportablePreviewData } from '@/utils/exportTabularData';

const { Text } = Typography;

const StyledSkeleton = styled(Skeleton)`
  padding: 0;
  .ant-skeleton-paragraph {
    margin-bottom: 0;
  }
`;

const ResultActionButton = styled(Button)`
  && {
    height: 32px;
    border-radius: var(--nova-radius-control);
    padding-inline: 10px;
    font-weight: 500;
  }
`;

const AnswerMarkdownBody = styled.div`
  color: #2b3443;
  line-height: 1.8;
  font-size: 14px;

  > :last-child {
    margin-bottom: 0;
  }

  > :last-child > :last-child {
    margin-bottom: 0;
  }
`;

const getIsLoadingFinished = (status?: ThreadResponseAnswerStatus | null) =>
  getAnswerIsFinished(status) ||
  status === ThreadResponseAnswerStatus.STREAMING;

const TRANSIENT_TEXT_ANSWER_ERROR_PATTERNS = [
  /(?:read\s+)?ECONNRESET/i,
  /socket hang up/i,
  /Connection reset by peer/i,
];
const TEXT_TO_SQL_SQL_MISSING_ERROR_CODE = 'TEXT_TO_SQL_SQL_MISSING';
const SQL_GENERATION_ERROR_PATTERN =
  /(SQL\s*生成失败|未能生成可执行查询|has no SQL|no SQL)/i;
const SQL_GENERATION_FALLBACK_DESCRIPTION =
  '未能生成可执行查询。请尝试重新生成 SQL，或调整问题描述。';

const ACTIVE_ASKING_TASK_STATUSES = new Set<AskingTaskStatus>([
  AskingTaskStatus.CORRECTING,
  AskingTaskStatus.GENERATING,
  AskingTaskStatus.PLANNING,
  AskingTaskStatus.SEARCHING,
  AskingTaskStatus.UNDERSTANDING,
]);

const resolveSqlGenerationErrorDescription = (message: string) => {
  const normalized = message
    .replace(/^SQL\s*生成失败[，,。:：\s]*/i, '')
    .replace('请尝试重新生成，', '请尝试重新生成 SQL，')
    .trim();

  return normalized || SQL_GENERATION_FALLBACK_DESCRIPTION;
};

type TextAnswerErrorLike = {
  code?: string | null;
  message?: string | null;
  shortMessage?: string | null;
} | null;

export const resolveTextAnswerErrorPresentation = (
  error?: TextAnswerErrorLike,
) => {
  const rawMessage = resolveAbortSafeErrorMessage(error?.message, '');
  const rawShortMessage = resolveAbortSafeErrorMessage(error?.shortMessage, '');
  if (!rawMessage && !rawShortMessage) {
    return null;
  }

  const combinedRawMessage = [rawShortMessage, rawMessage]
    .filter(Boolean)
    .join(' ');
  const isSqlGenerationError =
    error?.code === TEXT_TO_SQL_SQL_MISSING_ERROR_CODE ||
    SQL_GENERATION_ERROR_PATTERN.test(combinedRawMessage);

  if (isSqlGenerationError) {
    return {
      actionLabel: '重新生成 SQL',
      actionTitle: '重新生成 SQL',
      message: 'SQL 生成失败',
      retryTarget: 'asking_task' as const,
      description: resolveSqlGenerationErrorDescription(rawMessage || ''),
    };
  }

  const isTransientUpstreamError = TRANSIENT_TEXT_ANSWER_ERROR_PATTERNS.some(
    (pattern) => pattern.test(combinedRawMessage),
  );

  if (isTransientUpstreamError) {
    return {
      actionLabel: '重新生成解读',
      actionTitle: '重新生成解读',
      message: '文字解读生成失败',
      retryTarget: 'text_answer' as const,
      description:
        '数据结果已生成，但文字解读生成失败，可能是上游服务连接中断。你可以继续查看数据，或只重新生成文字解读。',
    };
  }

  return {
    actionLabel: '重新生成解读',
    actionTitle: '重新生成解读',
    message: rawShortMessage || '文字解读生成失败',
    retryTarget: 'text_answer' as const,
    description: rawMessage || '文字解读生成失败，请稍后重试。',
  };
};

export default function TextBasedAnswer(props: AnswerResultProps) {
  const { onGenerateTextBasedAnswer } = usePromptThreadActionsStore();
  const { preparation } = usePromptThreadPreparationStore();
  const {
    isLastThreadResponse,
    mode,
    onInitPreviewDone,
    shouldAutoPreview,
    threadResponse,
  } = props;
  const { id } = threadResponse;
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const responseRuntimeSelector = resolveThreadResponseRuntimeSelector({
    response: threadResponse,
    fallbackSelector: runtimeScopeNavigation.selector,
  });
  const { content, error, numRowsUsedInLLM, status } =
    threadResponse?.answerDetail || {};

  const [textAnswer, setTextAnswer] = useState<string>('');

  const [fetchAnswerStreamingTask, answerStreamTaskResult] =
    useTextBasedAnswerStreamTask(responseRuntimeSelector);

  const answerStreamTask = answerStreamTaskResult.data;

  const isStreaming = useMemo(
    () => status === ThreadResponseAnswerStatus.STREAMING,
    [status],
  );

  useEffect(() => {
    if (isStreaming) {
      setTextAnswer(answerStreamTask || '');
    } else {
      setTextAnswer(content || '');
    }
  }, [answerStreamTask, isStreaming, content]);

  useEffect(() => {
    if (isStreaming) {
      fetchAnswerStreamingTask(id);
    }
  }, [isStreaming, id]);

  useEffect(() => {
    return () => {
      answerStreamTaskResult.onReset();
    };
  }, []);

  useEffect(() => {
    setIsPreviewExpanded(false);
  }, [id]);

  const rowsUsed = useMemo(
    () =>
      status === ThreadResponseAnswerStatus.FINISHED
        ? numRowsUsedInLLM || 0
        : 0,
    [numRowsUsedInLLM, status],
  );

  const allowPreviewData = useMemo(() => Boolean(rowsUsed > 0), [rowsUsed]);
  const allowInlinePreview = mode === 'workbench';

  const previewDataResult = useResponsePreviewData(id, responseRuntimeSelector);
  const { ensureLoaded: ensurePreviewLoaded } = previewDataResult;
  const [isPreviewExpanded, setIsPreviewExpanded] = useState(false);
  const previewData = previewDataResult.data?.previewData;
  const hasPreviewData = !!previewData;
  const hasPreviewRows = hasExportablePreviewData(previewData);
  const [regenerateFailureLoading, setRegenerateFailureLoading] =
    useState(false);

  const fetchPreviewData = async () => {
    await ensurePreviewLoaded();
  };

  const onPreviewData = async () => {
    const nextExpanded = !isPreviewExpanded;
    setIsPreviewExpanded(nextExpanded);
    if (!nextExpanded) return;

    if (!previewDataResult.called && !previewDataResult.loading) {
      await fetchPreviewData();
    }
  };

  const autoTriggerPreviewDataButton = async () => {
    setIsPreviewExpanded(true);
    await nextTick();
    await fetchPreviewData();
  };

  useEffect(() => {
    if (isLastThreadResponse) {
      if (allowPreviewData && allowInlinePreview) {
        if (shouldAutoPreview) {
          autoTriggerPreviewDataButton();
        }
      }

      onInitPreviewDone();
    }
  }, [
    allowInlinePreview,
    isLastThreadResponse,
    allowPreviewData,
    shouldAutoPreview,
  ]);

  const loading = !getIsLoadingFinished(status);

  const onRegenerateAnswer = async () => {
    setTextAnswer('');
    await onGenerateTextBasedAnswer(id);
  };

  const onRegenerateFailure = async () => {
    if (!answerErrorPresentation) {
      return;
    }

    setRegenerateFailureLoading(true);
    try {
      if (answerErrorPresentation.retryTarget === 'asking_task') {
        await preparation.onReRunAskingTask?.(threadResponse);
        return;
      }

      await onRegenerateAnswer();
    } finally {
      setRegenerateFailureLoading(false);
    }
  };

  const answerErrorPresentation = resolveTextAnswerErrorPresentation(error);
  const isActiveTextToSqlRerun =
    answerErrorPresentation?.retryTarget === 'asking_task' &&
    threadResponse.askingTask?.type === AskingTaskType.TEXT_TO_SQL &&
    ACTIVE_ASKING_TASK_STATUSES.has(threadResponse.askingTask.status);

  if (error && answerErrorPresentation && !isActiveTextToSqlRerun) {
    return (
      <>
        <div className="pt-0 pb-2">
          <Alert
            className="mt-2 mb-2"
            title={answerErrorPresentation.message}
            description={answerErrorPresentation.description}
            type="error"
            showIcon
            action={
              <ResultActionButton
                icon={<ReloadOutlined />}
                disabled={
                  answerErrorPresentation.retryTarget === 'asking_task' &&
                  !preparation.onReRunAskingTask
                }
                loading={regenerateFailureLoading}
                size="small"
                type="link"
                title={answerErrorPresentation.actionTitle}
                onClick={onRegenerateFailure}
              >
                {answerErrorPresentation.actionLabel}
              </ResultActionButton>
            }
          />
        </div>
      </>
    );
  }

  return (
    <StyledSkeleton
      active
      loading={loading}
      paragraph={{ rows: 4 }}
      title={false}
    >
      <div className="text-md gray-10 pt-0 pb-0">
        <AnswerMarkdownBody>
          <MarkdownBlock content={textAnswer} />
        </AnswerMarkdownBody>
        {isStreaming && <LoadingOutlined className="geekblue-6" spin />}
        {status === ThreadResponseAnswerStatus.INTERRUPTED && (
          <div className="mt-2 text-right">
            <ResultActionButton
              icon={<ReloadOutlined />}
              size="small"
              type="link"
              title="重新生成解读"
              onClick={onRegenerateAnswer}
            >
              重新生成解读
            </ResultActionButton>
          </div>
        )}
        {allowPreviewData && allowInlinePreview ? (
          <div className="mt-6">
            <ResultActionButton
              size="small"
              icon={
                <BinocularsIcon
                  style={{
                    paddingBottom: 2,
                    marginRight: 8,
                  }}
                />
              }
              loading={previewDataResult.loading}
              onClick={onPreviewData}
              data-ph-capture="true"
              data-ph-capture-attribute-name="cta_text-answer_preview_data"
            >
              查看结果
            </ResultActionButton>

            {isPreviewExpanded && (
              <div
                className="mt-2 mb-3"
                data-guideid="text-answer-preview-data"
              >
                {hasPreviewRows && (
                  <Text type="secondary" className="text-sm">
                    受上下文窗口限制，系统最多会提取 500 行结果来生成本次回答。
                  </Text>
                )}
                <PreviewData
                  error={previewDataResult.error}
                  loading={previewDataResult.loading}
                  previewData={previewData}
                  exportFileName={`thread-response-${id}-result`}
                  extraActions={
                    hasPreviewData ? (
                      <>
                        <ResponseSpreadsheetSaveButton
                          disabled={!hasPreviewRows}
                          disabledReason="当前查询没有返回数据，暂不能保存为数据表。"
                          response={threadResponse}
                        />
                      </>
                    ) : null
                  }
                />
              </div>
            )}
          </div>
        ) : allowInlinePreview ? (
          <>
            {!isStreaming && (
              <Alert
                message={
                  <>
                    点击 <b>SQL 查询</b>{' '}
                    查看逐步生成的查询逻辑，并确认当前为何暂无数据。
                  </>
                }
                type="info"
              />
            )}
          </>
        ) : null}
      </div>
    </StyledSkeleton>
  );
}

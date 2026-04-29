import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import styled from 'styled-components';
import {
  Button,
  Divider,
  Empty,
  message,
  Space,
  Switch,
  Typography,
} from 'antd';
import CheckOutlined from '@ant-design/icons/CheckOutlined';
import CloseOutlined from '@ant-design/icons/CloseOutlined';
import { BinocularsIcon } from '@/utils/icons';
import { nextTick } from '@/utils/time';
import useNativeSQL from '@/hooks/useNativeSQL';
import { CONNECTION_TYPE_OPTIONS } from '@/components/pages/setup/utils';
import { Props as AnswerResultProps } from '@/components/pages/home/promptThread/AnswerResult';
import PreviewData from '@/components/dataPreview/PreviewData';
import useResponsePreviewData from '@/hooks/useResponsePreviewData';
import type { WorkbenchSqlController } from '@/features/home/thread/useWorkbenchSqlController';
import { useThreadWorkbenchMessages } from '@/features/home/thread/threadWorkbenchMessages';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { resolveThreadResponseRuntimeSelector } from '@/features/home/thread/threadResponseRuntime';
import ResponseSpreadsheetSaveButton from './ResponseSpreadsheetSaveButton';

const SQLCodeBlock = dynamic(() => import('@/components/code/SQLCodeBlock'), {
  ssr: false,
});

const { Text } = Typography;

const StyledPre = styled.pre`
  margin-bottom: 0;
  border: 1px solid rgba(15, 23, 42, 0.06);
  border-radius: var(--nova-radius-card);
  overflow: hidden;

  .adm_code-block {
    border-top: none;
    border-radius: 0 0 var(--nova-radius-card) var(--nova-radius-card);
  }
`;

const StyledToolBar = styled.div`
  background: rgba(248, 250, 252, 0.92);
  min-height: 40px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.06);
`;

export default function ViewSQLTabContent(
  props: AnswerResultProps & {
    sqlController?: WorkbenchSqlController | null;
  },
) {
  const {
    isLastThreadResponse,
    mode,
    onInitPreviewDone,
    sqlController,
    shouldAutoPreview,
    threadResponse,
  } = props;
  const isWorkbenchMode = mode === 'workbench';
  const messages = useThreadWorkbenchMessages();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const responseRuntimeSelector = resolveThreadResponseRuntimeSelector({
    response: threadResponse,
    fallbackSelector: runtimeScopeNavigation.selector,
  });

  const { fetchNativeSQL, nativeSQLResult } = useNativeSQL(
    responseRuntimeSelector,
  );
  const previewDataResult = useResponsePreviewData(
    threadResponse.id,
    responseRuntimeSelector,
  );
  const { ensureLoaded: ensurePreviewLoaded } = previewDataResult;

  const onPreviewData = async () => {
    await ensurePreviewLoaded();
  };

  const autoTriggerPreviewDataButton = async () => {
    await nextTick();
    await onPreviewData();
    await nextTick();
    onInitPreviewDone();
  };

  // when is the last step of the last thread response, auto trigger preview data button
  useEffect(() => {
    if (isLastThreadResponse && shouldAutoPreview && !isWorkbenchMode) {
      autoTriggerPreviewDataButton();
    }
  }, [isLastThreadResponse, isWorkbenchMode, shouldAutoPreview]);

  const { id, sql } = threadResponse;
  const sqlText = sql ?? '';

  const connectionTypeOption =
    (sqlController?.connectionType &&
    CONNECTION_TYPE_OPTIONS[sqlController.connectionType]
      ? CONNECTION_TYPE_OPTIONS[sqlController.connectionType]
      : null) ||
    (nativeSQLResult.connectionType &&
    CONNECTION_TYPE_OPTIONS[nativeSQLResult.connectionType]
      ? CONNECTION_TYPE_OPTIONS[nativeSQLResult.connectionType]
      : null);
  const showNativeSQL =
    sqlController?.showNativeSQL ?? nativeSQLResult.hasNativeSQL;
  const sqls = sqlController?.displayedSql
    ? sqlController.displayedSql
    : nativeSQLResult.nativeSQLMode && nativeSQLResult.loading === false
      ? nativeSQLResult.data
      : sqlText;
  const nativeSqlMode =
    sqlController?.nativeSQLMode ?? nativeSQLResult.nativeSQLMode;
  const nativeSqlLoading = sqlController?.loading ?? nativeSQLResult.loading;

  const onChangeNativeSQL = async (checked: boolean) => {
    if (sqlController) {
      await sqlController.onChangeNativeSQL(checked);
      return;
    }
    nativeSQLResult.setNativeSQLMode(checked);
    checked && fetchNativeSQL({ variables: { responseId: id } });
  };

  const onCopy = () => {
    if (!nativeSQLResult.nativeSQLMode) {
      message.success(
        <>
          你复制的SQL，可能无法直接在你的数据库中运行。
          {showNativeSQL && (
            <>
              {' '}
              点击“<b>显示原始 SQL</b>”即可切换到可直接执行的版本。
            </>
          )}
        </>,
      );
    }
  };

  return (
    <div
      className={
        isWorkbenchMode
          ? 'text-md gray-10 px-4 pt-2 pb-4'
          : 'text-md gray-10 p-6 pb-4'
      }
    >
      <StyledPre className="p-0 mb-3">
        <StyledToolBar className="d-flex align-center justify-space-between text-family-base">
          <div>
            {nativeSqlMode ? (
              <>
                <Text className="gray-8 text-medium text-sm">
                  {connectionTypeOption?.label || '原始 SQL'}
                </Text>
              </>
            ) : (
              <Text className="gray-8 text-medium text-sm">Nova SQL</Text>
            )}
          </div>
          <Space separator={<Divider orientation="vertical" className="m-0" />}>
            {showNativeSQL && (
              <div
                className="d-flex align-center cursor-pointer"
                onClick={() => onChangeNativeSQL(!nativeSqlMode)}
              >
                <Switch
                  checkedChildren={<CheckOutlined />}
                  unCheckedChildren={<CloseOutlined />}
                  className="mr-2"
                  size="small"
                  checked={nativeSqlMode}
                  loading={nativeSqlLoading}
                />
                <Text className="gray-8 text-medium text-base">
                  显示原始 SQL
                </Text>
              </div>
            )}
          </Space>
        </StyledToolBar>
        <SQLCodeBlock
          code={sqls}
          showLineNumbers
          maxHeight="300"
          loading={nativeSqlLoading}
          copyable={!isWorkbenchMode}
          onCopy={onCopy}
        />
      </StyledPre>
      {!isWorkbenchMode ? (
        <div className="mt-6">
          <Button
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
            data-ph-capture-attribute-name="view_sql_preview_data"
          >
            {messages.preview.viewResult}
          </Button>
          {previewDataResult?.data?.previewData && (
            <div className="mt-2 mb-3">
              <PreviewData
                error={previewDataResult.error}
                loading={previewDataResult.loading}
                previewData={previewDataResult?.data?.previewData}
                exportFileName={`thread-response-${id}-sql-result`}
                extraActions={
                  previewDataResult?.data?.previewData ? (
                    <>
                      <ResponseSpreadsheetSaveButton
                        response={threadResponse}
                      />
                    </>
                  ) : null
                }
                locale={{
                  emptyText: (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={messages.preview.emptyDescription}
                    />
                  ),
                }}
              />
              <div className="text-right">
                <Text className="text-base gray-6">
                  {messages.preview.rowLimitHint}
                </Text>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

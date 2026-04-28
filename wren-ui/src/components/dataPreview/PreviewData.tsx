import { memo, useMemo } from 'react';
import { Alert, Button, Space, Tooltip, Typography } from 'antd';
import DownloadOutlined from '@ant-design/icons/DownloadOutlined';
import FileExcelOutlined from '@ant-design/icons/FileExcelOutlined';
import styled from 'styled-components';
import { getColumnTypeIcon } from '@/utils/columnType';
import PreviewDataContent from '@/components/dataPreview/PreviewDataContent';
import {
  isOperationClientError,
  parseOperationError,
} from '@/utils/errorHandler';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import {
  exportPreviewDataCsv,
  exportPreviewDataExcel,
  hasExportablePreviewData,
} from '@/utils/exportTabularData';

const { Text } = Typography;

const PreviewDataShell = styled.div`
  min-width: 0;
`;

const PreviewDataToolbar = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-bottom: 8px;
`;

const StyledCell = styled.div`
  position: relative;

  .copy-icon {
    position: absolute;
    top: 50%;
    right: 0;
    transform: translateY(-50%);
    opacity: 0;
    transition: opacity 0.3s;
  }

  .ant-typography-copy {
    margin: -4px;
  }

  &:hover .copy-icon {
    opacity: 1;
  }
`;

const ColumnTitle = memo((props: { name: string; type: any }) => {
  const { name, type } = props;
  const columnTypeIcon = getColumnTypeIcon({ type }, { title: type });

  return (
    <>
      {columnTypeIcon}
      <Text title={name} className="ml-1">
        {name}
      </Text>
    </>
  );
});

const ColumnContext = memo((props: { text: string; copyable: boolean }) => {
  const { text, copyable } = props;
  return (
    <StyledCell className="text-truncate">
      <span title={text} className="text text-container">
        {text}
      </span>
      {copyable && (
        <span className="copy-icon">
          <Text copyable={{ text, tooltips: false }} className="gray-8" />
        </span>
      )}
    </StyledCell>
  );
});

type PreviewColumn = {
  name: string;
  type: string;
};

const getPreviewColumns = (
  cols: PreviewColumn[],
  { copyable }: { copyable: boolean },
) =>
  cols.map(({ name, type }: PreviewColumn) => {
    return {
      dataIndex: name,
      titleText: name,
      key: name,
      ellipsis: true,
      title: <ColumnTitle name={name} type={type} />,
      render: (text: unknown) => (
        <ColumnContext text={String(text ?? '')} copyable={copyable} />
      ),
      onCell: () => ({ style: { lineHeight: '24px' } }),
    };
  });

interface Props {
  className?: string;
  previewData?: {
    data: Array<Array<any>>;
    columns: Array<{
      name: string;
      type: string;
    }>;
  };
  loading: boolean;
  error?: Error | null;
  locale?: { emptyText: React.ReactNode };
  copyable?: boolean;
  exportFileName?: string;
  extraActions?: React.ReactNode;
  showExport?: boolean;
  showRowIndex?: boolean;
  rowIndexOffset?: number;
  tableScrollY?: number | string | false;
}

export default function PreviewData(props: Props) {
  const {
    className,
    previewData,
    loading,
    error,
    locale,
    copyable = true,
    exportFileName,
    extraActions,
    showExport = true,
    showRowIndex = false,
    rowIndexOffset = 0,
    tableScrollY,
  } = props;
  const mergedLocale = useMemo(
    () => ({ emptyText: '暂无数据', ...locale }),
    [locale],
  );
  const hasExportableData = hasExportablePreviewData(previewData);

  const columns = useMemo(
    () =>
      previewData?.columns
        ? getPreviewColumns(previewData.columns, { copyable })
        : [],
    [previewData?.columns, copyable],
  );

  const errorMessage = resolveAbortSafeErrorMessage(error);
  const hasErrorMessage = !loading && !!errorMessage;
  if (hasErrorMessage) {
    const parsedError = isOperationClientError(error)
      ? parseOperationError(error)
      : null;
    const messageText = parsedError?.message || errorMessage;
    const shortMessage = parsedError?.shortMessage || '查询失败';

    return (
      <Alert
        message={shortMessage}
        description={messageText}
        type="error"
        showIcon
      />
    );
  }

  const shouldRenderExportActions = showExport && hasExportableData;
  const shouldRenderToolbar =
    Boolean(extraActions) || shouldRenderExportActions;

  return (
    <PreviewDataShell className={className}>
      {shouldRenderToolbar ? (
        <PreviewDataToolbar>
          {extraActions ? <Space size={6}>{extraActions}</Space> : null}
          {shouldRenderExportActions ? (
            <Space size={6}>
              <Tooltip title="导出当前已加载的预览结果，可用 Excel 打开">
                <Button
                  size="small"
                  icon={<DownloadOutlined />}
                  disabled={loading}
                  onClick={() =>
                    previewData &&
                    exportPreviewDataCsv(previewData, exportFileName)
                  }
                >
                  导出 CSV
                </Button>
              </Tooltip>
              <Tooltip title="导出为 Excel 可打开的表格文件">
                <Button
                  size="small"
                  icon={<FileExcelOutlined />}
                  disabled={loading}
                  onClick={() =>
                    previewData &&
                    exportPreviewDataExcel(previewData, exportFileName)
                  }
                >
                  导出 Excel
                </Button>
              </Tooltip>
            </Space>
          ) : null}
        </PreviewDataToolbar>
      ) : null}
      <PreviewDataContent
        columns={columns}
        data={previewData?.data || []}
        loading={loading}
        locale={mergedLocale}
        showRowIndex={showRowIndex}
        rowIndexOffset={rowIndexOffset}
        scrollY={tableScrollY}
      />
    </PreviewDataShell>
  );
}

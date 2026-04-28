import { useMemo } from 'react';
import { Table, TableColumnProps } from 'antd';
import { isString } from 'lodash';

const FONT_SIZE = 16;
const BASIC_COLUMN_WIDTH = 100;

type TableColumn = TableColumnProps<any> & { titleText?: string };

interface Props {
  columns: TableColumn[];
  data: Array<any[]>;
  loading: boolean;
  locale?: { emptyText: React.ReactNode };
  showRowIndex?: boolean;
  rowIndexOffset?: number;
  scrollY?: number | string | false;
}

const getValueByValueType = (value: any) =>
  ['boolean', 'object'].includes(typeof value) ? JSON.stringify(value) : value;

const convertResultData = (data: Array<any[]>, columns: TableColumn[]) => {
  return data.map((datum: Array<any>, index: number) => {
    const obj: Record<string, unknown> = {};
    // should have a unique "key" prop.
    obj.key = index;

    datum.forEach((value, columnIndex) => {
      const columnDataIndex = columns[columnIndex]?.dataIndex;
      const columnName = Array.isArray(columnDataIndex)
        ? columnDataIndex.join('.')
        : String(columnDataIndex ?? columnIndex);
      obj[columnName] = getValueByValueType(value);
    });

    return obj;
  });
};

const ROW_INDEX_COLUMN_WIDTH = 56;

export default function PreviewDataContent(props: Props) {
  const {
    columns = [],
    data = [],
    loading,
    locale,
    showRowIndex = false,
    rowIndexOffset = 0,
    scrollY = 280,
  } = props;
  const hasColumns = !!columns.length;

  const dynamicWidth = useMemo(() => {
    return (
      columns.reduce((result, column) => {
        const width = isString(column.titleText || column.title)
          ? (column.titleText || (column.title as string)).length * FONT_SIZE
          : BASIC_COLUMN_WIDTH;
        return result + width;
      }, 0) + (showRowIndex ? ROW_INDEX_COLUMN_WIDTH : 0)
    );
  }, [columns, showRowIndex]);

  const tableColumns = useMemo(() => {
    const dataColumns = columns.map((column) => ({
      ...column,
      ellipsis: true,
    }));

    if (!showRowIndex) {
      return dataColumns;
    }

    return [
      {
        dataIndex: '__rowIndex',
        key: '__rowIndex',
        width: ROW_INDEX_COLUMN_WIDTH,
        fixed: 'left' as const,
        className: 'preview-row-index-cell',
        title: '',
        render: (_value: unknown, _record: unknown, index: number) =>
          rowIndexOffset + index + 1,
      },
      ...dataColumns,
    ];
  }, [columns, rowIndexOffset, showRowIndex]);

  const dataSource = useMemo(
    () => convertResultData(data, columns),
    [columns, data],
  );

  const scroll =
    scrollY === false ? { x: dynamicWidth } : { y: scrollY, x: dynamicWidth };

  // https://posthog.com/docs/session-replay/privacy#other-elements
  return (
    <Table
      className={`ph-no-capture ${hasColumns ? 'ant-table-has-header' : ''}`}
      showHeader={hasColumns}
      dataSource={dataSource}
      columns={tableColumns}
      pagination={false}
      size="small"
      scroll={scroll}
      loading={loading}
      locale={locale}
    />
  );
}

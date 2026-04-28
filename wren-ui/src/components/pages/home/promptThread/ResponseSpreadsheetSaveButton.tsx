import { useMemo, useState } from 'react';
import { Button } from 'antd';
import TableOutlined from '@ant-design/icons/TableOutlined';
import type { ThreadResponse } from '@/types/home';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { resolveThreadResponseRuntimeSelector } from '@/features/home/thread/threadResponseRuntime';
import { createSpreadsheet } from '@/utils/spreadsheetRest';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import { appMessage } from '@/utils/antdAppBridge';

export default function ResponseSpreadsheetSaveButton({
  disabled,
  response,
}: {
  disabled?: boolean;
  response: ThreadResponse;
}) {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const responseRuntimeSelector = useMemo(
    () =>
      resolveThreadResponseRuntimeSelector({
        response,
        fallbackSelector: runtimeScopeNavigation.selector,
      }),
    [response, runtimeScopeNavigation.selector],
  );
  const [submitting, setSubmitting] = useState(false);

  const actionDisabled = disabled || !response.sql || submitting;

  const onSave = async () => {
    if (actionDisabled) {
      return;
    }

    setSubmitting(true);
    try {
      const spreadsheet = await createSpreadsheet(responseRuntimeSelector, {
        responseId: response.id,
      });
      appMessage.success(`已保存为数据表「${spreadsheet.name}」`);
      await runtimeScopeNavigation.push(
        `/home/spreadsheets/${spreadsheet.id}`,
        {},
        runtimeScopeNavigation.workspaceSelector,
      );
    } catch (error) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '保存为数据表失败。',
      );
      if (errorMessage) {
        appMessage.error(errorMessage);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Button
      size="small"
      icon={<TableOutlined />}
      loading={submitting}
      disabled={actionDisabled}
      onClick={onSave}
    >
      保存为数据表
    </Button>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { appMessage as message } from '@/utils/antdAppBridge';
import useRuntimeScopeNavigation from './useRuntimeScopeNavigation';
import {
  loadSpreadsheetListPayload,
  type SpreadsheetListItem,
} from '@/utils/spreadsheetRest';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';

type UseHomeSpreadsheetsOptions = {
  disabled?: boolean;
};

export default function useHomeSpreadsheets(
  options?: UseHomeSpreadsheetsOptions,
) {
  const disabled = Boolean(options?.disabled);
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const selectorKey = useMemo(
    () =>
      [
        runtimeScopeNavigation.workspaceSelector.workspaceId || '',
        runtimeScopeNavigation.workspaceSelector.runtimeScopeId || '',
      ].join('|'),
    [
      runtimeScopeNavigation.workspaceSelector.runtimeScopeId,
      runtimeScopeNavigation.workspaceSelector.workspaceId,
    ],
  );
  const [spreadsheetState, setSpreadsheetState] = useState<{
    selectorKey: string;
    spreadsheets: SpreadsheetListItem[];
    initialized: boolean;
  }>(() => ({
    selectorKey,
    spreadsheets: [],
    initialized: false,
  }));
  const [loading, setLoading] = useState(false);
  const spreadsheets =
    spreadsheetState.selectorKey === selectorKey
      ? spreadsheetState.spreadsheets
      : [];
  const initialized =
    spreadsheetState.selectorKey === selectorKey
      ? spreadsheetState.initialized
      : false;

  const load = useCallback(async () => {
    if (disabled || !runtimeScopeNavigation.hasRuntimeScope) {
      setSpreadsheetState({
        selectorKey,
        spreadsheets: [],
        initialized: true,
      });
      return [];
    }

    setLoading(true);
    try {
      const payload = await loadSpreadsheetListPayload({
        selector: runtimeScopeNavigation.workspaceSelector,
      });
      setSpreadsheetState({
        selectorKey,
        spreadsheets: payload,
        initialized: true,
      });
      return payload;
    } catch (error) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '加载数据表列表失败，请稍后重试',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
      setSpreadsheetState({
        selectorKey,
        spreadsheets: [],
        initialized: true,
      });
      return [];
    } finally {
      setLoading(false);
    }
  }, [
    disabled,
    runtimeScopeNavigation.hasRuntimeScope,
    runtimeScopeNavigation.workspaceSelector,
    selectorKey,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  return useMemo(
    () => ({
      data: { spreadsheets },
      loading,
      initialized,
      refetch: load,
    }),
    [initialized, load, loading, spreadsheets],
  );
}

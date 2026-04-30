import { useCallback, useEffect, useMemo, useState } from 'react';
import { appMessage as message } from '@/utils/antdAppBridge';
import useRuntimeScopeNavigation from './useRuntimeScopeNavigation';
import {
  buildSpreadsheetListUrl,
  loadSpreadsheetListPayload,
  peekSpreadsheetListPayload,
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
  }>(() => {
    const cached = disabled
      ? null
      : peekSpreadsheetListPayload({
          requestUrl: buildSpreadsheetListUrl(
            runtimeScopeNavigation.workspaceSelector,
          ),
        });

    return {
      selectorKey,
      spreadsheets: cached || [],
      initialized: Boolean(cached),
    };
  });
  const [loading, setLoading] = useState(false);
  const spreadsheets =
    spreadsheetState.selectorKey === selectorKey
      ? spreadsheetState.spreadsheets
      : [];
  const initialized =
    spreadsheetState.selectorKey === selectorKey
      ? spreadsheetState.initialized
      : false;

  const requestUrl = useMemo(
    () => buildSpreadsheetListUrl(runtimeScopeNavigation.workspaceSelector),
    [runtimeScopeNavigation.workspaceSelector],
  );

  const load = useCallback(
    async ({ useCache = false } = {}) => {
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
          requestUrl,
          useCache,
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
    },
    [
      disabled,
      runtimeScopeNavigation.hasRuntimeScope,
      runtimeScopeNavigation.workspaceSelector,
      requestUrl,
      selectorKey,
    ],
  );

  useEffect(() => {
    const cached = disabled ? null : peekSpreadsheetListPayload({ requestUrl });
    if (cached) {
      setSpreadsheetState({
        selectorKey,
        spreadsheets: cached,
        initialized: true,
      });
    }
    void load({ useCache: true });
  }, [disabled, load, requestUrl, selectorKey]);

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

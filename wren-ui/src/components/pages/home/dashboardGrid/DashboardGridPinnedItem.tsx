import dynamic from 'next/dynamic';
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Alert, Button } from 'antd';

import { appMessage as message } from '@/utils/antdAppBridge';
import { LoadingWrapper } from '@/components/PageLoading';
import { DashboardItemDropdown } from '@/components/diagram/CustomDropdown';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import { MORE_ACTION } from '@/utils/enum';
import { MoreIcon } from '@/utils/icons';
import { getCompactTime, nextTick } from '@/utils/time';
import {
  abortWithReason,
  createAbortError,
  resolveAbortSafeErrorMessage,
} from '@/utils/abort';
import {
  previewDashboardItem,
  type DashboardPreviewData,
} from '@/utils/dashboardRest';
import { formatDashboardQueryControlsLabel } from '@/utils/dashboardQueryControls';
import PreviewDataContent from '@/components/dataPreview/PreviewDataContent';
import { DashboardItemType } from '@/types/home';
import NumberCardGroup from '@/components/numberCard/NumberCard';

import { DashboardGridPinnedItemTitle } from './DashboardGridPinnedItemTitle';
import type {
  DashboardGridItem,
  DashboardGridPinnedItemHandle,
} from './dashboardGridTypes';

const Chart = dynamic(() => import('@/components/chart'), {
  ssr: false,
});

const DASHBOARD_PREVIEW_CONCURRENCY = 3;
let activeDashboardPreviewRequests = 0;
type DashboardPreviewQueueJob = {
  cancel: () => void;
  cancelled: boolean;
  run: () => void;
  started: boolean;
};
const dashboardPreviewQueue: DashboardPreviewQueueJob[] = [];

const runNextDashboardPreview = () => {
  while (
    activeDashboardPreviewRequests < DASHBOARD_PREVIEW_CONCURRENCY &&
    dashboardPreviewQueue.length > 0
  ) {
    const next = dashboardPreviewQueue.shift();
    if (!next || next.cancelled) {
      continue;
    }
    next.run();
  }
};

const scheduleDashboardPreview = <TResult,>(
  task: () => Promise<TResult>,
): { cancel: () => void; promise: Promise<TResult> } => {
  let job: DashboardPreviewQueueJob | null = null;
  let settled = false;

  const promise = new Promise<TResult>((resolve, reject) => {
    const rejectAsCancelled = () => {
      if (settled) {
        return;
      }
      settled = true;
      reject(createAbortError('Dashboard preview request was cancelled'));
    };

    job = {
      cancelled: false,
      started: false,
      cancel: () => {
        if (!job || job.cancelled || settled) {
          return;
        }
        job.cancelled = true;
        if (!job.started) {
          const queuedIndex = dashboardPreviewQueue.indexOf(job);
          if (queuedIndex >= 0) {
            dashboardPreviewQueue.splice(queuedIndex, 1);
          }
          rejectAsCancelled();
        }
      },
      run: () => {
        if (!job || job.cancelled) {
          rejectAsCancelled();
          runNextDashboardPreview();
          return;
        }
        job.started = true;
        activeDashboardPreviewRequests += 1;
        task()
          .then((result) => {
            if (!settled) {
              settled = true;
              resolve(result);
            }
          })
          .catch((error) => {
            if (!settled) {
              settled = true;
              reject(error);
            }
          })
          .finally(() => {
            activeDashboardPreviewRequests = Math.max(
              0,
              activeDashboardPreviewRequests - 1,
            );
            runNextDashboardPreview();
          });
      },
    };

    dashboardPreviewQueue.push(job);
    runNextDashboardPreview();
  });

  return {
    cancel: () => job?.cancel(),
    promise,
  };
};

const toPreferredRenderer = (value: unknown): 'svg' | 'canvas' | undefined =>
  value === 'svg' || value === 'canvas' ? value : undefined;

const toDashboardTablePreview = (previewItem?: DashboardPreviewData | null) => {
  const rows = previewItem?.data || [];
  const columns = previewItem?.columns?.length
    ? previewItem.columns.map((column) => column.name)
    : Array.from(new Set(rows.flatMap((row) => Object.keys(row || {}))));

  return {
    columns: columns.map((name) => ({
      dataIndex: name,
      key: name,
      title: name,
      titleText: name,
    })),
    data: rows.map((row) => columns.map((column) => row[column])),
  };
};

export const DashboardGridPinnedItem = forwardRef(
  (
    props: {
      item: DashboardGridItem;
      isSupportCached: boolean;
      readOnly?: boolean;
      runtimeScopeSelector: ClientRuntimeScopeSelector;
      onDelete: (id: number) => Promise<void>;
      onItemUpdated: (item: DashboardGridItem) => void;
      onNavigateToThread: (
        threadId?: number | null,
        responseId?: number | null,
      ) => Promise<void>;
    },
    ref: React.ForwardedRef<DashboardGridPinnedItemHandle>,
  ) => {
    const {
      item,
      isSupportCached,
      readOnly = false,
      runtimeScopeSelector,
      onDelete,
      onItemUpdated,
      onNavigateToThread,
    } = props;
    const { detail } = item;
    const [isHideLegend, setIsHideLegend] = useState(true);
    const [forceLoading, setForceLoading] = useState(false);
    const [forceUpdate, setForceUpdate] = useState(0);
    const [previewItem, setPreviewItem] = useState<DashboardPreviewData | null>(
      null,
    );
    const [previewLoading, setPreviewLoading] = useState(false);
    const previewRequestIdRef = useRef(0);
    const previewCancelRef = useRef<(() => void) | null>(null);

    const loadPreview = useCallback(
      async ({ refresh = false }: { refresh?: boolean } = {}) => {
        if (readOnly) {
          previewRequestIdRef.current += 1;
          previewCancelRef.current?.();
          previewCancelRef.current = null;
          setPreviewItem(null);
          setPreviewLoading(false);
          return null;
        }

        const requestId = previewRequestIdRef.current + 1;
        previewRequestIdRef.current = requestId;
        previewCancelRef.current?.();
        previewCancelRef.current = null;
        setPreviewLoading(true);

        const abortController = new AbortController();
        const scheduledPreview = scheduleDashboardPreview(() =>
          previewDashboardItem(
            runtimeScopeSelector,
            item.id,
            refresh ? { refresh: isSupportCached } : {},
            { signal: abortController.signal },
          ),
        );
        previewCancelRef.current = () => {
          scheduledPreview.cancel();
          abortWithReason(
            abortController,
            'Dashboard preview request was superseded',
          );
        };

        try {
          const payload = await scheduledPreview.promise;

          if (previewRequestIdRef.current === requestId) {
            setPreviewItem(payload);
          }

          return payload;
        } catch (error) {
          if (previewRequestIdRef.current === requestId) {
            const errorMessage = resolveAbortSafeErrorMessage(
              error,
              '加载看板图表失败，请稍后重试。',
            );
            if (errorMessage) {
              setPreviewItem(null);
              message.error(errorMessage);
            }
          }
          return null;
        } finally {
          if (previewRequestIdRef.current === requestId) {
            previewCancelRef.current = null;
            setPreviewLoading(false);
          }
        }
      },
      [isSupportCached, item.id, readOnly, runtimeScopeSelector],
    );

    useImperativeHandle(
      ref,
      () => ({
        onRefresh: () => {
          if (readOnly) {
            return;
          }
          void loadPreview({ refresh: true });
        },
      }),
      [loadPreview, readOnly],
    );

    const lastRefreshTime =
      previewItem?.cacheOverrodeAt || previewItem?.cacheCreatedAt;

    useEffect(
      () => () => {
        previewRequestIdRef.current += 1;
        previewCancelRef.current?.();
        previewCancelRef.current = null;
      },
      [],
    );

    useEffect(() => {
      if (readOnly) {
        previewRequestIdRef.current += 1;
        previewCancelRef.current?.();
        previewCancelRef.current = null;
        setPreviewItem(null);
        setPreviewLoading(false);
        return;
      }
      void loadPreview();
    }, [
      detail.canonicalizationVersion,
      detail.queryControls,
      detail.sql,
      item.id,
      loadPreview,
      readOnly,
    ]);

    useEffect(() => {
      setForceLoading(true);
      nextTick(200).then(() => {
        setForceUpdate((prev) => prev + 1);
        setForceLoading(false);
      });
    }, [item.layout]);

    const isTableItem = item.type === DashboardItemType.TABLE;
    const isNumberItem = item.type === DashboardItemType.NUMBER;
    const tablePreview = useMemo(
      () => (isTableItem ? toDashboardTablePreview(previewItem) : null),
      [isTableItem, previewItem],
    );
    const title = useMemo(
      () =>
        item.displayName ||
        item.detail?.chartSchema?.title ||
        item.detail?.sourceQuestion ||
        (isTableItem ? '数据表' : isNumberItem ? '指标卡' : ''),
      [
        isTableItem,
        isNumberItem,
        item.detail?.chartSchema?.title,
        item.detail?.sourceQuestion,
        item.displayName,
      ],
    );
    const queryControlsLabel = useMemo(
      () => formatDashboardQueryControlsLabel(detail.queryControls),
      [detail.queryControls],
    );

    const onMoreClick = async (
      payload: MORE_ACTION | { type: MORE_ACTION; data: unknown },
    ) => {
      const action =
        typeof payload === 'object' && payload !== null
          ? payload.type
          : payload;
      if (action === MORE_ACTION.DELETE) {
        await onDelete(item.id);
      } else if (action === MORE_ACTION.REFRESH) {
        if (readOnly) {
          return;
        }
        await loadPreview({ refresh: true });
      } else if (action === MORE_ACTION.HIDE_CATEGORY) {
        setIsHideLegend((prev) => !prev);
        setForceUpdate((prev) => prev + 1);
      }
    };

    const loading = readOnly ? false : forceLoading || previewLoading;
    const validationErrors = (detail.validationErrors || []).filter(Boolean);

    return (
      <div className="adm-pinned-item">
        <div className="adm-pinned-item-header">
          <div
            className="adm-pinned-item-title"
            title={title}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <DashboardGridPinnedItemTitle
              id={item.id}
              title={title}
              readOnly={readOnly}
              runtimeScopeSelector={runtimeScopeSelector}
              onRename={onItemUpdated}
            />
            {queryControlsLabel ? (
              <div
                className="adm-pinned-item-query-control"
                title={queryControlsLabel}
              >
                {queryControlsLabel}
              </div>
            ) : null}
          </div>

          <div className="adm-pinned-actions">
            {item.detail?.sourceThreadId != null ? (
              <Button
                type="text"
                size="small"
                onMouseDown={(event) => event.stopPropagation()}
                onTouchStart={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  void onNavigateToThread(
                    item.detail?.sourceThreadId,
                    item.detail?.sourceResponseId,
                  );
                }}
              >
                来源线程
              </Button>
            ) : null}
            <DashboardItemDropdown
              onMoreClick={onMoreClick}
              isHideLegend={isHideLegend}
              isSupportCached={isSupportCached}
              disableRefresh={readOnly}
              disableDelete={readOnly}
              hideCategoryToggle={isTableItem || isNumberItem}
            >
              <Button
                className="adm-pinned-more gray-8"
                type="text"
                size="small"
                icon={<MoreIcon />}
                onMouseDown={(event) => event.stopPropagation()}
              />
            </DashboardItemDropdown>
          </div>
        </div>
        <div className="adm-pinned-content">
          <div className="adm-pinned-content-overflow adm-scrollbar-track">
            {validationErrors.length > 0 ? (
              <Alert
                style={{ marginBottom: 12 }}
                type="warning"
                showIcon
                title="图表已按兼容模式渲染"
                description={validationErrors[0]}
              />
            ) : null}
            <LoadingWrapper
              loading={loading}
              tip={
                isTableItem
                  ? '数据表加载中…'
                  : isNumberItem
                    ? '指标卡加载中…'
                    : '图表加载中…'
              }
            >
              {readOnly ? (
                <Alert
                  showIcon
                  type="info"
                  title="历史快照下不支持执行看板查询。"
                />
              ) : isTableItem ? (
                <PreviewDataContent
                  columns={tablePreview?.columns || []}
                  data={tablePreview?.data || []}
                  loading={loading}
                  locale={{ emptyText: '暂无数据' }}
                />
              ) : isNumberItem ? (
                <NumberCardGroup
                  columns={previewItem?.columns || []}
                  rows={previewItem?.data || []}
                  variant="pinned"
                />
              ) : (
                <Chart
                  className="adm-pinned-item-chart"
                  width="100%"
                  height="100%"
                  spec={detail.chartSchema}
                  preferredRenderer={toPreferredRenderer(
                    detail.renderHints?.preferredRenderer,
                  )}
                  values={previewItem?.data}
                  forceUpdate={forceUpdate}
                  autoFilter={
                    !(previewItem?.chartDataProfile || detail.chartDataProfile)
                  }
                  hideActions
                  hideTitle
                  hideLegend={isHideLegend}
                  isPinned
                  cacheKey={`dashboard-item:${item.id}:${
                    detail.canonicalizationVersion || 'legacy'
                  }`}
                  serverShaped={Boolean(
                    previewItem?.chartDataProfile || detail.chartDataProfile,
                  )}
                />
              )}
            </LoadingWrapper>
          </div>
          {lastRefreshTime && (
            <div className="adm-pinned-content-info">
              {detail.canonicalizationVersion ? (
                <span style={{ marginRight: 8 }}>
                  {detail.canonicalizationVersion}
                </span>
              ) : null}
              最近刷新：{getCompactTime(lastRefreshTime)}
            </div>
          )}
        </div>
      </div>
    );
  },
);

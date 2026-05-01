import { test, expect, Page } from '@playwright/test';
import knex from 'knex';
import * as helper from '../helper';
import { testDbConfig } from '../config';
import { SampleDatasetName } from '@/types/dataSource';

const CHART_QUESTION = '统计 2017-01-01 到 2017-01-03 每日订单量趋势';
const DASHBOARD_NAME_PREFIX = 'E2E 动态日期看板';
const SQL_WITH_DATE_WINDOW = `
SELECT
  CAST(order_purchase_timestamp AS DATE) AS order_date,
  COUNT(*) AS order_count
FROM olist_orders_dataset
WHERE order_purchase_timestamp >= '2017-01-01'
  AND order_purchase_timestamp < '2017-01-04'
GROUP BY 1
ORDER BY 1
`.trim();

const buildWorkspaceScopeQuery = (selector: helper.RuntimeScopeFixture) => {
  const params = new URLSearchParams();
  params.set('workspaceId', selector.workspaceId);
  return params.toString();
};

const seedChartThreadResponse = async (
  selector: helper.RuntimeScopeFixture,
) => {
  const db = knex(testDbConfig);

  try {
    const knowledgeBase = await db('knowledge_base')
      .where({ id: selector.knowledgeBaseId })
      .first({
        defaultKbSnapshotId: 'default_kb_snapshot_id',
        runtimeProjectId: 'runtime_project_id',
      });
    expect(knowledgeBase?.defaultKbSnapshotId).toBeTruthy();

    const kbSnapshot = await db('kb_snapshot')
      .where({ id: knowledgeBase.defaultKbSnapshotId })
      .first({ deployHash: 'deploy_hash' });
    expect(kbSnapshot?.deployHash).toBeTruthy();

    const now = new Date().toISOString();
    const [thread] = await db('thread')
      .insert({
        project_id: knowledgeBase.runtimeProjectId || null,
        workspace_id: selector.workspaceId,
        knowledge_base_id: selector.knowledgeBaseId,
        knowledge_base_ids: JSON.stringify([selector.knowledgeBaseId]),
        kb_snapshot_id: knowledgeBase.defaultKbSnapshotId,
        deploy_hash: kbSnapshot.deployHash,
        summary: CHART_QUESTION,
        created_at: now,
        updated_at: now,
      })
      .returning(['id']);

    const threadId = Number(thread.id);
    const chartDetail = {
      status: 'FINISHED',
      chartType: 'LINE',
      description: '按订单日期展示订单量趋势。',
      chartSchema: {
        $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
        title: '每日订单量趋势',
        mark: { type: 'line', point: true },
        encoding: {
          x: {
            field: 'order_date',
            type: 'temporal',
            title: '订单日期',
          },
          y: {
            field: 'order_count',
            type: 'quantitative',
            title: '订单量',
          },
        },
      },
      canonicalizationVersion: 'e2e-dynamic-date',
      renderHints: { preferredRenderer: 'svg' },
      validationErrors: [],
    };

    const [response] = await db('thread_response')
      .insert({
        thread_id: threadId,
        project_id: knowledgeBase.runtimeProjectId || null,
        workspace_id: selector.workspaceId,
        knowledge_base_id: selector.knowledgeBaseId,
        kb_snapshot_id: knowledgeBase.defaultKbSnapshotId,
        deploy_hash: kbSnapshot.deployHash,
        question: CHART_QUESTION,
        response_kind: 'CHART_FOLLOWUP',
        sql: SQL_WITH_DATE_WINDOW,
        chart_detail: JSON.stringify(chartDetail),
        created_at: now,
        updated_at: now,
      })
      .returning(['id']);

    return {
      threadId,
      responseId: Number(response.id),
    };
  } finally {
    await db.destroy();
  }
};

const createDashboardViaRest = async ({
  page,
  selector,
  name,
}: {
  page: Page;
  selector: helper.RuntimeScopeFixture;
  name: string;
}) => {
  const response = await page.request.post(
    `/api/v1/dashboards?${buildWorkspaceScopeQuery(selector)}`,
    {
      data: { name },
    },
  );
  const body = await response.text();
  expect(response.ok(), body).toBeTruthy();
  return JSON.parse(body) as { id: number; name: string };
};

const openChartWorkbench = async ({
  page,
  selector,
  threadId,
}: {
  page: Page;
  selector: helper.RuntimeScopeFixture;
  threadId: number;
}) => {
  await helper.gotoRuntimeScopedPath({
    page,
    pathname: `/home/${threadId}`,
    selector,
  });
  await helper.expectPathname({ page, pathname: `/home/${threadId}` });
  await expect(page.getByRole('heading', { name: CHART_QUESTION })).toBeVisible(
    { timeout: 60_000 },
  );

  const workbench = page.getByTestId('thread-workbench');
  if (!(await workbench.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /查看图表|View chart/ }).click();
  }
  await expect(workbench).toBeVisible({ timeout: 60_000 });
  await expect(workbench.getByRole('tab', { name: '图表' })).toBeVisible({
    timeout: 60_000,
  });
};

const pinChartWithRollingDate = async ({
  page,
  dashboardName,
}: {
  page: Page;
  dashboardName: string;
}) => {
  const workbench = page.getByTestId('thread-workbench');
  const pinButton = workbench
    .getByRole('button', { name: /固定到看板|Pin to dashboard/ })
    .first();
  await expect(pinButton).toBeVisible({ timeout: 60_000 });
  await pinButton.click();

  const configDialog = page.getByRole('dialog', { name: '固定到看板' });
  if (!(await configDialog.isVisible().catch(() => false))) {
    const popover = page
      .locator('.ant-popover')
      .filter({ hasText: '新建看板并固定' })
      .last();
    await expect(popover).toBeVisible({ timeout: 60_000 });
    await popover.getByRole('button', { name: dashboardName }).click();
  }

  await expect(configDialog).toBeVisible({ timeout: 60_000 });
  await expect(configDialog.getByText('数据时间范围')).toBeVisible();
  await expect(configDialog.getByText('随时间自动滚动')).toBeVisible();
  await expect(configDialog.getByText(/保持 3 天窗口/)).toBeVisible();
  await expect(configDialog.getByText(/预览：本次刷新会查询/)).toBeVisible();

  await configDialog.getByRole('button', { name: '固定到看板' }).click();
  await expect(page.getByText(/日期范围将随刷新自动滚动/)).toBeVisible({
    timeout: 60_000,
  });
};

const cleanupDynamicDateArtifacts = async () => {
  const db = knex(testDbConfig);

  try {
    const dynamicDashboardIds = (
      await db('dashboard')
        .where('name', 'like', `${DASHBOARD_NAME_PREFIX}%`)
        .select('id')
    ).map((row) => row.id);

    if (dynamicDashboardIds.length > 0) {
      await db('dashboard').whereIn('id', dynamicDashboardIds).delete();
    }

    await db('thread').where({ summary: CHART_QUESTION }).delete();
  } finally {
    await db.destroy();
  }
};

const expectPersistedRollingControls = async (responseId: number) => {
  const db = knex(testDbConfig);

  try {
    const item = await db('dashboard_item')
      .whereRaw("detail->>'sourceResponseId' = ?", [String(responseId)])
      .orderBy('id', 'desc')
      .first('detail');
    expect(item).toBeTruthy();
    const detail =
      typeof item.detail === 'string' ? JSON.parse(item.detail) : item.detail;
    expect(detail.queryControls?.version).toBe('dashboard-query-controls-v1');
    expect(detail.queryControls?.timeFilters?.[0]).toMatchObject({
      anchor: 'last_complete_day',
      mode: 'rolling_window',
      originalStartDate: '2017-01-01',
      originalEndDate: '2017-01-04',
      windowDays: 3,
      sqlBinding: {
        kind: 'gte_lt',
        startLiteral: '2017-01-01',
        endLiteral: '2017-01-04',
      },
    });
  } finally {
    await db.destroy();
  }
};

test.describe('Dashboard dynamic date pinning', () => {
  test.describe.configure({ timeout: 240_000 });

  test.beforeEach(async () => {
    await helper.resetDatabase();
    await cleanupDynamicDateArtifacts();
  });

  test.afterEach(async () => {
    await cleanupDynamicDateArtifacts();
  });

  test('opens rolling date controls while pinning a chart and persists them on the dashboard item', async ({
    page,
  }) => {
    const selector = await helper.ensureSystemSampleRuntimeScope({
      page,
      sampleDataset: SampleDatasetName.ECOMMERCE,
    });
    const dashboardName = `${DASHBOARD_NAME_PREFIX} ${Date.now()}`;
    const dashboard = await createDashboardViaRest({
      page,
      selector,
      name: dashboardName,
    });
    const seeded = await seedChartThreadResponse(selector);

    await openChartWorkbench({
      page,
      selector,
      threadId: seeded.threadId,
    });
    await pinChartWithRollingDate({ page, dashboardName });

    await helper.gotoRuntimeScopedPath({
      page,
      pathname: '/home/dashboard',
      selector: {
        workspaceId: selector.workspaceId,
        dashboardId: String(dashboard.id),
      },
    });
    await helper.expectPathname({ page, pathname: '/home/dashboard' });
    await expect(page.getByText(dashboardName).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('[data-dashboard-item-id]').first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText('日期策略：滚动 3 天 · 到昨天')).toBeVisible({
      timeout: 60_000,
    });

    await expectPersistedRollingControls(seeded.responseId);
  });
});

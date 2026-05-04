import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3002';
const AUTH_EMAIL = process.env.AUTH_EMAIL || 'admin@example.com';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'Admin@123';
const HEADLESS = process.env.HEADLESS !== '0';
const ASK_TIMEOUT_MS = Number(process.env.ASK_TIMEOUT_MS || '420000');
const BETWEEN_CASES_MS = Number(process.env.BETWEEN_CASES_MS || '1800');
const OUT_DIR = path.resolve(
  process.env.OUT_DIR || 'wren-ui/tmp/tidb-full-external-supply-e2e-output',
);

const selector = {
  workspaceId:
    process.env.WORKSPACE_ID || '30de9fce-90f4-45ce-84cd-0c3826800adf',
  knowledgeBaseId:
    process.env.KNOWLEDGE_BASE_ID || 'cd5efb36-8d8d-4022-8174-5a28c361ab10',
  kbSnapshotId:
    process.env.KB_SNAPSHOT_ID || '9481437c-4ddb-402c-aa15-b986523a9b16',
  deployHash:
    process.env.DEPLOY_HASH || '5e269f7df7b3680f146a1ed5d9bec484e0788e61',
};

const fullExternalDailyCsv = [
  'biz_date,tenant_plat_id,channel_id,ad_spend,access_pv,access_uv,download_click_uv',
  '2026-04-01,990001,990011,1120,12530,3150,845',
  '2026-04-02,990001,990011,1240,13060,3300,890',
  '2026-04-03,990001,990011,1360,13590,3450,935',
  '2026-04-04,990001,990011,1480,14120,3600,980',
  '2026-04-05,990001,990011,1600,14650,3750,1025',
  '2026-04-06,990001,990011,1720,15180,3900,1070',
].join('\n');

const roiAdSpendCsv = [
  'date,channel_id,ad_spend',
  '2026-04-01,990011,1120',
  '2026-04-02,990011,1240',
  '2026-04-03,990011,1360',
  '2026-04-04,990011,1480',
  '2026-04-05,990011,1600',
  '2026-04-06,990011,1720',
  '2026-04-07,990011,1840',
].join('\n');

const ft01Columns = [
  '日期',
  '所属站点',
  '所属渠道商',
  '渠道名称',
  '投放金额',
  '登陆人数',
  '存款总人数',
  '存款总金额',
  '提现总金额',
  '充提差',
  'PV',
  'UV',
  '下载点击UV',
  'UV下载率',
  '注册人数',
  'UV注册率',
  '首存人数',
  '新客首存人数',
  '开发人数',
  '首存成本',
  '首存率',
  '首存总金额',
  '首存人均金额',
  '新客存款金额',
  '投注人数',
  '有效投注',
  '会员输赢',
  '杀率',
  '任务彩金',
  '洗码',
  '优惠加扣款',
  '营销+彩票',
  '合计优惠',
];

const roiColumns = [
  '日期',
  '站点名称',
  '所属渠道商',
  '渠道名称',
  '投放金额',
  '用户类型',
  '累计1天',
  '3天',
  '7天',
  '15天',
  '30天',
  '60天',
  '90天',
  '120天',
  '150天',
  '180天',
  '210天',
  '240天',
  '270天',
  '300天',
  '330天',
  '360天',
];

const cases = [
  {
    testId: 'FT01-FULL-EXTERNAL',
    question:
      '生成第一期综合日报表完整宽表：租户平台990001渠道990011在2026-04-01到2026-04-06每日综合日报，要求列名列序贴合Excel 综合日报表!A41:AG46，包含汇总行、投放金额、PV、UV、下载点击UV、UV下载率、UV注册率、首存成本、首存率、有效投注、会员输赢、杀率、合计优惠。',
    slotValues: {
      'external_dependency:ad_spend': fullExternalDailyCsv,
      'external_dependency:access_pv': fullExternalDailyCsv,
      'external_dependency:access_uv': fullExternalDailyCsv,
      'external_dependency:download_click_uv': fullExternalDailyCsv,
    },
    expectedColumns: ft01Columns,
    expectedRowCount: 7,
    sqlIncludes: [
      'external_metrics AS',
      "DATE '2026-04-01' AS biz_date",
      '990001 AS tenant_plat_id',
      '990011 AS channel_id',
      '1120 AS ad_spend',
      '12530 AS access_pv',
      '3150 AS access_uv',
      '845 AS download_click_uv',
    ],
    previewIncludes: ['汇总', '2026-04-01', '2026-04-06'],
  },
  {
    testId: 'FT02-FULL-EXTERNAL',
    question:
      '生成第一期ROI回收表里的渠道整体ROI表：租户平台990001渠道990011首存日期2026-04-01到2026-04-07，输出Excel固定回收周期列D1/D3/D7/D15/D30/D60/D90/D120/D150/D180/D210/D240/D270/D300/D330/D360的ROI宽表和环比，贴合Excel ROI回收表!A11:V18。',
    slotValues: {
      'external_dependency:ad_spend': roiAdSpendCsv,
    },
    expectedColumns: roiColumns,
    expectedRowCount: 9,
    sqlIncludes: [
      'supplied_external_ad_spend AS',
      "DATE '2026-04-01' AS biz_date",
      '990011 AS channel_id',
      '1120 AS ad_spend',
    ],
    previewIncludes: ['汇总', '全部用户', '环比系数', '2026-04-07'],
  },
  {
    testId: 'FT04-FULL-EXTERNAL',
    question:
      '生成第一期ROI回收表里的渠道TOP3 ROI表：租户平台990001渠道990011首存日期2026-04-01到2026-04-07，输出Excel固定回收周期列D1/D3/D7/D15/D30/D60/D90/D120/D150/D180/D210/D240/D270/D300/D330/D360的TOP3 ROI宽表和环比，贴合Excel ROI回收表!A32:V37。',
    slotValues: {
      'external_dependency:ad_spend': roiAdSpendCsv,
    },
    expectedColumns: roiColumns,
    expectedRowCount: 9,
    sqlIncludes: [
      'supplied_external_ad_spend AS',
      'bet_rank <= 3',
      "'TOP3' AS user_type",
    ],
    previewIncludes: ['汇总', 'TOP3', '环比系数', '2026-04-07'],
  },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => new Date().toISOString();
const safeId = (value) =>
  String(value || '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .slice(0, 80);

function qs(extra = {}) {
  const params = new URLSearchParams();
  Object.entries({ ...selector, ...extra }).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  });
  return params.toString();
}

const scopedUrl = (pathname, extra = {}) => `${BASE_URL}${pathname}?${qs(extra)}`;
const promptInput = (page) => page.locator('textarea[placeholder]').last();
const sendButton = (page) => page.locator('button.prompt-send-button').last();

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function resolveThreadIdFromUrl(url) {
  try {
    return Number(new URL(url).pathname.match(/\/home\/(\d+)/)?.[1]) || null;
  } catch {
    return null;
  }
}

async function login(context) {
  const response = await context.request.post(`${BASE_URL}/api/auth/login`, {
    headers: { 'content-type': 'application/json' },
    data: { email: AUTH_EMAIL, password: AUTH_PASSWORD },
  });
  if (!response.ok()) {
    throw new Error(`login failed: ${response.status()} ${await response.text()}`);
  }
}

async function fetchJson(request, url, options = {}) {
  const response = await request.fetch(url, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok()) {
    throw new Error(
      `${options.method || 'GET'} ${url} failed: ${response.status()} ${
        typeof body === 'string'
          ? body.slice(0, 1200)
          : JSON.stringify(body).slice(0, 1200)
      }`,
    );
  }
  return body;
}

const fetchThreadDetail = (request, threadId) =>
  fetchJson(request, scopedUrl(`/api/v1/threads/${threadId}`));

async function waitForPrompt(page) {
  await promptInput(page).waitFor({ state: 'visible', timeout: 120000 });
  await sendButton(page).waitFor({ state: 'visible', timeout: 120000 });
}

async function gotoHome(page) {
  await page.goto(scopedUrl('/home'), { waitUntil: 'domcontentloaded' });
  await waitForPrompt(page);
}

async function waitForThreadId(page, previousThreadId) {
  const existing = resolveThreadIdFromUrl(page.url());
  if (existing && existing !== previousThreadId) {
    return existing;
  }
  await page.waitForFunction(() => /\/home\/\d+/.test(window.location.pathname), {
    timeout: 120000,
  });
  const threadId = resolveThreadIdFromUrl(page.url());
  if (!threadId) {
    throw new Error(`cannot resolve thread id from ${page.url()}`);
  }
  return threadId;
}

async function waitForInitialClarificationOrSql(page, request, threadId) {
  const deadline = Date.now() + ASK_TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    const textareas = await page
      .locator('textarea[id^="external_dependency:"]')
      .count()
      .catch(() => 0);
    if (textareas > 0) {
      const detail = await fetchThreadDetail(request, threadId);
      return {
        type: 'clarification',
        detail,
        maxResponseId: Math.max(0, ...(detail.responses || []).map((r) => r.id)),
      };
    }

    const detail = await fetchThreadDetail(request, threadId);
    const latest = [...(detail.responses || [])].reverse().find((response) => {
      return response.responseKind !== 'CHART_FOLLOWUP';
    });
    if (latest) {
      last = latest;
      if (latest.answerDetail?.status === 'FINISHED' && latest.sql) {
        return {
          type: 'sql',
          detail,
          response: latest,
          maxResponseId: latest.id,
        };
      }
      if (latest.answerDetail?.status === 'FAILED') {
        throw new Error(
          `initial response failed: ${latest.answerDetail?.error || latest.answerDetail?.lastError || JSON.stringify(latest.answerDetail)}`,
        );
      }
    }
    await sleep(1500);
  }
  throw new Error(
    `timeout waiting for external clarification form or SQL. last=${JSON.stringify(
      last?.answerDetail || null,
    ).slice(0, 1200)}`,
  );
}

async function fillExternalDependencyForm(page, testCase) {
  const textarea = page.locator('textarea[id^="external_dependency:"]');
  await textarea.first().waitFor({ state: 'visible', timeout: 120000 });
  const visibleSlots = await textarea.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('id')).filter(Boolean),
  );

  for (const slotId of visibleSlots) {
    const value =
      testCase.slotValues[slotId] ||
      testCase.slotValues[slotId.replace(/^external_dependency:/, 'external_dependency.')] ||
      Object.values(testCase.slotValues)[0];
    if (!value) {
      throw new Error(`no supplied CSV configured for slot ${slotId}`);
    }
    await page.locator(`textarea[id="${slotId}"]`).fill(value);
  }

  await page.getByRole('button', { name: /补充并继续/ }).last().click();
  return visibleSlots;
}

async function waitForSqlResponseAfterSupply(request, threadId, minResponseId) {
  const deadline = Date.now() + ASK_TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    const detail = await fetchThreadDetail(request, threadId);
    const responses = [...(detail.responses || [])].reverse();
    const response = responses.find((item) => {
      if (item.responseKind === 'CHART_FOLLOWUP') {
        return false;
      }
      return item.id > minResponseId || item.sql;
    });
    if (response) {
      last = response;
      if (response.answerDetail?.status === 'FINISHED' && response.sql) {
        return { thread: detail, response };
      }
      if (response.answerDetail?.status === 'FAILED') {
        throw new Error(
          `supplied response failed: ${response.answerDetail?.error || response.answerDetail?.lastError || JSON.stringify(response.answerDetail)}`,
        );
      }
    }
    await sleep(1500);
  }
  throw new Error(
    `timeout waiting for supplied SQL response. last=${JSON.stringify(
      last?.answerDetail || null,
    ).slice(0, 1200)}`,
  );
}

async function previewSql(request, sql) {
  return fetchJson(request, scopedUrl('/api/v1/internal/sql/preview'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-wren-ai-service-internal': '1',
    },
    data: {
      sql,
      limit: 100,
      dryRun: false,
      runtimeScopeId: selector.deployHash,
      sqlMode: 'dialect',
    },
  });
}

function normalizePreview(preview) {
  const data = preview?.data || preview || {};
  return {
    correlationId: data.correlationId || preview?.correlationId || '',
    columns: (data.columns || []).map((column) =>
      typeof column === 'string' ? column : column.name,
    ),
    rows: data.data || data.rows || [],
  };
}

function assertIncludesAll(actual, expected, label) {
  const missing = expected.filter((item) => !actual.includes(item));
  if (missing.length) {
    throw new Error(`${label} missing: ${missing.join(', ')}`);
  }
}

function evaluatePreview(testCase, response, preview) {
  const sql = response.sql || '';
  const normalized = normalizePreview(preview);
  const flattenedPreview = JSON.stringify(normalized.rows);
  const failures = [];

  for (const snippet of testCase.sqlIncludes) {
    if (!sql.includes(snippet)) {
      failures.push(`SQL 未包含: ${snippet}`);
    }
  }

  const missingColumns = testCase.expectedColumns.filter(
    (column, index) => normalized.columns[index] !== column,
  );
  if (missingColumns.length || normalized.columns.length !== testCase.expectedColumns.length) {
    failures.push(
      `列名/列序不匹配: expected=${testCase.expectedColumns.join('|')} actual=${normalized.columns.join('|')}`,
    );
  }

  if (normalized.rows.length !== testCase.expectedRowCount) {
    failures.push(
      `行数不匹配: expected=${testCase.expectedRowCount} actual=${normalized.rows.length}`,
    );
  }

  for (const item of testCase.previewIncludes) {
    if (!flattenedPreview.includes(item)) {
      failures.push(`预览数据未包含: ${item}`);
    }
  }

  return {
    status: failures.length ? 'FAIL' : 'PASS',
    failures,
    preview: {
      correlationId: normalized.correlationId,
      columnCount: normalized.columns.length,
      rowCount: normalized.rows.length,
      columns: normalized.columns,
      firstRows: normalized.rows.slice(0, 3),
    },
  };
}

async function runCase(page, request, testCase) {
  const caseDir = path.join(OUT_DIR, safeId(testCase.testId));
  await ensureDir(caseDir);
  const startedAt = now();
  const responseErrors = [];
  const consoleErrors = [];
  const onConsole = (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  };
  const onResponse = async (response) => {
    if (!response.url().startsWith(BASE_URL) || response.status() < 400) {
      return;
    }
    let body = '';
    try {
      body = await response.text();
    } catch {
      body = '';
    }
    responseErrors.push(`${response.status()} ${response.url()} ${body.slice(0, 800)}`);
  };
  page.on('console', onConsole);
  page.on('response', onResponse);

  try {
    await gotoHome(page);
    await fs.writeFile(path.join(caseDir, 'question.txt'), testCase.question, 'utf8');
    await page.screenshot({ path: path.join(caseDir, 'before.png'), fullPage: true }).catch(() => {});
    const previousThreadId = resolveThreadIdFromUrl(page.url());
    await promptInput(page).fill(testCase.question);
    await sendButton(page).click();
    const threadId = await waitForThreadId(page, previousThreadId);
    const initial = await waitForInitialClarificationOrSql(page, request, threadId);

    let suppliedSlots = [];
    let response = initial.response || null;
    if (initial.type === 'clarification') {
      await page.screenshot({
        path: path.join(caseDir, 'clarification-form.png'),
        fullPage: true,
      }).catch(() => {});
      suppliedSlots = await fillExternalDependencyForm(page, testCase);
      ({ response } = await waitForSqlResponseAfterSupply(
        request,
        threadId,
        initial.maxResponseId,
      ));
    }

    if (!response?.sql) {
      throw new Error('SQL is missing after external data supply');
    }

    await fs.writeFile(path.join(caseDir, 'sql.sql'), response.sql, 'utf8');
    await page.screenshot({ path: path.join(caseDir, 'answer.png'), fullPage: true }).catch(() => {});
    const preview = await previewSql(request, response.sql);
    await fs.writeFile(path.join(caseDir, 'preview.json'), JSON.stringify(preview, null, 2));
    const evaluation = evaluatePreview(testCase, response, preview);

    const record = {
      testId: testCase.testId,
      question: testCase.question,
      status: evaluation.status,
      failures: evaluation.failures,
      startedAt,
      endedAt: now(),
      threadId,
      responseId: response.id,
      suppliedSlots,
      hasSql: true,
      sqlLength: response.sql.length,
      answerStatus: response.answerDetail?.status || null,
      preview: evaluation.preview,
      contentPreview: (response.answerDetail?.content || '').slice(0, 2000),
      responseErrors,
      consoleErrors,
    };
    await fs.writeFile(path.join(caseDir, 'result.json'), JSON.stringify(record, null, 2));
    return record;
  } catch (error) {
    await page.screenshot({ path: path.join(caseDir, 'FAILED.png'), fullPage: true }).catch(() => {});
    const record = {
      testId: testCase.testId,
      question: testCase.question,
      status: 'FAIL',
      failures: [error instanceof Error ? error.message : String(error)],
      startedAt,
      endedAt: now(),
      responseErrors,
      consoleErrors,
    };
    await fs.writeFile(path.join(caseDir, 'result.json'), JSON.stringify(record, null, 2));
    return record;
  } finally {
    page.off('console', onConsole);
    page.off('response', onResponse);
  }
}

function summarize(results) {
  return {
    selector,
    generatedAt: now(),
    outDir: OUT_DIR,
    total: results.length,
    PASS: results.filter((item) => item.status === 'PASS').length,
    FAIL: results.filter((item) => item.status === 'FAIL').length,
    results: results.map((item) => ({
      testId: item.testId,
      status: item.status,
      threadId: item.threadId,
      responseId: item.responseId,
      suppliedSlots: item.suppliedSlots,
      preview: item.preview
        ? {
            columnCount: item.preview.columnCount,
            rowCount: item.preview.rowCount,
            correlationId: item.preview.correlationId,
          }
        : null,
      failures: item.failures,
    })),
  };
}

async function main() {
  await ensureDir(OUT_DIR);
  const only = new Set(
    String(process.env.ONLY_CASES || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
  const runCases = only.size
    ? cases.filter((testCase) => only.has(testCase.testId))
    : cases;
  if (!runCases.length) {
    throw new Error(`No cases selected by ONLY_CASES=${process.env.ONLY_CASES}`);
  }

  const browser = await chromium.launch({ headless: HEADLESS });
  const authContext = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 960 },
  });
  await login(authContext);
  const storageState = await authContext.storageState();
  await authContext.close();
  const context = await browser.newContext({
    storageState,
    acceptDownloads: true,
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();
  const results = [];
  try {
    for (let index = 0; index < runCases.length; index += 1) {
      const testCase = runCases[index];
      console.log(`[${testCase.testId}] start`);
      const result = await runCase(page, context.request, testCase);
      results.push(result);
      console.log(
        `[${testCase.testId}] ${result.status} thread=${result.threadId || '-'} response=${result.responseId || '-'} ${(result.failures || []).join(' | ')}`,
      );
      await fs.writeFile(
        path.join(OUT_DIR, 'summary.json'),
        JSON.stringify(summarize(results), null, 2),
      );
      if (index < runCases.length - 1) {
        await sleep(BETWEEN_CASES_MS);
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  const summary = summarize(results);
  await fs.writeFile(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (summary.FAIL > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

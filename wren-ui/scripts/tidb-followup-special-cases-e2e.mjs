import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3002';
const AUTH_EMAIL = process.env.AUTH_EMAIL || 'admin@example.com';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'Admin@123';
const HEADLESS = process.env.HEADLESS !== '0';
const ASK_TIMEOUT_MS = Number(process.env.ASK_TIMEOUT_MS || '420000');
const OUT_DIR = path.resolve(
  process.env.OUT_DIR || 'wren-ui/tmp/tidb-followup-special-cases-e2e-output',
);

const selector = {
  workspaceId:
    process.env.WORKSPACE_ID || '93467766-1944-40e8-99dd-90d5ccd60d6a',
  knowledgeBaseId:
    process.env.KNOWLEDGE_BASE_ID || 'c5813fb4-5cdf-4b06-8075-c8780153c926',
  kbSnapshotId:
    process.env.KB_SNAPSHOT_ID || 'ab3bae30-6b62-4cb4-a6ec-4388057436ed',
  deployHash:
    process.env.DEPLOY_HASH || '5e7e7550166799ed4fc1746662a86c115417813a',
};

const adSpendCsv = [
  'date,channel_id,ad_spend',
  '2026-04-01,990011,1000',
  '2026-04-02,990011,2000',
  '2026-04-03,990011,500',
].join('\n');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const promptInput = (page) => page.locator('textarea[placeholder]').last();
const sendButton = (page) => page.locator('button.prompt-send-button').last();

function qs(extra = {}) {
  const params = new URLSearchParams();
  Object.entries({ ...selector, ...extra }).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  });
  return params.toString();
}

function scopedUrl(pathname, extra = {}) {
  return `${BASE_URL}${pathname}?${qs(extra)}`;
}

function threadIdFromUrl(rawUrl) {
  try {
    return Number(new URL(rawUrl).pathname.match(/\/home\/(\d+)/)?.[1]) || null;
  } catch {
    return null;
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
        typeof body === 'string' ? body.slice(0, 1200) : JSON.stringify(body).slice(0, 1200)
      }`,
    );
  }
  return body;
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

async function waitForPrompt(page) {
  await promptInput(page).waitFor({ state: 'visible', timeout: 120000 });
  await sendButton(page).waitFor({ state: 'visible', timeout: 120000 });
}

async function fetchThread(request, threadId) {
  return fetchJson(request, scopedUrl(`/api/v1/threads/${threadId}`));
}

async function waitForAnswer(request, threadId, question, excludeResponseIds = new Set()) {
  const deadline = Date.now() + ASK_TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    const thread = await fetchThread(request, threadId);
    const response = [...(thread.responses || [])]
      .reverse()
      .find(
        (item) =>
          item.responseKind !== 'CHART_FOLLOWUP' &&
          !excludeResponseIds.has(item.id) &&
          (item.question === question || excludeResponseIds.size > 0),
      );
    if (response) {
      last = response;
      if (response.answerDetail?.status === 'FINISHED') {
        return response;
      }
      if (response.answerDetail?.status === 'FAILED') {
        throw new Error(`answer failed: ${JSON.stringify(response.answerDetail).slice(0, 1200)}`);
      }
    }
    await sleep(1500);
  }
  throw new Error(`timeout waiting answer for ${question}; last=${JSON.stringify(last?.answerDetail || null)}`);
}

async function ask(page, request, question, threadId = null) {
  await page.goto(scopedUrl(threadId ? `/home/${threadId}` : '/home'), {
    waitUntil: 'domcontentloaded',
  });
  await waitForPrompt(page);
  const beforeResponseIds = new Set();
  if (threadId) {
    const existingThread = await fetchThread(request, threadId);
    for (const response of existingThread.responses || []) {
      beforeResponseIds.add(response.id);
    }
  }
  const beforeThreadId = threadIdFromUrl(page.url());
  await promptInput(page).fill(question);
  await sendButton(page).click();
  if (!threadId) {
    await page.waitForFunction(
      (before) => {
        const match = window.location.pathname.match(/\/home\/(\d+)/);
        return match && Number(match[1]) !== before;
      },
      beforeThreadId || 0,
      { timeout: 120000 },
    );
    threadId = threadIdFromUrl(page.url());
  }
  if (!threadId) {
    throw new Error(`cannot resolve thread id from ${page.url()}`);
  }
  const response = await waitForAnswer(request, threadId, question, beforeResponseIds);
  return { threadId, response };
}

function summarizeAnswer(response) {
  const diagnostics = response.askingTask?.diagnostics || {};
  const semanticPlan = diagnostics.semanticPlan || {};
  const clarificationState = diagnostics.clarificationState || semanticPlan.clarificationState || null;
  return {
    responseId: response.id,
    hasSql: Boolean(response.sql),
    rowCount: response.answerDetail?.numRowsUsedInLLM ?? null,
    content: (response.answerDetail?.content || '').slice(0, 800),
    sqlPreview: (response.sql || '').slice(0, 2000),
    reasonCodes: semanticPlan.decision?.reasonCodes || semanticPlan.decision?.reason_codes || [],
    missingSlots: semanticPlan.decision?.missingSlots || semanticPlan.decision?.missing_slots || [],
    clarificationState,
  };
}

async function waitForChart(request, threadId, chartResponseId) {
  const deadline = Date.now() + ASK_TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    const thread = await fetchThread(request, threadId);
    const response = (thread.responses || []).find((item) => item.id === chartResponseId);
    if (response) {
      last = response.chartDetail || response;
      if (response.chartDetail?.status === 'FINISHED') {
        return response;
      }
      if (response.chartDetail?.status === 'FAILED') {
        throw new Error(`chart failed: ${JSON.stringify(response.chartDetail).slice(0, 1200)}`);
      }
    }
    await sleep(1500);
  }
  throw new Error(`timeout waiting chart ${chartResponseId}; last=${JSON.stringify(last).slice(0, 1200)}`);
}

async function runRoute05(page, request) {
  const baseQuestion =
    '统计租户平台990001下渠道990011在2026-04-01到2026-04-03首存cohort从D1到D7的ROI';
  const base = await ask(page, request, baseQuestion);
  const follow = await ask(page, request, adSpendCsv, base.threadId);
  const finalSummary = summarizeAnswer(follow.response);
  const status =
    !base.response.sql &&
    finalSummary.hasSql &&
    /supplied_external_ad_spend|ad_spend/i.test(follow.response.sql || '')
      ? 'PASS'
      : 'FAIL';
  return {
    testId: 'ROUTE05',
    status,
    threadId: base.threadId,
    base: summarizeAnswer(base.response),
    final: finalSummary,
  };
}

async function runRoute13(page, request) {
  const q1 = '看这个渠道最近ROI怎么样';
  const q2 = '租户平台990001';
  const q3 = '渠道990011，2026-04-01到2026-04-03，首存后D7';
  const first = await ask(page, request, q1);
  const second = await ask(page, request, q2, first.threadId);
  const third = await ask(page, request, q3, first.threadId);
  const final = await ask(page, request, adSpendCsv, first.threadId);
  const finalSummary = summarizeAnswer(final.response);
  const status =
    finalSummary.hasSql &&
    /990001/.test(final.response.sql || '') &&
    /990011/.test(final.response.sql || '') &&
    /supplied_external_ad_spend|ad_spend/i.test(final.response.sql || '')
      ? 'PASS'
      : 'FAIL';
  return {
    testId: 'ROUTE13',
    status,
    threadId: first.threadId,
    turns: [
      { question: q1, ...summarizeAnswer(first.response) },
      { question: q2, ...summarizeAnswer(second.response) },
      { question: q3, ...summarizeAnswer(third.response) },
      { question: adSpendCsv, ...finalSummary },
    ],
  };
}

async function runPx12(page, request) {
  const question =
    '统计租户平台990001下渠道990011在2026-04-01到2026-04-07全部用户、TOP5和非TOP5的存款、有效投注、输赢、投充比和杀率';
  const base = await ask(page, request, question);
  const chartCreated = await fetchJson(
    request,
    scopedUrl(`/api/v1/thread-responses/${base.response.id}/generate-chart`),
    { method: 'POST', headers: { 'content-type': 'application/json' }, data: {} },
  );
  const chartResponse = chartCreated?.id
    ? chartCreated
    : chartCreated?.data || chartCreated?.response || chartCreated;
  const chart = await waitForChart(request, base.threadId, chartResponse.id);
  const status = base.response.sql && chart.chartDetail?.status === 'FINISHED' ? 'PASS' : 'FAIL';
  return {
    testId: 'PX12',
    status,
    threadId: base.threadId,
    base: summarizeAnswer(base.response),
    chartResponseId: chart.id,
    chartStatus: chart.chartDetail?.status,
    chartType: chart.chartDetail?.chartSchema?.chartType || chart.chartDetail?.chartSchema?.type || null,
  };
}

await fs.mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: HEADLESS });
const setupContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
await login(setupContext);
const storageState = await setupContext.storageState();
await setupContext.close();

const context = await browser.newContext({
  storageState,
  viewport: { width: 1440, height: 960 },
});
const page = await context.newPage();
const results = [];

try {
  for (const runCase of [runRoute05, runRoute13, runPx12]) {
    const result = await runCase(page, context.request);
    results.push(result);
    await fs.writeFile(
      path.join(OUT_DIR, `${result.testId}.json`),
      JSON.stringify(result, null, 2),
    );
    console.log(`[${result.testId}] ${result.status}`);
    await sleep(1500);
  }
} finally {
  await context.close();
  await browser.close();
}

const summary = {
  selector,
  generatedAt: new Date().toISOString(),
  total: results.length,
  passed: results.filter((item) => item.status === 'PASS').length,
  failed: results.filter((item) => item.status !== 'PASS').length,
  results,
};
await fs.writeFile(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

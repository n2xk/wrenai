import fs from 'fs';
import path from 'path';
import { test, expect, type Page } from '@playwright/test';
import * as helper from '../helper';
import * as modelingHelper from '../commonTests/modeling';

type RuntimeSelector = helper.RuntimeScopeFixture & Record<string, string>;
type ModelListItem = {
  id: number;
  referenceName: string;
  displayName: string;
  description?: string | null;
  fields?: Array<{
    referenceName: string;
    description?: string | null;
  } | null>;
};

const DEFAULT_TIDB_SELECTOR: RuntimeSelector = {
  workspaceId: '3c4f940d-d904-4316-88dd-39f3f6a9b178',
  knowledgeBaseId: '5464cce5-d846-48c3-b9a3-dbe76215e63a',
  kbSnapshotId: '87a2e1d1-7c33-42e9-8f1c-c36ff8e85f53',
  deployHash: '5eca66087009027d848179679c6d9e285341c1b3',
};

const reportPath = path.resolve(
  process.cwd(),
  process.env.MODELING_ASSISTANT_TIDB_REAL_REPORT_PATH ||
    'tmp/modeling-ai-assistant-tidb-real-ui-latest.md',
);
const artifactDir = path.resolve(
  process.cwd(),
  process.env.MODELING_ASSISTANT_TIDB_REAL_ARTIFACT_DIR ||
    'tmp/modeling-ai-assistant-tidb-real-artifacts',
);
const semanticsPrompt =
  process.env.MODELING_ASSISTANT_TIDB_REAL_PROMPT ||
  'Generate concise business-friendly model and column descriptions.';
const selectedModelLimit = Math.max(
  1,
  Number(process.env.MODELING_ASSISTANT_TIDB_REAL_MODEL_LIMIT || '3'),
);
const shouldSave = process.env.MODELING_ASSISTANT_TIDB_REAL_SAVE === '1';

const splitModelField = (value: string) => {
  const normalized = value.trim();
  const lastDotIndex = normalized.lastIndexOf('.');
  if (lastDotIndex < 0) {
    return { modelName: normalized, fieldName: '' };
  }
  return {
    modelName: normalized.slice(0, lastDotIndex),
    fieldName: normalized.slice(lastDotIndex + 1),
  };
};

const resolveSelector = (): RuntimeSelector => {
  const selectorJson = process.env.MODELING_ASSISTANT_TIDB_REAL_SELECTOR_JSON;
  if (selectorJson) {
    const parsed = JSON.parse(selectorJson) as RuntimeSelector;
    if (!parsed.workspaceId || !parsed.knowledgeBaseId) {
      throw new Error(
        'MODELING_ASSISTANT_TIDB_REAL_SELECTOR_JSON must include workspaceId and knowledgeBaseId',
      );
    }
    return parsed;
  }

  return DEFAULT_TIDB_SELECTOR;
};

const buildScopedUrl = (pathname: string, selector: RuntimeSelector) => {
  const searchParams = new URLSearchParams();
  Object.entries(selector).forEach(([key, value]) => {
    if (value) {
      searchParams.set(key, value);
    }
  });
  return `${pathname}?${searchParams.toString()}`;
};

const requestScopedJson = async <T>(
  page: Page,
  selector: RuntimeSelector,
  pathname: string,
  init?: Parameters<Page['request']['fetch']>[1],
) => {
  const response = await page.request.fetch(
    buildScopedUrl(pathname, selector),
    init,
  );
  const text = await response.text();
  expect(
    response.ok(),
    `${init?.method || 'GET'} ${pathname} failed (${response.status()}): ${text}`,
  ).toBeTruthy();
  return (text ? JSON.parse(text) : {}) as T;
};

const waitForRelationshipReviewReady = async (page: Page) => {
  await expect
    .poll(
      async () => {
        if (
          await page
            .getByText('Ready to save')
            .first()
            .isVisible()
            .catch(() => false)
        ) {
          return 'ready';
        }
        if (
          await page
            .getByText('No additional recommended relationships')
            .isVisible()
            .catch(() => false)
        ) {
          return 'empty';
        }
        if (
          await page
            .getByText('Failed to load relationship recommendations')
            .isVisible()
            .catch(() => false)
        ) {
          return 'error';
        }
        return 'loading';
      },
      {
        timeout: 180_000,
        message:
          'Expected real relationship recommendations to reach a reviewable state',
      },
    )
    .toBe('ready');
};

const waitForSemanticsGenerated = async (page: Page) => {
  await expect
    .poll(
      async () => {
        if (
          await page
            .getByText('Generated semantics')
            .first()
            .isVisible()
            .catch(() => false)
        ) {
          return 'generated';
        }
        if (
          await page
            .getByText('Failed to generate semantics')
            .isVisible()
            .catch(() => false)
        ) {
          return 'error';
        }
        return 'loading';
      },
      {
        timeout: 180_000,
        message: 'Expected real semantics generation to complete',
      },
    )
    .toBe('generated');
};

test.describe('modeling assistant real TiDB UI flow', () => {
  test.skip(
    !process.env.RUN_MODELING_ASSISTANT_TIDB_REAL,
    'manual real TiDB assistant flow',
  );
  test.use({ storageState: { cookies: [], origins: [] } });
  test.describe.configure({ timeout: 600_000 });

  test('observes non-mocked relationship and semantics flows on TiDB KB', async ({
    page,
  }) => {
    const selector = resolveSelector();
    await helper.loginAsDefaultOwner(page);

    const models = await requestScopedJson<ModelListItem[]>(
      page,
      selector,
      '/api/v1/models/list',
    );
    const selectedModels = models
      .slice(0, selectedModelLimit)
      .map((model) => model.referenceName);

    expect(selectedModels.length).toBeGreaterThan(0);

    await helper.gotoRuntimeScopedPath({
      page,
      pathname: '/knowledge',
      selector: {
        ...selector,
        section: 'modeling',
      },
    });
    await helper.expectPathname({ page, pathname: '/knowledge' });
    await expect
      .poll(() => new URL(page.url()).searchParams.get('section'))
      .toBe('modeling');
    await modelingHelper.waitForModelingDataLoaded(page);
    fs.mkdirSync(artifactDir, { recursive: true });
    const launcherScreenshotPath = path.join(artifactDir, 'launcher.png');
    await page.screenshot({
      path: launcherScreenshotPath,
      fullPage: true,
    });

    await page.getByRole('button', { name: /Modeling AI Assistant/i }).click();
    await page
      .getByRole('button', { name: /Recommend relationships/i })
      .click();
    await helper.expectPathname({
      page,
      pathname: '/recommend-relationships',
      timeout: 120_000,
    });
    await expect(page.getByText('Generate relationships')).toBeVisible();
    await waitForRelationshipReviewReady(page);
    fs.mkdirSync(artifactDir, { recursive: true });
    const relationshipsScreenshotPath = path.join(
      artifactDir,
      'relationships-review.png',
    );
    await page.screenshot({
      path: relationshipsScreenshotPath,
      fullPage: true,
    });

    const relationshipRows = page.locator('.ant-table-tbody > tr');
    await expect(relationshipRows.first()).toBeVisible({ timeout: 30_000 });
    const relationshipRowCount = await relationshipRows.count();
    const firstRelationshipRow = (
      await relationshipRows.first().locator('td').allInnerTexts()
    )
      .map((value) => value.trim())
      .filter(Boolean);
    const firstRelationshipFrom = splitModelField(
      firstRelationshipRow[0] || '',
    );
    const firstRelationshipTo = splitModelField(firstRelationshipRow[1] || '');

    if (shouldSave) {
      await page.getByRole('button', { name: 'Save' }).click();
      await helper.expectPathname({
        page,
        pathname: '/knowledge',
        timeout: 120_000,
      });
      await expect
        .poll(() => new URL(page.url()).searchParams.get('section'))
        .toBe('modeling');
      await modelingHelper.waitForModelingDataLoaded(page);
      const diagramPayload = await requestScopedJson<{
        diagram?: {
          models?: Array<{
            relationFields?: Array<{
              fromModelName?: string | null;
              fromColumnName?: string | null;
              toModelName?: string | null;
              toColumnName?: string | null;
            } | null>;
          } | null>;
        } | null;
      }>(page, selector, '/api/v1/knowledge/diagram');
      const persistedRelationships = (diagramPayload.diagram?.models || [])
        .flatMap((model) => model?.relationFields || [])
        .filter(
          (
            relation,
          ): relation is {
            fromModelName?: string | null;
            fromColumnName?: string | null;
            toModelName?: string | null;
            toColumnName?: string | null;
          } => Boolean(relation),
        );
      expect(
        persistedRelationships.some(
          (relation) =>
            relation.fromModelName === firstRelationshipFrom.modelName &&
            relation.fromColumnName === firstRelationshipFrom.fieldName &&
            relation.toModelName === firstRelationshipTo.modelName &&
            relation.toColumnName === firstRelationshipTo.fieldName,
        ),
      ).toBeTruthy();
    } else {
      await helper.gotoRuntimeScopedPath({
        page,
        pathname: '/knowledge',
        selector: {
          ...selector,
          section: 'modeling',
        },
      });
      await modelingHelper.waitForModelingDataLoaded(page);
    }

    await page.getByRole('button', { name: /Modeling AI Assistant/i }).click();
    await page.getByRole('button', { name: /Recommend semantics/i }).click();
    await helper.expectPathname({
      page,
      pathname: '/recommend-semantics',
      timeout: 120_000,
    });
    await expect(page.getByText('Generate semantics')).toBeVisible();

    for (const modelName of selectedModels) {
      const row = page.locator('label').filter({ hasText: modelName }).first();
      await expect(row).toBeVisible({ timeout: 30_000 });
      await row.locator('input[type="checkbox"]').check({ force: true });
    }

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Example prompt')).toBeVisible();
    await page
      .getByPlaceholder('Add more context for the AI assistant (optional)')
      .fill(semanticsPrompt);
    await page.getByRole('button', { name: 'Generate' }).click();
    await waitForSemanticsGenerated(page);
    const semanticsScreenshotPath = path.join(
      artifactDir,
      'semantics-generated.png',
    );
    await page.screenshot({
      path: semanticsScreenshotPath,
      fullPage: true,
    });

    const reviewCards = page.locator('.ant-card');
    await expect(reviewCards.first()).toBeVisible({ timeout: 30_000 });
    const generatedCardCount = await reviewCards.count();
    const firstGeneratedModel = (
      await reviewCards.first().locator('.ant-typography').first().innerText()
    ).trim();
    const firstGeneratedDescription = (
      await reviewCards.first().locator('.ant-typography').nth(1).innerText()
    ).trim();

    if (shouldSave) {
      await page.getByRole('button', { name: 'Save' }).click();
      await helper.expectPathname({
        page,
        pathname: '/knowledge',
        timeout: 120_000,
      });
      await expect
        .poll(() => new URL(page.url()).searchParams.get('section'))
        .toBe('modeling');
      await modelingHelper.waitForModelingDataLoaded(page);
      const savedModels = await requestScopedJson<ModelListItem[]>(
        page,
        selector,
        '/api/v1/models/list',
      );
      const firstSavedModel = savedModels.find(
        (model) => model.referenceName === firstGeneratedModel,
      );
      expect(firstSavedModel?.description || '').toBe(
        firstGeneratedDescription,
      );
      selectedModels.forEach((modelName) => {
        const savedModel = savedModels.find(
          (candidate) => candidate.referenceName === modelName,
        );
        expect(savedModel?.description?.trim()).toBeTruthy();
        const describedColumnCount = (savedModel?.fields || []).filter(
          (field) => Boolean(field?.description?.trim()),
        ).length;
        expect(describedColumnCount).toBeGreaterThan(0);
      });
    }

    const reportLines = [
      '# Modeling AI Assistant Real TiDB UI Evidence',
      '',
      '> Generated from a non-mocked Playwright UI flow against the TiDB knowledge base.',
      `> Report path: \`${reportPath}\``,
      '',
      `- Selector: \`${JSON.stringify(selector)}\``,
      `- Selected models: ${
        selectedModels.length > 0 ? selectedModels.join(', ') : '(none)'
      }`,
      `- Save mode: ${shouldSave ? 'enabled' : 'skipped'}`,
      `- Artifact dir: \`${artifactDir}\``,
      `- Launcher screenshot: \`${launcherScreenshotPath}\``,
      '',
      '## Relationships',
      '',
      `- Review state: ready to save`,
      `- Table row count: ${relationshipRowCount}`,
      `- First row: ${firstRelationshipRow.join(' | ')}`,
      `- Screenshot: \`${relationshipsScreenshotPath}\``,
      '',
      '## Semantics',
      '',
      `- Prompt: ${semanticsPrompt}`,
      `- Generated card count: ${generatedCardCount}`,
      `- First generated model: ${firstGeneratedModel}`,
      `- First generated description: ${firstGeneratedDescription}`,
      `- Screenshot: \`${semanticsScreenshotPath}\``,
      '',
    ];

    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${reportLines.join('\n')}\n`, 'utf8');
  });
});

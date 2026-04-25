import fs from 'fs';
import path from 'path';
import { test, expect, type APIRequestContext } from '@playwright/test';
import type { ModelListItem } from '@/hooks/useModelList';
import { SampleDatasetName } from '@/types/dataSource';
import { buildSemanticsDescriptionSavePayload } from '@/features/modeling/assistant/recommendSemantics/recommendSemanticsSupport';
import {
  buildRecommendRelationshipsSavePayload,
  buildRecommendRelationshipsViewState,
} from '@/features/modeling/assistant/recommendRelationships/recommendRelationshipsSupport';
import * as helper from '../helper';

const datasets = [
  SampleDatasetName.HR,
  SampleDatasetName.ECOMMERCE,
  SampleDatasetName.NBA,
] as const;

const reportPath = path.resolve(
  process.cwd(),
  process.env.MODELING_ASSISTANT_QUALITY_REPORT_PATH ||
    'tmp/modeling-ai-assistant-quality-evaluation-latest.md',
);

type RuntimeSelector = helper.RuntimeScopeFixture & Record<string, string>;
type EvaluationTarget = {
  label: string;
  selector: RuntimeSelector;
  source: 'system-sample' | 'external-runtime';
};

type TaskResult = {
  status: string;
  response?: any;
  error?: { message?: string | null } | null;
  traceId?: string | null;
};

type RelationshipItem = {
  name?: string | null;
  fromModel?: string | null;
  fromColumn?: string | null;
  toModel?: string | null;
  toColumn?: string | null;
  type?: string | null;
  reason?: string | null;
};

type SemanticsColumnItem = {
  name?: string | null;
  description?: string | null;
};

type SemanticsModelItem = {
  name?: string | null;
  description?: string | null;
  columns?: SemanticsColumnItem[] | null;
};

type RelationshipQualityMetrics = {
  recommendationCount: number;
  missingReasonCount: number;
  suspiciousCardinalityCount: number;
  suspiciousCardinalityMarkers: string[];
};

type SemanticsQualityMetrics = {
  modelCount: number;
  columnCount: number;
  nonEmptyModelDescriptionCount: number;
  businessLikeModelDescriptionCount: number;
  nonEmptyColumnDescriptionCount: number;
  businessLikeColumnDescriptionCount: number;
};

type QualityArtifact = {
  target: EvaluationTarget;
  selector: RuntimeSelector;
  selectedModels: string[];
  relationshipTask: TaskResult | null;
  relationshipMetrics: RelationshipQualityMetrics;
  semanticsTask: TaskResult | null;
  semanticsMetrics: SemanticsQualityMetrics;
  saveVerification?: {
    attempted: boolean;
    relationshipPayloadCount: number;
    relationshipVerified: boolean;
    semanticsPayloadCount: number;
    semanticsVerified: boolean;
  };
};

const semanticsPrompt =
  process.env.MODELING_ASSISTANT_QUALITY_PROMPT ||
  'Generate concise business-friendly model and column descriptions.';

const modelSelectionLimit = Math.max(
  1,
  Number(process.env.MODELING_ASSISTANT_QUALITY_MODEL_LIMIT || '2'),
);
const shouldSave = process.env.MODELING_ASSISTANT_QUALITY_SAVE === '1';
const artifactRoot = path.resolve(
  process.cwd(),
  process.env.MODELING_ASSISTANT_QUALITY_ARTIFACT_ROOT ||
    'tmp/modeling-ai-assistant-quality-artifacts',
);
const E2E_OWNER_EMAIL = 'admin@example.com';
const E2E_OWNER_PASSWORD = 'Admin@123';

const normalizeText = (value?: string | null) =>
  (value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-]/g, '');

const slugifyLabel = (label: string) =>
  label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'target';

const isBusinessLikeDescription = ({
  name,
  description,
}: {
  name?: string | null;
  description?: string | null;
}) => {
  const trimmed = description?.trim();
  if (!trimmed) {
    return false;
  }

  const normalizedDescription = normalizeText(trimmed);
  const normalizedName = normalizeText(name);

  if (
    !normalizedDescription ||
    normalizedDescription === normalizedName ||
    /^(n\/a|null|none|-)$/.test(normalizedDescription)
  ) {
    return false;
  }

  if (/[，。,.:：]/.test(trimmed)) {
    return true;
  }

  if (/\s/.test(trimmed) && trimmed.split(/\s+/).length >= 2) {
    return true;
  }

  if (/[^\x00-\x7F]/.test(trimmed)) {
    return trimmed.length >= 4;
  }

  return trimmed.length >= 8;
};

const evaluateRelationshipQuality = (
  relationships: RelationshipItem[],
): RelationshipQualityMetrics => {
  const suspiciousCardinalityMarkers = relationships
    .filter((relationship) => relationship.type === 'ONE_TO_ONE')
    .map(
      (relationship) =>
        `${relationship.fromModel || '?'}.${relationship.fromColumn || '?'} -> ${
          relationship.toModel || '?'
        }.${relationship.toColumn || '?'} (${relationship.type || 'UNKNOWN'})`,
    );

  return {
    recommendationCount: relationships.length,
    missingReasonCount: relationships.filter(
      (relationship) => !relationship.reason?.trim(),
    ).length,
    suspiciousCardinalityCount: suspiciousCardinalityMarkers.length,
    suspiciousCardinalityMarkers,
  };
};

const evaluateSemanticsQuality = (
  items: SemanticsModelItem[],
): SemanticsQualityMetrics => {
  const columns = items.flatMap((item) => item.columns || []);

  return {
    modelCount: items.length,
    columnCount: columns.length,
    nonEmptyModelDescriptionCount: items.filter((item) =>
      Boolean(item.description?.trim()),
    ).length,
    businessLikeModelDescriptionCount: items.filter((item) =>
      isBusinessLikeDescription({
        name: item.name,
        description: item.description,
      }),
    ).length,
    nonEmptyColumnDescriptionCount: columns.filter((column) =>
      Boolean(column.description?.trim()),
    ).length,
    businessLikeColumnDescriptionCount: columns.filter((column) =>
      isBusinessLikeDescription({
        name: column.name,
        description: column.description,
      }),
    ).length,
  };
};

const relationshipQualityLabel = ({
  recommendationCount,
  missingReasonCount,
  suspiciousCardinalityCount,
}: RelationshipQualityMetrics) => {
  if (recommendationCount === 0) {
    return 'empty';
  }

  if (missingReasonCount === 0 && suspiciousCardinalityCount === 0) {
    return 'healthy';
  }

  if (missingReasonCount <= 1 && suspiciousCardinalityCount <= 1) {
    return 'review';
  }

  return 'caution';
};

const semanticsQualityLabel = ({
  modelCount,
  nonEmptyModelDescriptionCount,
  businessLikeModelDescriptionCount,
  columnCount,
  nonEmptyColumnDescriptionCount,
  businessLikeColumnDescriptionCount,
}: SemanticsQualityMetrics) => {
  if (
    modelCount > 0 &&
    nonEmptyModelDescriptionCount === modelCount &&
    businessLikeModelDescriptionCount === modelCount &&
    (columnCount === 0 ||
      (nonEmptyColumnDescriptionCount === columnCount &&
        businessLikeColumnDescriptionCount / columnCount >= 0.85))
  ) {
    return 'healthy';
  }

  if (
    modelCount > 0 &&
    nonEmptyModelDescriptionCount === modelCount &&
    (columnCount === 0 ||
      businessLikeColumnDescriptionCount / Math.max(columnCount, 1) >= 0.6)
  ) {
    return 'review';
  }

  return 'caution';
};

const writeQualityArtifact = ({
  label,
  artifact,
}: {
  label: string;
  artifact: QualityArtifact;
}) => {
  fs.mkdirSync(artifactRoot, { recursive: true });
  const artifactPath = path.join(artifactRoot, `${slugifyLabel(label)}.json`);
  fs.writeFileSync(
    `${artifactPath}`,
    JSON.stringify(artifact, null, 2),
    'utf8',
  );
  return artifactPath;
};

const createExternalRuntimeTarget = (): EvaluationTarget | null => {
  const selectorJson = process.env.MODELING_ASSISTANT_QUALITY_SELECTOR_JSON;
  if (selectorJson) {
    const parsed = JSON.parse(selectorJson) as RuntimeSelector;
    if (!parsed.workspaceId || !parsed.knowledgeBaseId) {
      throw new Error(
        'MODELING_ASSISTANT_QUALITY_SELECTOR_JSON must include workspaceId and knowledgeBaseId',
      );
    }
    return {
      label:
        process.env.MODELING_ASSISTANT_QUALITY_LABEL ||
        'External runtime target',
      selector: parsed,
      source: 'external-runtime',
    };
  }

  const workspaceId = process.env.MODELING_ASSISTANT_QUALITY_WORKSPACE_ID;
  const knowledgeBaseId =
    process.env.MODELING_ASSISTANT_QUALITY_KNOWLEDGE_BASE_ID;

  if (!workspaceId || !knowledgeBaseId) {
    return null;
  }

  return {
    label:
      process.env.MODELING_ASSISTANT_QUALITY_LABEL || 'External runtime target',
    source: 'external-runtime',
    selector: {
      workspaceId,
      knowledgeBaseId,
      ...(process.env.MODELING_ASSISTANT_QUALITY_KB_SNAPSHOT_ID
        ? {
            kbSnapshotId: process.env.MODELING_ASSISTANT_QUALITY_KB_SNAPSHOT_ID,
          }
        : {}),
      ...(process.env.MODELING_ASSISTANT_QUALITY_DEPLOY_HASH
        ? {
            deployHash: process.env.MODELING_ASSISTANT_QUALITY_DEPLOY_HASH,
          }
        : {}),
    },
  };
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

test.use({ storageState: { cookies: [], origins: [] } });

const requestScopedJson = async <T>(
  request: APIRequestContext,
  selector: RuntimeSelector,
  pathname: string,
  init?: Parameters<APIRequestContext['fetch']>[1],
) => {
  const response = await request.fetch(
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

const loginAsDefaultOwnerRequest = async (request: APIRequestContext) => {
  const response = await request.post('/api/auth/login', {
    data: {
      email: E2E_OWNER_EMAIL,
      password: E2E_OWNER_PASSWORD,
    },
  });
  const body = await response.text();
  expect(body).toBeDefined();
  expect(response.ok(), body).toBeTruthy();
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ensureSystemSampleRuntimeScopeRequest = async ({
  request,
  sampleDataset,
}: {
  request: APIRequestContext;
  sampleDataset: SampleDatasetName;
}): Promise<RuntimeSelector> => {
  let lastFailure = 'unknown bootstrap failure';

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await request.post(
      '/api/v1/internal/system-samples/bootstrap',
      {
        data: { sampleDataset },
        headers: { 'x-wren-e2e-internal': '1' },
      },
    );
    const body = await response.text();
    if (response.ok()) {
      return JSON.parse(body) as RuntimeSelector;
    }

    lastFailure = `system sample bootstrap failed (${response.status()}): ${body}`;
    const isRetryableFailure =
      response.status() >= 500 ||
      body.includes('The initializing SQL seems to be invalid') ||
      body.includes('Deploy wren AI failed or timeout');
    if (attempt < 5 && isRetryableFailure) {
      await sleep(1_000 * attempt);
      continue;
    }
    break;
  }

  expect(false, lastFailure).toBeTruthy();
  throw new Error(lastFailure);
};

const pollTask = async ({
  request,
  selector,
  pathname,
  timeoutMs = 120_000,
}: {
  request: APIRequestContext;
  selector: RuntimeSelector;
  pathname: string;
  timeoutMs?: number;
}) => {
  const start = Date.now();
  let latest: TaskResult | null = null;
  while (Date.now() - start < timeoutMs) {
    latest = await requestScopedJson<TaskResult>(request, selector, pathname);
    if (latest.status === 'FINISHED' || latest.status === 'FAILED') {
      return latest;
    }
    await sleep(2_000);
  }
  return latest;
};

test.describe('modeling assistant quality evaluation', () => {
  test.skip(
    !process.env.RUN_MODELING_ASSISTANT_QUALITY,
    'manual quality evaluation flow',
  );
  test.describe.configure({ timeout: 600_000 });

  test('evaluates real local assistant outputs across sample datasets', async ({
    request,
  }) => {
    await loginAsDefaultOwnerRequest(request);
    const externalTarget = createExternalRuntimeTarget();
    const evaluationTargets: EvaluationTarget[] = externalTarget
      ? [externalTarget]
      : await Promise.all(
          datasets.map(async (dataset) => ({
            label: dataset,
            selector: (await ensureSystemSampleRuntimeScopeRequest({
              request,
              sampleDataset: dataset,
            })) as RuntimeSelector,
            source: 'system-sample' as const,
          })),
        );

    const reportRows: string[] = [
      '# Modeling AI Assistant Quality Evaluation Evidence',
      '',
      '> Generated from non-mocked assistant task runs.',
      `> Report path: \`${reportPath}\``,
      '',
      `- Semantics prompt: ${semanticsPrompt}`,
      `- Model selection limit: ${modelSelectionLimit}`,
      `- Target mode: ${
        externalTarget ? 'external runtime selector' : 'system sample datasets'
      }`,
      '',
    ];
    const summaryRows: string[] = [
      '| Target | Source | Relationships | Suspicious cardinality | Semantics | Model descriptions | Column descriptions | Artifact |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ];

    for (const target of evaluationTargets) {
      const selector = target.selector;
      const models = await requestScopedJson<ModelListItem[]>(
        request,
        selector,
        '/api/v1/models/list',
      );
      const selectedModels = models
        .slice(0, modelSelectionLimit)
        .map((model) => model.referenceName);

      const relationshipTask = await requestScopedJson<{ id: string }>(
        request,
        selector,
        '/api/v1/relationship-recommendations',
        { method: 'POST' },
      );
      const relationshipResult = await pollTask({
        request,
        selector,
        pathname: `/api/v1/relationship-recommendations/${relationshipTask.id}`,
      });

      const semanticsTask = await requestScopedJson<{ id: string }>(
        request,
        selector,
        '/api/v1/semantics-descriptions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          data: {
            selectedModels,
            userPrompt: semanticsPrompt,
          },
        },
      );
      const semanticsResult = await pollTask({
        request,
        selector,
        pathname: `/api/v1/semantics-descriptions/${semanticsTask.id}`,
      });

      const relationships = (relationshipResult?.response?.relationships ||
        []) as RelationshipItem[];
      const semanticsItems = (semanticsResult?.response ||
        []) as SemanticsModelItem[];
      const relationshipMetrics = evaluateRelationshipQuality(relationships);
      const semanticsMetrics = evaluateSemanticsQuality(semanticsItems);
      const artifactPath = writeQualityArtifact({
        label: target.label,
        artifact: {
          target,
          selector,
          selectedModels,
          relationshipTask: relationshipResult || null,
          relationshipMetrics,
          semanticsTask: semanticsResult || null,
          semanticsMetrics,
        },
      });
      const relationshipCount = relationshipMetrics.recommendationCount;
      const semanticsCount = semanticsMetrics.modelCount;
      const firstRelationship = relationships[0] || null;
      const firstSemanticModel = semanticsItems[0] || null;
      const relationshipLabel = relationshipQualityLabel(relationshipMetrics);
      const semanticsLabel = semanticsQualityLabel(semanticsMetrics);
      let saveVerification: QualityArtifact['saveVerification'] | undefined =
        undefined;

      if (shouldSave && target.source === 'external-runtime') {
        const recommendViewState = buildRecommendRelationshipsViewState({
          models,
          task: relationshipResult as any,
        });
        const relationshipSavePayload = buildRecommendRelationshipsSavePayload(
          recommendViewState.recommendRelations,
        );
        if (relationshipSavePayload.length > 0) {
          await requestScopedJson<any>(
            request,
            selector,
            '/api/v1/relationships/import',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              data: { relations: relationshipSavePayload },
            },
          );
        }

        const semanticsSavePayload = buildSemanticsDescriptionSavePayload({
          generatedModels: semanticsItems as any,
          models,
        });
        for (const item of semanticsSavePayload) {
          await requestScopedJson<any>(
            request,
            selector,
            `/api/v1/models/${item.modelId}/metadata`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              data: item.data,
            },
          );
        }

        const persistedDiagram = await requestScopedJson<{
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
        }>(request, selector, '/api/v1/knowledge/diagram');
        const persistedRelationships = (persistedDiagram.diagram?.models || [])
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
        const savedModels = await requestScopedJson<ModelListItem[]>(
          request,
          selector,
          '/api/v1/models/list',
        );
        const firstSavedModel = firstSemanticModel
          ? savedModels.find(
              (model) => model.referenceName === firstSemanticModel.name,
            )
          : null;

        saveVerification = {
          attempted: true,
          relationshipPayloadCount: relationshipSavePayload.length,
          relationshipVerified: firstRelationship
            ? persistedRelationships.some(
                (relation) =>
                  relation.fromModelName === firstRelationship.fromModel &&
                  relation.fromColumnName === firstRelationship.fromColumn &&
                  relation.toModelName === firstRelationship.toModel &&
                  relation.toColumnName === firstRelationship.toColumn,
              )
            : relationshipSavePayload.length === 0,
          semanticsPayloadCount: semanticsSavePayload.length,
          semanticsVerified: firstSemanticModel
            ? Boolean(firstSavedModel?.description?.trim()) &&
              firstSavedModel?.description === firstSemanticModel.description
            : semanticsSavePayload.length === 0,
        };
      }

      reportRows.push(`## ${target.label}`);
      reportRows.push('');
      reportRows.push(`- Source: ${target.source}`);
      reportRows.push(`- Selector: \`${JSON.stringify(selector)}\``);
      reportRows.push(`- Selected model count: ${selectedModels.length}`);
      reportRows.push(
        `- Selected models: ${
          selectedModels.length > 0 ? selectedModels.join(', ') : '(none)'
        }`,
      );
      reportRows.push(
        `- Relationship task status: ${relationshipResult?.status || 'UNKNOWN'}`,
      );
      reportRows.push(
        `- Relationship recommendation count: ${relationshipCount}`,
      );
      reportRows.push(`- Relationship quality label: ${relationshipLabel}`);
      reportRows.push(
        `- Relationship missing-reason count: ${relationshipMetrics.missingReasonCount}`,
      );
      reportRows.push(
        `- Relationship suspicious-cardinality markers: ${relationshipMetrics.suspiciousCardinalityCount}`,
      );
      if (relationshipMetrics.suspiciousCardinalityMarkers.length > 0) {
        reportRows.push(
          `- Relationship suspicious-cardinality details: ${relationshipMetrics.suspiciousCardinalityMarkers.join(' | ')}`,
        );
      }
      if (firstRelationship) {
        reportRows.push(
          `- First relationship: ${firstRelationship.fromModel}.${firstRelationship.fromColumn} -> ${firstRelationship.toModel}.${firstRelationship.toColumn} (${firstRelationship.type})`,
        );
        reportRows.push(
          `- First relationship reason: ${firstRelationship.reason || ''}`,
        );
      }
      if (relationshipResult?.error?.message) {
        reportRows.push(
          `- Relationship error: ${relationshipResult.error.message}`,
        );
      }
      reportRows.push(
        `- Semantics task status: ${semanticsResult?.status || 'UNKNOWN'}`,
      );
      reportRows.push(`- Semantics model count: ${semanticsCount}`);
      reportRows.push(`- Semantics quality label: ${semanticsLabel}`);
      reportRows.push(
        `- Semantics model descriptions: ${semanticsMetrics.nonEmptyModelDescriptionCount}/${semanticsMetrics.modelCount} non-empty; ${semanticsMetrics.businessLikeModelDescriptionCount}/${semanticsMetrics.modelCount} business-like`,
      );
      reportRows.push(
        `- Semantics column descriptions: ${semanticsMetrics.nonEmptyColumnDescriptionCount}/${semanticsMetrics.columnCount} non-empty; ${semanticsMetrics.businessLikeColumnDescriptionCount}/${semanticsMetrics.columnCount} business-like`,
      );
      if (firstSemanticModel) {
        reportRows.push(`- First semantics model: ${firstSemanticModel.name}`);
        reportRows.push(
          `- First semantics description: ${firstSemanticModel.description || ''}`,
        );
      }
      if (semanticsResult?.error?.message) {
        reportRows.push(`- Semantics error: ${semanticsResult.error.message}`);
      }
      if (saveVerification) {
        reportRows.push(
          `- Save verification: relationships ${saveVerification.relationshipPayloadCount} payload(s), verified=${saveVerification.relationshipVerified}; semantics ${saveVerification.semanticsPayloadCount} payload(s), verified=${saveVerification.semanticsVerified}`,
        );
      }
      reportRows.push(`- Full artifact: \`${artifactPath}\``);
      reportRows.push('');

      if (saveVerification) {
        const artifact = JSON.parse(
          fs.readFileSync(artifactPath, 'utf8'),
        ) as QualityArtifact;
        artifact.saveVerification = saveVerification;
        fs.writeFileSync(
          artifactPath,
          JSON.stringify(artifact, null, 2),
          'utf8',
        );
      }

      summaryRows.push(
        `| ${target.label} | ${target.source} | ${relationshipCount} (${relationshipLabel}) | ${relationshipMetrics.suspiciousCardinalityCount} | ${semanticsCount} (${semanticsLabel}) | ${semanticsMetrics.businessLikeModelDescriptionCount}/${semanticsMetrics.modelCount} business-like | ${semanticsMetrics.businessLikeColumnDescriptionCount}/${semanticsMetrics.columnCount} business-like | \`${artifactPath}\` |`,
      );
    }

    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(
      reportPath,
      `${reportRows.join('\n')}\n\n## Summary table\n\n${summaryRows.join('\n')}\n`,
      'utf8',
    );
  });
});

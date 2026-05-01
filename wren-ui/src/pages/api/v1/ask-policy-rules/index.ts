import type { NextApiRequest, NextApiResponse } from 'next';
import { buildApiContextFromRequest } from '@/server/api/apiContext';
import { sendRestApiError } from '@/server/api/restApi';
import { ApiError } from '@/server/utils/apiUtils';
import {
  assertKnowledgeBaseReadAccess,
  assertKnowledgeBaseWriteAccess,
} from '@server/controllers/modelControllerScopeSupport';

const toStringArray = (value: unknown): string[] =>
  Array.from(
    new Set(
      (Array.isArray(value)
        ? value
        : typeof value === 'string'
          ? value.split(',')
          : []
      )
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ),
  );

const normalizeStatus = (value: unknown) =>
  value === 'disabled' ? 'disabled' : 'active';

const normalizeSemanticConditions = (
  value: unknown,
): Record<string, string[]> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.entries(value).reduce<Record<string, string[]>>(
    (conditions, [key, rawValue]) => {
      const values = toStringArray(rawValue);
      if (values.length > 0) {
        conditions[key] = values;
      }
      return conditions;
    },
    {},
  );
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    const ctx = await buildApiContextFromRequest({ req });
    const workspaceId = ctx.runtimeScope?.workspace?.id;
    if (!workspaceId) {
      throw new ApiError('Workspace scope is required.', 400);
    }

    if (req.method === 'GET') {
      await assertKnowledgeBaseReadAccess(ctx);
      const items = await ctx.askPolicyRuleRepository.findAllForScope({
        workspaceId,
        knowledgeBaseId: ctx.runtimeScope?.knowledgeBase?.id || null,
        includeWorkspaceRules: false,
      });
      return res.status(200).json({ items });
    }

    if (req.method === 'POST') {
      await assertKnowledgeBaseWriteAccess(ctx);
      const name = String(req.body?.name || '').trim();
      if (!name) {
        throw new ApiError('策略名称不能为空', 400);
      }

      const reasonCode =
        String(req.body?.reasonCode || '').trim() || `ui_policy_${Date.now()}`;
      const rule = await ctx.askPolicyRuleRepository.createOne({
        projectId: ctx.runtimeScope?.project?.id ?? null,
        workspaceId,
        knowledgeBaseId: ctx.runtimeScope?.knowledgeBase?.id || null,
        actorUserId: ctx.requestActor?.userId || null,
        name,
        status: normalizeStatus(req.body?.status),
        version: 1,
        queryContainsAny: toStringArray(req.body?.queryContainsAny),
        templateIds: toStringArray(req.body?.templateIds),
        forbiddenTemplates: toStringArray(req.body?.forbiddenTemplates),
        requiredSlots: toStringArray(req.body?.requiredSlots),
        semanticConditions: normalizeSemanticConditions(
          req.body?.semanticConditions || req.body?.semantic_conditions,
        ),
        reasonCode,
        description: String(req.body?.description || '').trim() || null,
      });
      return res.status(201).json(rule);
    }

    res.setHeader('Allow', 'GET, POST');
    throw new Error('Method not allowed');
  } catch (error) {
    return sendRestApiError(res, error, '保存问数策略失败，请稍后重试。');
  }
}

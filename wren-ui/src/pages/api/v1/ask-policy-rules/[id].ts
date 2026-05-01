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
    const id = Number(req.query.id);
    if (!Number.isFinite(id)) {
      throw new ApiError('Policy rule id is invalid.', 400);
    }

    const ctx = await buildApiContextFromRequest({ req });
    const workspaceId = ctx.runtimeScope?.workspace?.id;
    const knowledgeBaseId = ctx.runtimeScope?.knowledgeBase?.id || null;
    if (!workspaceId) {
      throw new ApiError('Workspace scope is required.', 400);
    }

    const existing = await ctx.askPolicyRuleRepository.findOneBy({ id });
    if (
      !existing ||
      existing.workspaceId !== workspaceId ||
      existing.knowledgeBaseId !== knowledgeBaseId
    ) {
      throw new ApiError('Policy rule not found.', 404);
    }

    if (req.method === 'GET') {
      await assertKnowledgeBaseReadAccess(ctx);
      return res.status(200).json(existing);
    }

    if (req.method === 'PATCH') {
      await assertKnowledgeBaseWriteAccess(ctx);
      const updated = await ctx.askPolicyRuleRepository.updateOne(id, {
        name:
          typeof req.body?.name === 'string'
            ? req.body.name.trim() || existing.name
            : existing.name,
        status:
          typeof req.body?.status === 'string'
            ? normalizeStatus(req.body.status)
            : existing.status,
        version: (Number(existing.version) || 1) + 1,
        queryContainsAny:
          req.body?.queryContainsAny == null
            ? existing.queryContainsAny
            : toStringArray(req.body.queryContainsAny),
        templateIds:
          req.body?.templateIds == null
            ? existing.templateIds
            : toStringArray(req.body.templateIds),
        forbiddenTemplates:
          req.body?.forbiddenTemplates == null
            ? existing.forbiddenTemplates
            : toStringArray(req.body.forbiddenTemplates),
        requiredSlots:
          req.body?.requiredSlots == null
            ? existing.requiredSlots
            : toStringArray(req.body.requiredSlots),
        semanticConditions:
          req.body?.semanticConditions == null &&
          req.body?.semantic_conditions == null
            ? existing.semanticConditions
            : normalizeSemanticConditions(
                req.body?.semanticConditions || req.body?.semantic_conditions,
              ),
        reasonCode:
          typeof req.body?.reasonCode === 'string'
            ? req.body.reasonCode.trim() || existing.reasonCode
            : existing.reasonCode,
        description:
          typeof req.body?.description === 'string'
            ? req.body.description.trim() || null
            : existing.description,
        updatedAt: new Date().toISOString(),
      });
      return res.status(200).json(updated);
    }

    if (req.method === 'DELETE') {
      await assertKnowledgeBaseWriteAccess(ctx);
      await ctx.askPolicyRuleRepository.deleteOne(id);
      return res.status(200).json({ success: true });
    }

    res.setHeader('Allow', 'GET, PATCH, DELETE');
    throw new Error('Method not allowed');
  } catch (error) {
    return sendRestApiError(res, error, '更新问数策略失败，请稍后重试。');
  }
}

import type { AskingTask, Error as AskError } from '@/types/home';

const TEMPLATE_CORE_PROTECTION_MESSAGE =
  'SQL correction changed the protected template core';

const normalizeString = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

const getTemplateDecisionValue = (
  templateDecision: Record<string, any> | null | undefined,
  camelKey: string,
  snakeKey: string,
) => templateDecision?.[camelKey] ?? templateDecision?.[snakeKey];

const getTemplateDecision = (task?: Pick<AskingTask, 'diagnostics'> | null) =>
  (task?.diagnostics?.templateDecision || null) as Record<string, any> | null;

const getMissingParameters = (
  task?: Pick<AskingTask, 'diagnostics'> | null,
) => {
  const templateDecision = getTemplateDecision(task);
  const fromTemplate =
    getTemplateDecisionValue(
      templateDecision,
      'missingParameters',
      'missing_parameters',
    ) || [];
  if (Array.isArray(fromTemplate) && fromTemplate.length > 0) {
    return fromTemplate.filter((value): value is string =>
      Boolean(normalizeString(value)),
    );
  }

  const pendingSlots =
    task?.diagnostics?.clarificationState?.pendingSlots ||
    task?.diagnostics?.semanticPlan?.clarificationState?.pending_slots ||
    task?.diagnostics?.semanticPlan?.clarificationState?.pendingSlots ||
    [];
  return Array.isArray(pendingSlots)
    ? pendingSlots.filter((value): value is string =>
        Boolean(normalizeString(value)),
      )
    : [];
};

export const resolveTemplateAwarePreparationError = (
  task?: Pick<AskingTask, 'diagnostics' | 'error'> | null,
): AskError | undefined => {
  if (!task?.error) return undefined;

  const templateDecision = getTemplateDecision(task);
  const fallbackReason = normalizeString(
    getTemplateDecisionValue(
      templateDecision,
      'fallbackReason',
      'fallback_reason',
    ),
  );
  const missingParameters = getMissingParameters(task);

  if (missingParameters.includes('period_days')) {
    return {
      ...task.error,
      shortMessage: '缺少回收周期',
      message:
        '这个问题命中了首存 cohort 模板，还需要补充累计回收周期。请补充 D7、D30 等周期后重新生成。',
    };
  }

  if (
    fallbackReason === 'missing_template_parameters' ||
    fallbackReason === 'missing_required_slot'
  ) {
    return {
      ...task.error,
      shortMessage: '缺少必要查询条件',
      message:
        '这个问题命中了业务模板，但仍缺少必填参数。请补充提示中的条件后重新生成，避免系统猜测业务口径。',
    };
  }

  if (
    fallbackReason === 'template_core_protection_rejected_correction' ||
    normalizeString(task.error.message) === TEMPLATE_CORE_PROTECTION_MESSAGE
  ) {
    return {
      ...task.error,
      shortMessage: 'SQL 修正被模板保护拦截',
      message:
        '系统拒绝了一次可能改变业务口径的 SQL 修正。请补充查询条件后重新生成，或联系管理员检查模板。',
    };
  }

  return undefined;
};

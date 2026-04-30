import { IContext } from '@server/types';
import type { Instruction, SqlPair } from '@server/repositories';
import { getSampleAskQuestions, SampleDatasetName } from '../data';
import { TelemetryEvent, WrenService } from '../telemetry/telemetry';
import {
  resolveRuntimeSampleDataset,
  resolveRuntimeProject as resolveScopedRuntimeProject,
} from '../utils/runtimeExecutionContext';
import {
  AskingTask,
  RecommendedQuestionsTask,
  SuggestedQuestionResponse,
  Task,
} from './askingControllerTypes';
import {
  assertExecutableRuntimeScope,
  assertKnowledgeBaseReadAccess,
  ensureAskingTaskScope,
  ensureResponseScope,
  ensureThreadScope,
  formatAdjustmentTask,
  getCurrentLanguage,
  getCurrentPersistedRuntimeIdentity,
  getCurrentRuntimeScopeId,
  recordKnowledgeBaseReadAudit,
  transformAskingTask,
} from './askingControllerScopeSupport';

const MAX_KNOWLEDGE_BASE_SUGGESTED_QUESTIONS = 6;

const TEMPLATE_LEVEL_RANK: Record<string, number> = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
};

const GOVERNED_SQL_TEMPLATE_SOURCE_TYPES = new Set([
  'admin_marked',
  'business_import',
  'system_promoted',
]);

const normalizeText = (value?: string | null) => String(value || '').trim();

const getTemplateLevelRank = (templateLevel?: string | null) =>
  TEMPLATE_LEVEL_RANK[String(templateLevel || 'L0').toUpperCase()] || 0;

const getBusinessSignatureTemplateId = (
  businessSignature?: Record<string, any> | null,
) => {
  const templateId =
    businessSignature?.templateId || businessSignature?.template_id;
  return typeof templateId === 'string' ? templateId.trim() : '';
};

const getSqlPairSuggestionPriority = (sqlPair: SqlPair) => {
  const levelRank = getTemplateLevelRank(sqlPair.templateLevel);
  const sourceType = String(sqlPair.sourceType || '');

  if (sqlPair.assetKind === 'sql_template') {
    return 300 + levelRank;
  }
  if (levelRank >= 2) {
    return 250 + levelRank;
  }
  if (GOVERNED_SQL_TEMPLATE_SOURCE_TYPES.has(sourceType)) {
    return 220;
  }
  if (sqlPair.templateMode === 'trusted_reference') {
    return 150;
  }
  return 100 + levelRank;
};

const buildSqlPairSuggestionLabel = (sqlPair: SqlPair) => {
  const templateId = getBusinessSignatureTemplateId(sqlPair.businessSignature);
  if (templateId) {
    return `业务模板 ${templateId}`;
  }

  if (sqlPair.assetKind === 'sql_template') {
    const templateLevel = normalizeText(sqlPair.templateLevel);
    return templateLevel ? `${templateLevel} 业务模板` : '业务模板';
  }

  if (sqlPair.templateMode === 'trusted_reference') {
    return '可信参考';
  }

  return '问数样例';
};

const buildKnowledgeBaseSuggestedQuestionsFromSqlPairs = (
  sqlPairs: SqlPair[],
) => {
  const seenQuestions = new Set<string>();

  return [...sqlPairs]
    .filter((sqlPair) => {
      const question = normalizeText(sqlPair.question);
      const status = String(sqlPair.status || 'active');
      return Boolean(question) && status !== 'deprecated';
    })
    .sort((left, right) => {
      const priorityDelta =
        getSqlPairSuggestionPriority(right) -
        getSqlPairSuggestionPriority(left);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      return (left.id || 0) - (right.id || 0);
    })
    .flatMap((sqlPair) => {
      const question = normalizeText(sqlPair.question);
      const normalizedQuestion = question.toLowerCase();
      if (seenQuestions.has(normalizedQuestion)) {
        return [];
      }
      seenQuestions.add(normalizedQuestion);

      return [
        {
          question,
          label: buildSqlPairSuggestionLabel(sqlPair),
        },
      ];
    })
    .slice(0, MAX_KNOWLEDGE_BASE_SUGGESTED_QUESTIONS);
};

const buildKnowledgeBaseSuggestedQuestionsFromInstructions = (
  instructions: Instruction[],
) => {
  const seenQuestions = new Set<string>();

  return instructions
    .flatMap((instruction) =>
      (instruction.questions || []).map((question) => normalizeText(question)),
    )
    .filter((question) => {
      const normalizedQuestion = question.toLowerCase();
      if (!question || seenQuestions.has(normalizedQuestion)) {
        return false;
      }
      seenQuestions.add(normalizedQuestion);
      return true;
    })
    .slice(0, MAX_KNOWLEDGE_BASE_SUGGESTED_QUESTIONS)
    .map((question) => ({ question, label: '分析规则' }));
};

const getKnowledgeBaseSuggestedQuestions = async (ctx: IContext) => {
  if (!ctx.runtimeScope) {
    return [];
  }

  const runtimeIdentity = getCurrentPersistedRuntimeIdentity(ctx);
  const sqlPairs =
    await ctx.sqlPairRepository.findAllByRuntimeIdentity(runtimeIdentity);
  const sqlPairQuestions =
    buildKnowledgeBaseSuggestedQuestionsFromSqlPairs(sqlPairs);
  if (sqlPairQuestions.length > 0) {
    return sqlPairQuestions;
  }

  const instructions =
    await ctx.instructionRepository.findAllByRuntimeIdentity(runtimeIdentity);
  return buildKnowledgeBaseSuggestedQuestionsFromInstructions(instructions);
};

export const getSuggestedQuestionsAction = async (
  ctx: IContext,
): Promise<SuggestedQuestionResponse> => {
  await assertKnowledgeBaseReadAccess(ctx);
  const project = ctx.runtimeScope
    ? await resolveScopedRuntimeProject(ctx.runtimeScope, ctx.projectService)
    : null;
  const sampleDataset = resolveRuntimeSampleDataset(
    project,
    ctx.runtimeScope?.knowledgeBase,
  );
  const result = sampleDataset
    ? {
        questions:
          getSampleAskQuestions(sampleDataset as SampleDatasetName) || [],
      }
    : { questions: await getKnowledgeBaseSuggestedQuestions(ctx) };

  await recordKnowledgeBaseReadAudit(ctx, {
    payloadJson: {
      operation: 'get_suggested_questions',
    },
  });
  return result;
};

export const createAskingTaskAction = async (
  args: {
    data: {
      question: string;
      threadId?: number;
      knowledgeBaseIds?: string[];
      selectedSkillIds?: string[];
      clarificationSessionId?: string | null;
      clarificationState?: Record<string, unknown> | null;
      slotValues?: Record<string, unknown> | null;
    };
  },
  ctx: IContext,
): Promise<Task> => {
  await assertKnowledgeBaseReadAccess(ctx);
  const {
    question,
    threadId,
    knowledgeBaseIds,
    selectedSkillIds,
    clarificationSessionId,
    clarificationState,
    slotValues,
  } = args.data;
  if (threadId) {
    await ensureThreadScope(ctx, threadId);
  }
  await assertExecutableRuntimeScope(ctx);

  const taskInput = {
    question,
    ...(knowledgeBaseIds ? { knowledgeBaseIds } : {}),
    ...(selectedSkillIds ? { selectedSkillIds } : {}),
    ...(clarificationSessionId ? { clarificationSessionId } : {}),
    ...(clarificationState ? { clarificationState } : {}),
    ...(slotValues && Object.keys(slotValues).length > 0 ? { slotValues } : {}),
  };

  const task = await ctx.askingService.createAskingTask(taskInput, {
    runtimeScopeId: getCurrentRuntimeScopeId(ctx),
    runtimeIdentity: getCurrentPersistedRuntimeIdentity(ctx),
    threadId,
    language: await getCurrentLanguage(ctx),
  });

  ctx.telemetry.sendEvent(TelemetryEvent.HOME_ASK_CANDIDATE, {
    question,
    taskId: task.id,
  });
  return task;
};

export const cancelAskingTaskAction = async (
  args: { taskId: string },
  ctx: IContext,
): Promise<boolean> => {
  await ensureAskingTaskScope(ctx, args.taskId);
  await ctx.askingService.cancelAskingTask(args.taskId);
  return true;
};

export const getAskingTaskAction = async (
  args: { taskId: string },
  ctx: IContext,
): Promise<AskingTask | null> => {
  await ensureAskingTaskScope(ctx, args.taskId);
  const askResult = await ctx.askingService.getAskingTask(args.taskId);
  if (!askResult) {
    return null;
  }

  const eventName = TelemetryEvent.HOME_ASK_CANDIDATE;
  if (askResult.status === 'FINISHED') {
    ctx.telemetry.sendEvent(eventName, {
      taskId: args.taskId,
      status: askResult.status,
      candidates: askResult.response,
    });
  }
  if (askResult.status === 'FAILED') {
    ctx.telemetry.sendEvent(
      eventName,
      {
        taskId: args.taskId,
        status: askResult.status,
        error: askResult.error,
      },
      WrenService.AI,
      false,
    );
  }

  const result = await transformAskingTask(askResult, ctx);
  await recordKnowledgeBaseReadAudit(ctx, {
    resourceType: 'asking_task',
    resourceId: args.taskId,
    payloadJson: {
      operation: 'get_asking_task',
    },
  });
  return result;
};

export const rerunAskingTaskAction = async (
  args: { responseId: number },
  ctx: IContext,
): Promise<Task> => {
  await ensureResponseScope(ctx, args.responseId);
  const task = await ctx.askingService.rerunAskingTask(args.responseId, {
    runtimeScopeId: getCurrentRuntimeScopeId(ctx),
    runtimeIdentity: getCurrentPersistedRuntimeIdentity(ctx),
    language: await getCurrentLanguage(ctx),
  });
  ctx.telemetry.sendEvent(TelemetryEvent.HOME_RERUN_ASKING_TASK, {
    responseId: args.responseId,
  });
  return task;
};

export const createInstantRecommendedQuestionsAction = async (
  args: { data: { previousQuestions?: string[] } },
  ctx: IContext,
): Promise<Task> => {
  await assertKnowledgeBaseReadAccess(ctx);
  return ctx.askingService.createInstantRecommendedQuestions(
    args.data,
    getCurrentPersistedRuntimeIdentity(ctx),
    getCurrentRuntimeScopeId(ctx),
  );
};

export const getInstantRecommendedQuestionsAction = async (
  args: { taskId: string },
  ctx: IContext,
): Promise<RecommendedQuestionsTask> => {
  await assertKnowledgeBaseReadAccess(ctx);
  const result = await ctx.askingService.getInstantRecommendedQuestions(
    args.taskId,
    getCurrentPersistedRuntimeIdentity(ctx),
  );
  const task = {
    questions: result.response?.questions || [],
    status: result.status,
    error: result.error,
  };
  await recordKnowledgeBaseReadAudit(ctx, {
    resourceType: 'asking_task',
    resourceId: args.taskId,
    payloadJson: {
      operation: 'get_instant_recommended_questions',
    },
  });
  return task;
};

export const getAdjustmentTaskAction = async (
  args: { taskId: string },
  ctx: IContext,
) => {
  await ensureAskingTaskScope(ctx, args.taskId);
  const adjustmentTask = await ctx.askingService.getAdjustmentTask(args.taskId);
  if (!adjustmentTask) {
    return null;
  }

  const result = formatAdjustmentTask(adjustmentTask);
  await recordKnowledgeBaseReadAudit(ctx, {
    resourceType: 'asking_task',
    resourceId: args.taskId,
    payloadJson: {
      operation: 'get_adjustment_task',
    },
  });
  return result;
};

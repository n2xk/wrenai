import { IWrenAIAdaptor } from '@server/adaptors';
import { PersistedRuntimeIdentity } from '@server/context/runtimeScope';
import {
  AskRuntimeIdentity,
  GenerateInstructionInput,
  InstructionResult,
  InstructionStatus,
} from '@server/models/adaptor';
import {
  BusinessTerm,
  IBusinessTermRepository,
  ExternalDependency,
  IExternalDependencyRepository,
} from '@server/repositories';
import * as Errors from '@server/utils/error';
import { GeneralErrorCodes } from '@server/utils/error';
import { toPersistedRuntimeIdentityPatch } from '@server/utils/persistedRuntimeIdentity';

const toAskRuntimeIdentity = (
  runtimeIdentity: PersistedRuntimeIdentity,
): AskRuntimeIdentity => {
  const normalizedRuntimeIdentity =
    toPersistedRuntimeIdentityPatch(runtimeIdentity);

  return {
    projectId:
      typeof normalizedRuntimeIdentity.projectId === 'number'
        ? normalizedRuntimeIdentity.projectId
        : undefined,
    workspaceId: normalizedRuntimeIdentity.workspaceId ?? null,
    knowledgeBaseId: normalizedRuntimeIdentity.knowledgeBaseId ?? null,
    kbSnapshotId: normalizedRuntimeIdentity.kbSnapshotId ?? null,
    deployHash: normalizedRuntimeIdentity.deployHash ?? null,
    actorUserId: normalizedRuntimeIdentity.actorUserId ?? null,
  };
};

const toKnowledgeAssetRuntimeIdentity = (
  runtimeIdentity: PersistedRuntimeIdentity,
) => {
  const normalizedRuntimeIdentity =
    toPersistedRuntimeIdentityPatch(runtimeIdentity);

  if (!normalizedRuntimeIdentity.knowledgeBaseId) {
    return normalizedRuntimeIdentity;
  }

  return {
    ...normalizedRuntimeIdentity,
    kbSnapshotId: null,
    deployHash: null,
  };
};

const normalizeStringList = (value: unknown): string[] => {
  const values = Array.isArray(value) ? value : [];
  return Array.from(
    new Set(
      values
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean),
    ),
  );
};

const normalizeObject = (value: unknown): Record<string, any> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;

const buildInstructionQuestions = (...groups: unknown[]) =>
  normalizeStringList(
    groups.flatMap((group) => (Array.isArray(group) ? group : [group])),
  );

export interface CreateBusinessTerm {
  termId: string;
  name: string;
  category?: string;
  aliases?: string[];
  definition?: string;
  canonicalExpression?: string | null;
  sourceTables?: string[];
  sourceFields?: string[];
  relatedRules?: string[];
  relatedTemplates?: string[];
  features?: string[];
  conflictTerms?: string[];
  status?: string;
}

export type UpdateBusinessTerm = Partial<CreateBusinessTerm>;

export interface CreateExternalDependency {
  dependencyId: string;
  name: string;
  aliases?: string[];
  sourceStatus?: string;
  missingBehavior?: string;
  requiredGrain?: string[];
  requiredByTerms?: string[];
  requiredByTemplates?: string[];
  relatedRules?: string[];
  askUserPrompt?: string | null;
  validation?: Record<string, any> | null;
  status?: string;
}

export type UpdateExternalDependency = Partial<CreateExternalDependency>;

export interface IBusinessKnowledgeService {
  listBusinessTerms(
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<BusinessTerm[]>;
  getBusinessTerm(
    runtimeIdentity: PersistedRuntimeIdentity,
    id: number,
  ): Promise<BusinessTerm | null>;
  createBusinessTerm(
    runtimeIdentity: PersistedRuntimeIdentity,
    input: CreateBusinessTerm,
  ): Promise<BusinessTerm>;
  updateBusinessTerm(
    runtimeIdentity: PersistedRuntimeIdentity,
    id: number,
    input: UpdateBusinessTerm,
  ): Promise<BusinessTerm>;
  deleteBusinessTerm(
    runtimeIdentity: PersistedRuntimeIdentity,
    id: number,
  ): Promise<void>;

  listExternalDependencies(
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<ExternalDependency[]>;
  getExternalDependency(
    runtimeIdentity: PersistedRuntimeIdentity,
    id: number,
  ): Promise<ExternalDependency | null>;
  createExternalDependency(
    runtimeIdentity: PersistedRuntimeIdentity,
    input: CreateExternalDependency,
  ): Promise<ExternalDependency>;
  updateExternalDependency(
    runtimeIdentity: PersistedRuntimeIdentity,
    id: number,
    input: UpdateExternalDependency,
  ): Promise<ExternalDependency>;
  deleteExternalDependency(
    runtimeIdentity: PersistedRuntimeIdentity,
    id: number,
  ): Promise<void>;
}

export class BusinessKnowledgeService implements IBusinessKnowledgeService {
  private static readonly DEPLOY_TIMEOUT_SECONDS = 90;

  constructor({
    businessTermRepository,
    externalDependencyRepository,
    wrenAIAdaptor,
  }: {
    businessTermRepository: IBusinessTermRepository;
    externalDependencyRepository: IExternalDependencyRepository;
    wrenAIAdaptor: IWrenAIAdaptor;
  }) {
    this.businessTermRepository = businessTermRepository;
    this.externalDependencyRepository = externalDependencyRepository;
    this.wrenAIAdaptor = wrenAIAdaptor;
  }

  private readonly businessTermRepository: IBusinessTermRepository;
  private readonly externalDependencyRepository: IExternalDependencyRepository;
  private readonly wrenAIAdaptor: IWrenAIAdaptor;

  public async listBusinessTerms(
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<BusinessTerm[]> {
    return this.businessTermRepository.findAllByRuntimeIdentity(
      toKnowledgeAssetRuntimeIdentity(runtimeIdentity),
    );
  }

  public async getBusinessTerm(
    runtimeIdentity: PersistedRuntimeIdentity,
    id: number,
  ): Promise<BusinessTerm | null> {
    return this.businessTermRepository.findOneByIdWithRuntimeIdentity(
      id,
      toKnowledgeAssetRuntimeIdentity(runtimeIdentity),
    );
  }

  public async createBusinessTerm(
    runtimeIdentity: PersistedRuntimeIdentity,
    input: CreateBusinessTerm,
  ): Promise<BusinessTerm> {
    this.validateBusinessTermInput(input);
    const tx = await this.businessTermRepository.transaction();
    try {
      const actorUserId =
        toPersistedRuntimeIdentityPatch(runtimeIdentity).actorUserId;
      const now = new Date().toISOString();
      const term = await this.businessTermRepository.createOne(
        {
          ...this.normalizeBusinessTermInput(input),
          ...toKnowledgeAssetRuntimeIdentity(runtimeIdentity),
          actorUserId,
          createdBy: actorUserId ?? null,
          updatedBy: actorUserId ?? null,
          createdAt: now,
          updatedAt: now,
        },
        { tx },
      );
      await this.deployBusinessAsset(
        runtimeIdentity,
        this.toBusinessTermInstruction(term),
      );
      await tx.commit();
      return term;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  public async updateBusinessTerm(
    runtimeIdentity: PersistedRuntimeIdentity,
    id: number,
    input: UpdateBusinessTerm,
  ): Promise<BusinessTerm> {
    const existing = await this.getBusinessTerm(runtimeIdentity, id);
    if (!existing) {
      throw new Error('Business term not found');
    }
    this.validateBusinessTermInput({ ...existing, ...input });
    const tx = await this.businessTermRepository.transaction();
    try {
      const actorUserId =
        toPersistedRuntimeIdentityPatch(runtimeIdentity).actorUserId;
      const term = await this.businessTermRepository.updateOne(
        id,
        {
          ...existing,
          ...this.normalizeBusinessTermInput({ ...existing, ...input }),
          updatedBy: actorUserId ?? existing.updatedBy ?? null,
          updatedAt: new Date().toISOString(),
        },
        { tx },
      );
      await this.deployBusinessAsset(
        runtimeIdentity,
        this.toBusinessTermInstruction(term),
      );
      await tx.commit();
      return term;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  public async deleteBusinessTerm(
    runtimeIdentity: PersistedRuntimeIdentity,
    id: number,
  ): Promise<void> {
    const existing = await this.getBusinessTerm(runtimeIdentity, id);
    if (!existing) {
      throw new Error('Business term not found');
    }
    const tx = await this.businessTermRepository.transaction();
    try {
      await this.businessTermRepository.deleteOne(id, { tx });
      await this.wrenAIAdaptor.deleteInstructions({
        ids: [this.buildBusinessTermInstructionId(id)],
        runtimeIdentity: toAskRuntimeIdentity(runtimeIdentity),
      });
      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  public async listExternalDependencies(
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<ExternalDependency[]> {
    return this.externalDependencyRepository.findAllByRuntimeIdentity(
      toKnowledgeAssetRuntimeIdentity(runtimeIdentity),
    );
  }

  public async getExternalDependency(
    runtimeIdentity: PersistedRuntimeIdentity,
    id: number,
  ): Promise<ExternalDependency | null> {
    return this.externalDependencyRepository.findOneByIdWithRuntimeIdentity(
      id,
      toKnowledgeAssetRuntimeIdentity(runtimeIdentity),
    );
  }

  public async createExternalDependency(
    runtimeIdentity: PersistedRuntimeIdentity,
    input: CreateExternalDependency,
  ): Promise<ExternalDependency> {
    this.validateExternalDependencyInput(input);
    const tx = await this.externalDependencyRepository.transaction();
    try {
      const actorUserId =
        toPersistedRuntimeIdentityPatch(runtimeIdentity).actorUserId;
      const now = new Date().toISOString();
      const dependency = await this.externalDependencyRepository.createOne(
        {
          ...this.normalizeExternalDependencyInput(input),
          ...toKnowledgeAssetRuntimeIdentity(runtimeIdentity),
          actorUserId,
          createdBy: actorUserId ?? null,
          updatedBy: actorUserId ?? null,
          createdAt: now,
          updatedAt: now,
        },
        { tx },
      );
      await this.deployBusinessAsset(
        runtimeIdentity,
        this.toExternalDependencyInstruction(dependency),
      );
      await tx.commit();
      return dependency;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  public async updateExternalDependency(
    runtimeIdentity: PersistedRuntimeIdentity,
    id: number,
    input: UpdateExternalDependency,
  ): Promise<ExternalDependency> {
    const existing = await this.getExternalDependency(runtimeIdentity, id);
    if (!existing) {
      throw new Error('External dependency not found');
    }
    this.validateExternalDependencyInput({ ...existing, ...input });
    const tx = await this.externalDependencyRepository.transaction();
    try {
      const actorUserId =
        toPersistedRuntimeIdentityPatch(runtimeIdentity).actorUserId;
      const dependency = await this.externalDependencyRepository.updateOne(
        id,
        {
          ...existing,
          ...this.normalizeExternalDependencyInput({ ...existing, ...input }),
          updatedBy: actorUserId ?? existing.updatedBy ?? null,
          updatedAt: new Date().toISOString(),
        },
        { tx },
      );
      await this.deployBusinessAsset(
        runtimeIdentity,
        this.toExternalDependencyInstruction(dependency),
      );
      await tx.commit();
      return dependency;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  public async deleteExternalDependency(
    runtimeIdentity: PersistedRuntimeIdentity,
    id: number,
  ): Promise<void> {
    const existing = await this.getExternalDependency(runtimeIdentity, id);
    if (!existing) {
      throw new Error('External dependency not found');
    }
    const tx = await this.externalDependencyRepository.transaction();
    try {
      await this.externalDependencyRepository.deleteOne(id, { tx });
      await this.wrenAIAdaptor.deleteInstructions({
        ids: [this.buildExternalDependencyInstructionId(id)],
        runtimeIdentity: toAskRuntimeIdentity(runtimeIdentity),
      });
      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  private validateBusinessTermInput(input: Partial<CreateBusinessTerm>) {
    if (!input.termId?.trim()) {
      throw new Error('Business term id is required');
    }
    if (!input.name?.trim()) {
      throw new Error('Business term name is required');
    }
  }

  private validateExternalDependencyInput(
    input: Partial<CreateExternalDependency>,
  ) {
    if (!input.dependencyId?.trim()) {
      throw new Error('External dependency id is required');
    }
    if (!input.name?.trim()) {
      throw new Error('External dependency name is required');
    }
  }

  private normalizeBusinessTermInput(input: Partial<CreateBusinessTerm>) {
    return {
      termId: input.termId?.trim() || '',
      name: input.name?.trim() || '',
      category: input.category?.trim() || 'metric',
      aliases: normalizeStringList(input.aliases),
      definition: input.definition?.trim() || '',
      canonicalExpression: input.canonicalExpression?.trim() || null,
      sourceTables: normalizeStringList(input.sourceTables),
      sourceFields: normalizeStringList(input.sourceFields),
      relatedRules: normalizeStringList(input.relatedRules),
      relatedTemplates: normalizeStringList(input.relatedTemplates),
      features: normalizeStringList(input.features),
      conflictTerms: normalizeStringList(input.conflictTerms),
      status: input.status?.trim() || 'active',
    };
  }

  private normalizeExternalDependencyInput(
    input: Partial<CreateExternalDependency>,
  ) {
    return {
      dependencyId: input.dependencyId?.trim() || '',
      name: input.name?.trim() || '',
      aliases: normalizeStringList(input.aliases),
      sourceStatus: input.sourceStatus?.trim() || 'missing',
      missingBehavior: input.missingBehavior?.trim() || 'ask_user',
      requiredGrain: normalizeStringList(input.requiredGrain),
      requiredByTerms: normalizeStringList(input.requiredByTerms),
      requiredByTemplates: normalizeStringList(input.requiredByTemplates),
      relatedRules: normalizeStringList(input.relatedRules),
      askUserPrompt: input.askUserPrompt?.trim() || null,
      validation: normalizeObject(input.validation),
      status: input.status?.trim() || 'active',
    };
  }

  private buildBusinessTermInstructionId(id: number) {
    return `business_term:${id}`;
  }

  private buildExternalDependencyInstructionId(id: number) {
    return `external_dependency:${id}`;
  }

  private toBusinessTermInstruction(
    term: BusinessTerm,
  ): GenerateInstructionInput {
    const instruction = [
      `[业务词典] ${term.name} (${term.termId})`,
      term.definition ? `定义：${term.definition}` : '',
      term.aliases?.length ? `同义词：${term.aliases.join('、')}` : '',
      term.canonicalExpression ? `规范表达式：${term.canonicalExpression}` : '',
      term.features?.length ? `业务特征：${term.features.join('、')}` : '',
      term.relatedRules?.length
        ? `关联分析规则：${term.relatedRules.join('、')}`
        : '',
      term.relatedTemplates?.length
        ? `关联 SQL 模板：${term.relatedTemplates.join('、')}`
        : '',
      term.sourceTables?.length
        ? `来源表：${term.sourceTables.join('、')}`
        : '',
      term.sourceFields?.length
        ? `来源字段：${term.sourceFields.join('、')}`
        : '',
      term.conflictTerms?.length
        ? `易混淆概念：${term.conflictTerms.join('、')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      id: this.buildBusinessTermInstructionId(term.id),
      instruction,
      questions: buildInstructionQuestions(
        term.name,
        term.aliases,
        term.features,
      ),
      isDefault: false,
      knowledgeAssetType: 'business_term',
      businessTermId: term.termId,
      aliases: term.aliases || [],
      relatedBusinessTerms: [term.termId],
      relatedExternalDependencies: [],
      runtimeUsage: {
        participates_in: ['instruction_retrieval', 'template_matching'],
        priority_hint: 'medium',
      },
      metadata: {
        category: term.category,
        canonical_expression: term.canonicalExpression,
        related_rules: term.relatedRules,
        related_templates: term.relatedTemplates,
        source_tables: term.sourceTables,
        source_fields: term.sourceFields,
        features: term.features,
        conflict_terms: term.conflictTerms,
        status: term.status,
      },
    };
  }

  private toExternalDependencyInstruction(
    dependency: ExternalDependency,
  ): GenerateInstructionInput {
    const fallbackPrompt = `请提供当前问题对应统计粒度的${dependency.name}。`;
    const askUserPrompt = dependency.askUserPrompt || fallbackPrompt;
    const instruction = [
      `[外部数据依赖] ${dependency.name} (${dependency.dependencyId})`,
      dependency.aliases?.length
        ? `同义词：${dependency.aliases.join('、')}`
        : '',
      `数据状态：${dependency.sourceStatus}`,
      `缺失处理：${dependency.missingBehavior}`,
      dependency.requiredGrain?.length
        ? `所需粒度：${dependency.requiredGrain.join('、')}`
        : '',
      dependency.requiredByTerms?.length
        ? `依赖业务概念：${dependency.requiredByTerms.join('、')}`
        : '',
      dependency.requiredByTemplates?.length
        ? `依赖 SQL 模板：${dependency.requiredByTemplates.join('、')}`
        : '',
      dependency.relatedRules?.length
        ? `关联分析规则：${dependency.relatedRules.join('、')}`
        : '',
      `缺失时提示：${askUserPrompt}`,
    ]
      .filter(Boolean)
      .join('\n');

    return {
      id: this.buildExternalDependencyInstructionId(dependency.id),
      instruction,
      questions: buildInstructionQuestions(
        dependency.name,
        dependency.aliases,
        dependency.requiredByTerms,
        dependency.requiredByTemplates,
      ),
      isDefault: false,
      knowledgeAssetType: 'external_dependency',
      externalDependencyId: dependency.dependencyId,
      aliases: dependency.aliases || [],
      sourceStatus: dependency.sourceStatus,
      missingBehavior: dependency.missingBehavior,
      askUserPrompt,
      requiredGrain: dependency.requiredGrain || [],
      relatedBusinessTerms: dependency.requiredByTerms || [],
      relatedExternalDependencies: [dependency.dependencyId],
      runtimeUsage: {
        participates_in: ['external_dependency_detection', 'ask_user_followup'],
        priority_hint: 'high',
      },
      metadata: {
        required_by_terms: dependency.requiredByTerms,
        required_by_templates: dependency.requiredByTemplates,
        related_rules: dependency.relatedRules,
        validation: dependency.validation,
        status: dependency.status,
      },
    };
  }

  private async deployBusinessAsset(
    runtimeIdentity: PersistedRuntimeIdentity,
    instruction: GenerateInstructionInput,
  ) {
    const { queryId } = await this.wrenAIAdaptor.generateInstruction({
      instructions: [instruction],
      runtimeIdentity: toAskRuntimeIdentity(runtimeIdentity),
    });
    const res = await this.waitDeployInstruction(queryId);
    if (res.error) {
      throw Errors.create(res.error.code, {
        customMessage: res.error.message,
      });
    }
  }

  private async waitDeployInstruction(
    queryId: string,
    maxRetries = BusinessKnowledgeService.DEPLOY_TIMEOUT_SECONDS,
  ): Promise<InstructionResult> {
    const isFinalStatus = (status: InstructionStatus) =>
      status === InstructionStatus.FINISHED ||
      status === InstructionStatus.FAILED;

    let res = await this.wrenAIAdaptor.getInstructionResult(queryId);
    let retryCount = 0;

    while (!isFinalStatus(res.status) && retryCount < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      res = await this.wrenAIAdaptor.getInstructionResult(queryId);
      retryCount++;
    }

    if (!isFinalStatus(res.status)) {
      throw Errors.create(GeneralErrorCodes.DEPLOY_TIMEOUT_ERROR, {
        customMessage: `Business knowledge deployment timed out after ${maxRetries} seconds`,
      });
    }

    return res;
  }
}

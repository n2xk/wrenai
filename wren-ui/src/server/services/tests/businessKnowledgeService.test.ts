import { BusinessKnowledgeService } from '../businessKnowledgeService';

describe('BusinessKnowledgeService', () => {
  const createService = () => {
    const businessTermRepository = {
      findAllByRuntimeIdentity: jest.fn(),
      findOneByIdWithRuntimeIdentity: jest.fn(),
      transaction: jest.fn(),
    } as any;
    const externalDependencyRepository = {
      findAllByRuntimeIdentity: jest.fn(),
      findOneByIdWithRuntimeIdentity: jest.fn(),
      transaction: jest.fn(),
    } as any;
    const wrenAIAdaptor = {
      generateInstruction: jest.fn(),
      getInstructionResult: jest.fn(),
      deleteInstructions: jest.fn(),
    } as any;
    const service = new BusinessKnowledgeService({
      businessTermRepository,
      externalDependencyRepository,
      wrenAIAdaptor,
    });

    return {
      service,
      businessTermRepository,
      externalDependencyRepository,
    };
  };

  it('builds deployable instructions with structured business knowledge metadata', async () => {
    const { service, businessTermRepository, externalDependencyRepository } =
      createService();
    businessTermRepository.findAllByRuntimeIdentity.mockResolvedValue([
      {
        id: 11,
        termId: 'first_deposit',
        name: '首存',
        category: 'metric',
        aliases: ['首充'],
        definition: '成功存款且 times = 1',
        canonicalExpression:
          'dwd_order_deposit.status = 2 AND dwd_order_deposit.times = 1',
        sourceTables: ['dwd_order_deposit'],
        sourceFields: ['status', 'times'],
        relatedRules: ['R02'],
        relatedTemplates: ['T10'],
        features: ['cohort'],
        conflictTerms: ['普通充值'],
        applicableScenarios: ['首存 cohort'],
        notApplicableScenarios: ['普通充值订单汇总'],
        requiredSlots: ['tenant_plat_id'],
        status: 'active',
      },
    ]);
    externalDependencyRepository.findAllByRuntimeIdentity.mockResolvedValue([
      {
        id: 12,
        dependencyId: 'ad_spend',
        name: '投放金额',
        aliases: ['买量成本'],
        sourceStatus: 'missing',
        missingBehavior: 'ask_user',
        requiredGrain: ['日期', '渠道ID'],
        requiredByTerms: ['ROI'],
        requiredByTemplates: ['T09'],
        relatedRules: ['R09'],
        triggerWhen: ['ROI'],
        notTriggerWhen: ['充值明细'],
        lifecycle: 'per_question',
        inputModes: ['manual_csv'],
        askUserPrompt: '请补充投放金额',
        validation: { required_columns: ['日期', '渠道ID', '投放金额'] },
        status: 'active',
      },
    ]);

    const instructions = await service.listBusinessKnowledgeInstructions({
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      actorUserId: 'user-1',
    });

    expect(
      businessTermRepository.findAllByRuntimeIdentity,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: null,
        deployHash: null,
      }),
    );
    expect(
      externalDependencyRepository.findAllByRuntimeIdentity,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: null,
        deployHash: null,
      }),
    );
    expect(instructions).toEqual([
      expect.objectContaining({
        id: 'business_term:11',
        knowledgeAssetType: 'business_term',
        businessTermId: 'first_deposit',
        aliases: ['首充'],
        relatedBusinessTerms: ['first_deposit'],
        runtimeUsage: expect.objectContaining({
          participates_in: ['instruction_retrieval', 'template_matching'],
        }),
        metadata: expect.objectContaining({
          canonical_expression:
            'dwd_order_deposit.status = 2 AND dwd_order_deposit.times = 1',
          required_slots: ['tenant_plat_id'],
        }),
      }),
      expect.objectContaining({
        id: 'external_dependency:12',
        knowledgeAssetType: 'external_dependency',
        externalDependencyId: 'ad_spend',
        sourceStatus: 'missing',
        missingBehavior: 'ask_user',
        askUserPrompt: '请补充投放金额',
        requiredGrain: ['日期', '渠道ID'],
        relatedBusinessTerms: ['ROI'],
        relatedExternalDependencies: ['ad_spend'],
        runtimeUsage: expect.objectContaining({
          participates_in: [
            'external_dependency_detection',
            'ask_user_followup',
          ],
        }),
        metadata: expect.objectContaining({
          required_by_terms: ['ROI'],
          required_by_templates: ['T09'],
          trigger_when: ['ROI'],
          validation: { required_columns: ['日期', '渠道ID', '投放金额'] },
        }),
      }),
    ]);
  });
});

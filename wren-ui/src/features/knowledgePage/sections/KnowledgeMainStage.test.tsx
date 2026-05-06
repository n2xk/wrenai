import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import KnowledgeMainStage from './KnowledgeMainStage';
import type { KnowledgeMainStageProps } from './knowledgeMainStageTypes';

jest.mock('./useKnowledgeWorkbenchEditors', () => ({
  __esModule: true,
  useKnowledgeWorkbenchEditors: () => ({
    handleCreateRuleFromAsset: jest.fn(),
    handleCreateSqlTemplateFromAsset: jest.fn(),
    handleWorkbenchSectionChange: jest.fn(),
  }),
}));

const buildProps = (
  overrides: Partial<KnowledgeMainStageProps> = {},
): KnowledgeMainStageProps => ({
  activeWorkbenchSection: 'overview',
  onChangeWorkbenchSection: jest.fn(),
  previewFieldCount: 0,
  isSnapshotReadonlyKnowledgeBase: false,
  isReadonlyKnowledgeBase: false,
  isKnowledgeMutationDisabled: false,
  hasActiveKnowledgeBase: true,
  canCreateKnowledgeBase: true,
  createKnowledgeBaseBlockedReason: '',
  knowledgeMutationHint: null,
  knowledgeDescription: null,
  showKnowledgeAssetsLoading: false,
  detailAssets: [],
  activeDetailAsset: null,
  detailTab: 'overview',
  detailFieldKeyword: '',
  detailFieldFilter: 'all',
  detailAssetFields: [],
  onOpenAssetWizard: jest.fn(),
  onOpenKnowledgeEditor: jest.fn(),
  onCreateKnowledgeBase: jest.fn(),
  onOpenAssetDetail: jest.fn(),
  onCloseAssetDetail: jest.fn(),
  onChangeDetailTab: jest.fn(),
  onChangeFieldKeyword: jest.fn(),
  onChangeFieldFilter: jest.fn(),
  historicalSnapshotReadonlyHint: 'readonly',
  ruleList: [],
  sqlList: [],
  ruleManageLoading: false,
  sqlManageLoading: false,
  onOpenRuleDetail: jest.fn(),
  onOpenSqlTemplateDetail: jest.fn(),
  onDeleteRule: jest.fn(),
  onDeleteSqlTemplate: jest.fn(),
  editingInstruction: null,
  editingSqlPair: null,
  ruleForm: {} as any,
  sqlTemplateForm: {} as any,
  createInstructionLoading: false,
  updateInstructionLoading: false,
  createSqlPairLoading: false,
  updateSqlPairLoading: false,
  onSubmitRuleDetail: jest.fn(),
  onSubmitSqlTemplateDetail: jest.fn(),
  onResetRuleDetailEditor: jest.fn(),
  onResetSqlTemplateEditor: jest.fn(),
  modelingWorkspaceKey: 'key',
  modelingSummary: { modelCount: 0, viewCount: 0, relationCount: 0 },
  onOpenModeling: jest.fn(),
  ...overrides,
});

describe('KnowledgeMainStage', () => {
  it('renders a creation empty state instead of governance tabs when no knowledge base exists', () => {
    const html = renderToStaticMarkup(
      <KnowledgeMainStage
        {...buildProps({
          hasActiveKnowledgeBase: false,
          isKnowledgeMutationDisabled: true,
          knowledgeMutationHint: '请先创建或选择知识库，再添加业务资产。',
        })}
      />,
    );

    expect(html).toContain('还没有知识库');
    expect(html).toContain('创建知识库');
    expect(html).not.toContain('建模 AI 助手');
    expect(html).not.toContain('knowledge-workbench-tab');
  });
});

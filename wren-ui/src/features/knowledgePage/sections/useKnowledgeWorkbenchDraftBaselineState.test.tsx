import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useKnowledgeWorkbenchDraftBaselineState } from './useKnowledgeWorkbenchDraftBaselineState';

describe('useKnowledgeWorkbenchDraftBaselineState', () => {
  const renderHarness = () => {
    let current: ReturnType<
      typeof useKnowledgeWorkbenchDraftBaselineState
    > | null = null;

    const ruleForm = {
      getFieldsValue: jest.fn(() => ({
        summary: 'Rule summary',
        scope: 'matched',
        content: 'Rule content',
      })),
    };
    const sqlTemplateForm = {
      getFieldsValue: jest.fn(() => ({
        description: 'SQL summary',
        sql: 'select 1',
        scope: 'all',
        templateMode: 'reference',
        requiredSlotsText: 'tenant_plat_id',
        expectedGrain: 'biz_date',
        positiveScenariosText: '渠道日汇总',
        negativeScenariosText: '单玩家明细',
        externalDependenciesText: 'ad_spend',
        parameterSchemaJson: '{ "required": ["tenant_plat_id"] }',
        businessSignatureJson: '{ "positiveCues": ["渠道日汇总"] }',
      })),
    };

    const Harness = () => {
      current = useKnowledgeWorkbenchDraftBaselineState({
        ruleForm,
        sqlTemplateForm,
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    if (!current) {
      throw new Error(
        'Failed to initialize useKnowledgeWorkbenchDraftBaselineState',
      );
    }

    return {
      hook: current as ReturnType<
        typeof useKnowledgeWorkbenchDraftBaselineState
      >,
      ruleForm,
      sqlTemplateForm,
    };
  };

  it('uses explicit next values without reading the current form state', () => {
    const { hook, ruleForm, sqlTemplateForm } = renderHarness();

    hook.syncSqlDraftBaseline({
      description: 'Orders',
      sql: 'select * from orders',
      scope: 'all',
      templateMode: 'anchored_template',
    });
    hook.syncRuleDraftBaseline({
      summary: 'Rules',
      scope: 'matched',
      content: 'content',
    });

    expect(sqlTemplateForm.getFieldsValue).not.toHaveBeenCalled();
    expect(ruleForm.getFieldsValue).not.toHaveBeenCalled();
  });

  it('reads current form values when explicit next values are absent', () => {
    const { hook, ruleForm, sqlTemplateForm } = renderHarness();

    hook.syncSqlDraftBaseline();
    hook.syncRuleDraftBaseline();

    expect(sqlTemplateForm.getFieldsValue).toHaveBeenCalledWith([
      'description',
      'sql',
      'scope',
      'templateMode',
      'requiredSlotsText',
      'expectedGrain',
      'positiveScenariosText',
      'negativeScenariosText',
      'externalDependenciesText',
      'parameterSchemaJson',
      'businessSignatureJson',
    ]);
    expect(ruleForm.getFieldsValue).toHaveBeenCalledWith([
      'summary',
      'scope',
      'content',
    ]);
  });
});

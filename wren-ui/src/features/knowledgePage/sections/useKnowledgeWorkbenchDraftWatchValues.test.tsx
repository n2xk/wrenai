import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Form } from 'antd';
import { useKnowledgeWorkbenchDraftWatchValues } from './useKnowledgeWorkbenchDraftWatchValues';

jest.mock('antd', () => ({
  Form: {
    useWatch: jest.fn(),
  },
}));

describe('useKnowledgeWorkbenchDraftWatchValues', () => {
  const mockUseWatch = Form.useWatch as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseWatch.mockImplementation(
      (name: string, form: any) => `${form.name}:${name}`,
    );
  });

  const renderHarness = () => {
    let current: ReturnType<
      typeof useKnowledgeWorkbenchDraftWatchValues
    > | null = null;
    const ruleForm = { name: 'ruleForm' };
    const sqlTemplateForm = { name: 'sqlForm' };

    const Harness = () => {
      current = useKnowledgeWorkbenchDraftWatchValues({
        ruleForm,
        sqlTemplateForm,
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));

    if (!current) {
      throw new Error(
        'Failed to initialize useKnowledgeWorkbenchDraftWatchValues',
      );
    }

    return {
      hook: current as ReturnType<typeof useKnowledgeWorkbenchDraftWatchValues>,
      ruleForm,
      sqlTemplateForm,
    };
  };

  it('watches the expected rule and sql fields from each form', () => {
    const { hook, ruleForm, sqlTemplateForm } = renderHarness();

    expect(mockUseWatch).toHaveBeenNthCalledWith(1, 'summary', ruleForm);
    expect(mockUseWatch).toHaveBeenNthCalledWith(2, 'scope', ruleForm);
    expect(mockUseWatch).toHaveBeenNthCalledWith(3, 'content', ruleForm);
    expect(mockUseWatch).toHaveBeenNthCalledWith(
      4,
      'description',
      sqlTemplateForm,
    );
    expect(mockUseWatch).toHaveBeenNthCalledWith(5, 'sql', sqlTemplateForm);
    expect(mockUseWatch).toHaveBeenNthCalledWith(
      6,
      'templateMode',
      sqlTemplateForm,
    );
    expect(mockUseWatch).toHaveBeenNthCalledWith(
      7,
      'requiredSlotsText',
      sqlTemplateForm,
    );
    expect(mockUseWatch).toHaveBeenNthCalledWith(
      8,
      'expectedGrain',
      sqlTemplateForm,
    );
    expect(mockUseWatch).toHaveBeenNthCalledWith(
      9,
      'positiveScenariosText',
      sqlTemplateForm,
    );
    expect(mockUseWatch).toHaveBeenNthCalledWith(
      10,
      'negativeScenariosText',
      sqlTemplateForm,
    );
    expect(mockUseWatch).toHaveBeenNthCalledWith(
      11,
      'externalDependenciesText',
      sqlTemplateForm,
    );
    expect(mockUseWatch).toHaveBeenNthCalledWith(
      12,
      'parameterSchemaJson',
      sqlTemplateForm,
    );
    expect(mockUseWatch).toHaveBeenNthCalledWith(
      13,
      'businessSignatureJson',
      sqlTemplateForm,
    );
    expect(hook).toEqual({
      watchedRuleContent: 'ruleForm:content',
      watchedRuleScope: 'ruleForm:scope',
      watchedRuleSummary: 'ruleForm:summary',
      watchedSqlBusinessSignatureJson: 'sqlForm:businessSignatureJson',
      watchedSqlContent: 'sqlForm:sql',
      watchedSqlDescription: 'sqlForm:description',
      watchedSqlExpectedGrain: 'sqlForm:expectedGrain',
      watchedSqlExternalDependenciesText: 'sqlForm:externalDependenciesText',
      watchedSqlNegativeScenariosText: 'sqlForm:negativeScenariosText',
      watchedSqlParameterSchemaJson: 'sqlForm:parameterSchemaJson',
      watchedSqlPositiveScenariosText: 'sqlForm:positiveScenariosText',
      watchedSqlRequiredSlotsText: 'sqlForm:requiredSlotsText',
      watchedSqlTemplateMode: 'sqlForm:templateMode',
    });
  });
});

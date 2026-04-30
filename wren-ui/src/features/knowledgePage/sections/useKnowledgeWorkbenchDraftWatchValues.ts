import { Form } from 'antd';

export function useKnowledgeWorkbenchDraftWatchValues({
  ruleForm,
  sqlTemplateForm,
}: {
  ruleForm: any;
  sqlTemplateForm: any;
}) {
  const watchedRuleSummary = Form.useWatch('summary', ruleForm);
  const watchedRuleScope = Form.useWatch('scope', ruleForm);
  const watchedRuleContent = Form.useWatch('content', ruleForm);
  const watchedSqlDescription = Form.useWatch('description', sqlTemplateForm);
  const watchedSqlContent = Form.useWatch('sql', sqlTemplateForm);
  const watchedSqlTemplateMode = Form.useWatch('templateMode', sqlTemplateForm);
  const watchedSqlRequiredSlotsText = Form.useWatch(
    'requiredSlotsText',
    sqlTemplateForm,
  );
  const watchedSqlExpectedGrain = Form.useWatch(
    'expectedGrain',
    sqlTemplateForm,
  );
  const watchedSqlPositiveScenariosText = Form.useWatch(
    'positiveScenariosText',
    sqlTemplateForm,
  );
  const watchedSqlNegativeScenariosText = Form.useWatch(
    'negativeScenariosText',
    sqlTemplateForm,
  );
  const watchedSqlExternalDependenciesText = Form.useWatch(
    'externalDependenciesText',
    sqlTemplateForm,
  );
  const watchedSqlParameterSchemaJson = Form.useWatch(
    'parameterSchemaJson',
    sqlTemplateForm,
  );
  const watchedSqlBusinessSignatureJson = Form.useWatch(
    'businessSignatureJson',
    sqlTemplateForm,
  );

  return {
    watchedRuleContent,
    watchedRuleScope,
    watchedRuleSummary,
    watchedSqlContent,
    watchedSqlDescription,
    watchedSqlBusinessSignatureJson,
    watchedSqlExpectedGrain,
    watchedSqlExternalDependenciesText,
    watchedSqlNegativeScenariosText,
    watchedSqlParameterSchemaJson,
    watchedSqlPositiveScenariosText,
    watchedSqlRequiredSlotsText,
    watchedSqlTemplateMode,
  };
}

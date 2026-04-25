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

  return {
    watchedRuleContent,
    watchedRuleScope,
    watchedRuleSummary,
    watchedSqlContent,
    watchedSqlDescription,
    watchedSqlTemplateMode,
  };
}

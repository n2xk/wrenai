import { Instruction, SqlPair } from '@/types/knowledge';
import {
  EMPTY_RULE_EDITOR_VALUES,
  EMPTY_SQL_TEMPLATE_VALUES,
} from '@/utils/knowledgeWorkbenchEditor';
import {
  buildSqlTemplateFormValues,
  parseInstructionDraft,
  type RuleDetailFormValues,
  type SqlTemplateFormValues,
} from '@/hooks/knowledgeRuleSqlManagerUtils';

export const buildSqlTemplateEditorValues = ({
  sqlPair,
  draftValues,
}: {
  sqlPair?: SqlPair;
  draftValues?: Partial<SqlTemplateFormValues>;
}): SqlTemplateFormValues => ({
  ...EMPTY_SQL_TEMPLATE_VALUES,
  ...(sqlPair ? buildSqlTemplateFormValues(sqlPair) : null),
  ...(draftValues || null),
});

export const buildRuleEditorValues = ({
  instruction,
  draftValues,
}: {
  instruction?: Instruction;
  draftValues?: Partial<RuleDetailFormValues>;
}): RuleDetailFormValues => ({
  ...EMPTY_RULE_EDITOR_VALUES,
  ...(instruction ? parseInstructionDraft(instruction) : null),
  ...(draftValues || null),
});

import { useMemo } from 'react';
import { Form, Input, Radio } from 'antd';

import { WorkbenchEditorForm } from '@/features/knowledgePage/index.styles';
import useAuthSession from '@/hooks/useAuthSession';
import { isWorkspaceOwnerEquivalentRole } from '@/utils/workspaceGovernance';

type KnowledgeSqlTemplateFormFieldsProps = {
  isReadonly: boolean;
  sqlTemplateForm: any;
};

export default function KnowledgeSqlTemplateFormFields({
  isReadonly,
  sqlTemplateForm,
}: KnowledgeSqlTemplateFormFieldsProps) {
  const { data: authSession } = useAuthSession({ includeWorkspaceQuery: true });
  const canManageBusinessTemplate = useMemo(
    () =>
      Boolean(
        authSession?.user?.isPlatformAdmin ||
        (authSession?.authorization?.actor?.workspaceRoleKeys || []).some(
          (roleKey) => isWorkspaceOwnerEquivalentRole(roleKey),
        ) ||
        isWorkspaceOwnerEquivalentRole(authSession?.membership?.roleKey),
      ),
    [
      authSession?.authorization?.actor?.workspaceRoleKeys,
      authSession?.membership?.roleKey,
      authSession?.user?.isPlatformAdmin,
    ],
  );

  return (
    <WorkbenchEditorForm form={sqlTemplateForm} layout="vertical">
      <Form.Item
        label="模板名称 / 典型问法"
        name="description"
        rules={[{ required: true, message: '请输入模板名称或典型问法' }]}
      >
        <Input disabled={isReadonly} placeholder="例如：最近 30 天 GMV 趋势" />
      </Form.Item>
      <Form.Item
        label="模板用途"
        name="templateMode"
        initialValue="reference"
        tooltip="业务口径会作为 L2 锚定模板使用，系统会尽量保持 SQL 骨架不被改写。"
        extra={
          canManageBusinessTemplate
            ? null
            : '仅工作空间所有者或管理员可以标记为业务口径，普通成员默认保存为参考样例。'
        }
      >
        <Radio.Group
          disabled={isReadonly}
          options={[
            { label: '参考样例', value: 'reference' },
            {
              label: '业务口径',
              value: 'business',
              disabled: !canManageBusinessTemplate,
            },
          ]}
          optionType="button"
          buttonStyle="solid"
        />
      </Form.Item>
      <Form.Item
        label="SQL 代码"
        name="sql"
        rules={[{ required: true, message: '请输入 SQL 语句' }]}
      >
        <Input.TextArea
          disabled={isReadonly}
          rows={14}
          placeholder="请输入可复用的 SQL 示例，建议优先沉淀稳定口径。"
        />
      </Form.Item>
    </WorkbenchEditorForm>
  );
}

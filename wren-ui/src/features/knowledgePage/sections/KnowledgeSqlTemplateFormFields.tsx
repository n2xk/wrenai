import { useMemo } from 'react';
import { Collapse, Form, Input, Radio } from 'antd';

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
  const governedTemplateExtra = canManageBusinessTemplate
    ? '可执行模板需要完整必填参数、稳定场景和回归验证；普通参考场景建议使用“参考样例 / 可信参考”。'
    : '仅工作空间所有者或管理员可以保存锚定模板 / 可执行模板，普通成员默认保存为参考样例。';

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
        label="模板类型"
        name="templateMode"
        initialValue="reference"
        tooltip="参考样例只作为生成参考；锚定模板会尽量保持 SQL 骨架；可执行模板用于参数完整、场景固定的严格报表模板。"
        extra={governedTemplateExtra}
      >
        <Radio.Group
          disabled={isReadonly}
          options={[
            { label: '参考样例', value: 'reference' },
            { label: '可信参考', value: 'trusted_reference' },
            {
              label: '业务口径',
              value: 'anchored_template',
              disabled: !canManageBusinessTemplate,
            },
            {
              label: '可执行模板',
              value: 'executable_template',
              disabled: !canManageBusinessTemplate,
            },
          ]}
          optionType="button"
          buttonStyle="solid"
        />
      </Form.Item>
      <Form.Item
        label="适用场景"
        name="positiveScenariosText"
        tooltip="每行一个场景或关键词，会写入 businessSignature.positiveCues，用于提升正确模板的匹配置信度。"
      >
        <Input.TextArea
          disabled={isReadonly}
          rows={3}
          placeholder={`例如：
渠道日基础汇总
渠道维度转化漏斗
固定统计周期报表`}
        />
      </Form.Item>
      <Form.Item
        label="不适用场景"
        name="negativeScenariosText"
        tooltip="每行一个排除场景或关键词，会写入 businessSignature.negativeCues，避免相似但语义不同的问题误命中模板。"
      >
        <Input.TextArea
          disabled={isReadonly}
          rows={3}
          placeholder={`例如：
单玩家充值明细
登录未充值用户
非渠道粒度汇总`}
        />
      </Form.Item>
      <Form.Item
        label="必填参数"
        name="requiredSlotsText"
        tooltip="每行一个参数名，会写入 parameterSchema.required；参数缺失时 runtime 会降级或追问，不应硬套模板。"
      >
        <Input.TextArea
          disabled={isReadonly}
          rows={2}
          placeholder={`例如：
tenant_plat_id
start_date
end_date`}
        />
      </Form.Item>
      <Form.Item
        label="结果粒度"
        name="expectedGrain"
        tooltip="写入 businessSignature.expectedGrain。P0 先用于展示和导入契约，后续 SemanticPlan 会用于结构化粒度校验。"
      >
        <Input
          disabled={isReadonly}
          placeholder="例如：biz_date + channel_id"
        />
      </Form.Item>
      <Form.Item
        label="外部数据依赖"
        name="externalDependenciesText"
        tooltip="每行一个依赖 ID，会写入 businessSignature.externalDependencies；依赖缺失时 runtime 会阻断并提示补充数据。"
      >
        <Input.TextArea
          disabled={isReadonly}
          rows={2}
          placeholder={`例如：
ad_spend
channel_mapping`}
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
      <Collapse
        ghost
        size="small"
        items={[
          {
            key: 'advanced',
            label: '高级配置 JSON（可选）',
            children: (
              <>
                <Form.Item
                  label="parameter_schema（JSON）"
                  name="parameterSchemaJson"
                  tooltip="高级参数配置。简单字段里的“必填参数”会覆盖 required。"
                >
                  <Input.TextArea
                    disabled={isReadonly}
                    rows={5}
                    placeholder={`{
  "required": ["tenant_plat_id", "start_date", "end_date"]
}`}
                  />
                </Form.Item>
                <Form.Item
                  label="business_signature（JSON）"
                  name="businessSignatureJson"
                  tooltip="高级业务签名。简单字段会覆盖 expectedGrain / positiveCues / negativeCues / externalDependencies。"
                >
                  <Input.TextArea
                    disabled={isReadonly}
                    rows={8}
                    placeholder={`{
  "concepts": ["first_deposit"],
  "features": ["cohort"],
  "metrics": [],
  "dimensions": [],
  "externalDependencies": [],
  "positiveCues": [],
  "negativeCues": [],
  "expectedGrain": "biz_date + channel_id"
}`}
                  />
                </Form.Item>
              </>
            ),
          },
        ]}
      />
    </WorkbenchEditorForm>
  );
}

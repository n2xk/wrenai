import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Drawer,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';

import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import type {
  CreateExternalDependencyInput,
  ExternalDependency,
} from '@/types/knowledge';
import { appMessage as message } from '@/utils/antdAppBridge';
import {
  createKnowledgeExternalDependency,
  deleteKnowledgeExternalDependency,
  listKnowledgeExternalDependencies,
  updateKnowledgeExternalDependency,
} from '@/utils/knowledgeRuleSqlRest';
import { hasKnowledgeRuleSqlScope } from '@/hooks/useKnowledgeRuleSqlActions';

import { WorkbenchSectionPanel } from '@/features/knowledgePage/index.styles';

const { Text } = Typography;

const parseTextList = (value?: string) =>
  Array.from(
    new Set(
      (value || '')
        .split(/[\n,，]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );

const formatTextList = (value?: string[]) => (value || []).join('\n');

const parseJsonObject = (value?: string) => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('validation 必须是 JSON object');
  }
  return parsed as Record<string, any>;
};

type ExternalDependencyFormValues = {
  dependencyId: string;
  name: string;
  aliasesText?: string;
  sourceStatus: string;
  missingBehavior: string;
  requiredGrainText?: string;
  requiredByTermsText?: string;
  requiredByTemplatesText?: string;
  relatedRulesText?: string;
  askUserPrompt?: string;
  validationJson?: string;
  status: string;
};

const toFormValues = (
  dependency?: ExternalDependency | null,
): Partial<ExternalDependencyFormValues> => ({
  dependencyId: dependency?.dependencyId || '',
  name: dependency?.name || '',
  aliasesText: formatTextList(dependency?.aliases),
  sourceStatus: dependency?.sourceStatus || 'missing',
  missingBehavior: dependency?.missingBehavior || 'ask_user',
  requiredGrainText: formatTextList(dependency?.requiredGrain),
  requiredByTermsText: formatTextList(dependency?.requiredByTerms),
  requiredByTemplatesText: formatTextList(dependency?.requiredByTemplates),
  relatedRulesText: formatTextList(dependency?.relatedRules),
  askUserPrompt: dependency?.askUserPrompt || '',
  validationJson: dependency?.validation
    ? JSON.stringify(dependency.validation, null, 2)
    : '',
  status: dependency?.status || 'active',
});

const toPayload = (
  values: ExternalDependencyFormValues,
): CreateExternalDependencyInput => ({
  dependencyId: values.dependencyId.trim(),
  name: values.name.trim(),
  aliases: parseTextList(values.aliasesText),
  sourceStatus: values.sourceStatus || 'missing',
  missingBehavior: values.missingBehavior || 'ask_user',
  requiredGrain: parseTextList(values.requiredGrainText),
  requiredByTerms: parseTextList(values.requiredByTermsText),
  requiredByTemplates: parseTextList(values.requiredByTemplatesText),
  relatedRules: parseTextList(values.relatedRulesText),
  askUserPrompt: values.askUserPrompt?.trim() || null,
  validation: parseJsonObject(values.validationJson),
  status: values.status || 'active',
});

export type KnowledgeExternalDependenciesStageProps = {
  isKnowledgeMutationDisabled: boolean;
  runtimeSelector: ClientRuntimeScopeSelector;
};

export default function KnowledgeExternalDependenciesStage({
  isKnowledgeMutationDisabled,
  runtimeSelector,
}: KnowledgeExternalDependenciesStageProps) {
  const [form] = Form.useForm<ExternalDependencyFormValues>();
  const [dependencies, setDependencies] = useState<ExternalDependency[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingDependency, setEditingDependency] =
    useState<ExternalDependency | null>(null);

  const canLoad = hasKnowledgeRuleSqlScope(runtimeSelector);

  const loadDependencies = useCallback(async () => {
    if (!canLoad) {
      setDependencies([]);
      return;
    }
    setLoading(true);
    try {
      setDependencies(await listKnowledgeExternalDependencies(runtimeSelector));
    } catch (error: any) {
      message.error(error?.message || '加载外部数据依赖失败，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }, [canLoad, runtimeSelector]);

  useEffect(() => {
    void loadDependencies();
  }, [loadDependencies]);

  const openDrawer = useCallback(
    (dependency?: ExternalDependency) => {
      setEditingDependency(dependency || null);
      form.setFieldsValue(toFormValues(dependency));
      setDrawerOpen(true);
    },
    [form],
  );

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    setEditingDependency(null);
    form.resetFields();
  }, [form]);

  const handleSubmit = useCallback(async () => {
    const values = await form.validateFields();
    let payload: CreateExternalDependencyInput;
    try {
      payload = toPayload(values);
    } catch (error: any) {
      message.error(error?.message || 'validation JSON 格式不正确');
      return;
    }
    setSaving(true);
    try {
      if (editingDependency) {
        await updateKnowledgeExternalDependency(
          runtimeSelector,
          editingDependency.id,
          payload,
        );
        message.success('已更新外部数据依赖');
      } else {
        await createKnowledgeExternalDependency(runtimeSelector, payload);
        message.success('已创建外部数据依赖');
      }
      await loadDependencies();
      closeDrawer();
    } catch (error: any) {
      message.error(error?.message || '保存外部数据依赖失败，请稍后重试。');
    } finally {
      setSaving(false);
    }
  }, [closeDrawer, editingDependency, form, loadDependencies, runtimeSelector]);

  const handleDelete = useCallback(
    async (dependency: ExternalDependency) => {
      try {
        await deleteKnowledgeExternalDependency(runtimeSelector, dependency.id);
        message.success('已删除外部数据依赖');
        await loadDependencies();
      } catch (error: any) {
        message.error(error?.message || '删除外部数据依赖失败，请稍后重试。');
      }
    },
    [loadDependencies, runtimeSelector],
  );

  const columns = useMemo<ColumnsType<ExternalDependency>>(
    () => [
      {
        title: '名称',
        dataIndex: 'name',
        width: 180,
        render: (_, dependency) => (
          <Space direction="vertical" size={0}>
            <Text strong>{dependency.name}</Text>
            <Text type="secondary">{dependency.dependencyId}</Text>
          </Space>
        ),
      },
      {
        title: '状态',
        dataIndex: 'sourceStatus',
        width: 120,
        render: (value) => (
          <Tag color={value === 'missing' ? 'orange' : 'green'}>{value}</Tag>
        ),
      },
      {
        title: '缺失处理',
        dataIndex: 'missingBehavior',
        width: 140,
      },
      {
        title: '关联业务概念',
        dataIndex: 'requiredByTerms',
        render: (items: string[]) =>
          (items || []).slice(0, 5).map((item) => <Tag key={item}>{item}</Tag>),
      },
      {
        title: '关联模板',
        dataIndex: 'requiredByTemplates',
        width: 140,
        render: (items: string[]) => (items || []).join(', '),
      },
      {
        title: '操作',
        width: 160,
        render: (_, dependency) => (
          <Space>
            <Button type="link" onClick={() => openDrawer(dependency)}>
              编辑
            </Button>
            {!isKnowledgeMutationDisabled ? (
              <Popconfirm
                title="确认删除该外部依赖？"
                onConfirm={() => handleDelete(dependency)}
              >
                <Button danger type="link">
                  删除
                </Button>
              </Popconfirm>
            ) : null}
          </Space>
        ),
      },
    ],
    [handleDelete, isKnowledgeMutationDisabled, openDrawer],
  );

  return (
    <WorkbenchSectionPanel>
      <Space
        style={{
          width: '100%',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <div>
          <Text strong>外部数据依赖</Text>
          <br />
          <Text type="secondary">
            声明系统没有内置数据源的指标，并配置缺失时的追问或阻塞策略。
          </Text>
        </div>
        <Button
          type="primary"
          disabled={isKnowledgeMutationDisabled || !canLoad}
          onClick={() => openDrawer()}
        >
          新建外部依赖
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={dependencies}
        columns={columns}
        pagination={{ pageSize: 10 }}
      />
      <Drawer
        width={640}
        title={editingDependency ? '编辑外部数据依赖' : '新建外部数据依赖'}
        open={drawerOpen}
        onClose={closeDrawer}
        extra={
          <Space>
            <Button onClick={closeDrawer}>取消</Button>
            <Button
              type="primary"
              loading={saving}
              disabled={isKnowledgeMutationDisabled}
              onClick={() => void handleSubmit()}
            >
              保存
            </Button>
          </Space>
        }
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            sourceStatus: 'missing',
            missingBehavior: 'ask_user',
            status: 'active',
          }}
        >
          <Form.Item
            label="依赖 ID"
            name="dependencyId"
            rules={[{ required: true, message: '请输入依赖 ID' }]}
          >
            <Input
              disabled={
                isKnowledgeMutationDisabled || Boolean(editingDependency)
              }
              placeholder="ad_spend"
            />
          </Form.Item>
          <Form.Item
            label="名称"
            name="name"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input
              disabled={isKnowledgeMutationDisabled}
              placeholder="投放金额"
            />
          </Form.Item>
          <Form.Item label="同义词（逗号或换行分隔）" name="aliasesText">
            <Input.TextArea disabled={isKnowledgeMutationDisabled} rows={3} />
          </Form.Item>
          <Form.Item label="source_status" name="sourceStatus">
            <Select
              disabled={isKnowledgeMutationDisabled}
              options={[
                { label: 'missing', value: 'missing' },
                { label: 'available', value: 'available' },
                { label: 'partial', value: 'partial' },
                { label: 'manual_input', value: 'manual_input' },
              ]}
            />
          </Form.Item>
          <Form.Item label="missing_behavior" name="missingBehavior">
            <Select
              disabled={isKnowledgeMutationDisabled}
              options={[
                { label: 'ask_user', value: 'ask_user' },
                { label: 'block_answer', value: 'block_answer' },
                {
                  label: 'allow_partial_answer',
                  value: 'allow_partial_answer',
                },
              ]}
            />
          </Form.Item>
          <Form.Item label="所需粒度" name="requiredGrainText">
            <Input.TextArea
              disabled={isKnowledgeMutationDisabled}
              rows={2}
              placeholder="biz_date + channel_id"
            />
          </Form.Item>
          <Form.Item label="依赖业务概念 ID" name="requiredByTermsText">
            <Input.TextArea
              disabled={isKnowledgeMutationDisabled}
              rows={2}
              placeholder="roi"
            />
          </Form.Item>
          <Form.Item label="依赖 SQL 模板 ID" name="requiredByTemplatesText">
            <Input.TextArea
              disabled={isKnowledgeMutationDisabled}
              rows={2}
              placeholder="T05"
            />
          </Form.Item>
          <Form.Item label="关联分析规则 ID" name="relatedRulesText">
            <Input.TextArea
              disabled={isKnowledgeMutationDisabled}
              rows={2}
              placeholder="R13"
            />
          </Form.Item>
          <Form.Item label="缺失时追问话术" name="askUserPrompt">
            <Input.TextArea disabled={isKnowledgeMutationDisabled} rows={3} />
          </Form.Item>
          <Form.Item label="validation JSON" name="validationJson">
            <Input.TextArea
              disabled={isKnowledgeMutationDisabled}
              rows={5}
              placeholder={'{\n  "value_type": "number",\n  "min": 0\n}'}
            />
          </Form.Item>
          <Form.Item label="状态" name="status">
            <Select
              disabled={isKnowledgeMutationDisabled}
              options={[
                { label: 'active', value: 'active' },
                { label: 'draft', value: 'draft' },
                { label: 'deprecated', value: 'deprecated' },
              ]}
            />
          </Form.Item>
        </Form>
      </Drawer>
    </WorkbenchSectionPanel>
  );
}

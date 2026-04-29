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
import type { BusinessTerm, CreateBusinessTermInput } from '@/types/knowledge';
import { appMessage as message } from '@/utils/antdAppBridge';
import {
  createKnowledgeBusinessTerm,
  deleteKnowledgeBusinessTerm,
  listKnowledgeBusinessTerms,
  updateKnowledgeBusinessTerm,
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

type BusinessTermFormValues = {
  termId: string;
  name: string;
  category: string;
  aliasesText?: string;
  definition?: string;
  canonicalExpression?: string;
  sourceTablesText?: string;
  sourceFieldsText?: string;
  relatedRulesText?: string;
  relatedTemplatesText?: string;
  featuresText?: string;
  conflictTermsText?: string;
  status: string;
};

const toFormValues = (
  term?: BusinessTerm | null,
): Partial<BusinessTermFormValues> => ({
  termId: term?.termId || '',
  name: term?.name || '',
  category: term?.category || 'metric',
  aliasesText: formatTextList(term?.aliases),
  definition: term?.definition || '',
  canonicalExpression: term?.canonicalExpression || '',
  sourceTablesText: formatTextList(term?.sourceTables),
  sourceFieldsText: formatTextList(term?.sourceFields),
  relatedRulesText: formatTextList(term?.relatedRules),
  relatedTemplatesText: formatTextList(term?.relatedTemplates),
  featuresText: formatTextList(term?.features),
  conflictTermsText: formatTextList(term?.conflictTerms),
  status: term?.status || 'active',
});

const toPayload = (
  values: BusinessTermFormValues,
): CreateBusinessTermInput => ({
  termId: values.termId.trim(),
  name: values.name.trim(),
  category: values.category || 'metric',
  aliases: parseTextList(values.aliasesText),
  definition: values.definition?.trim() || '',
  canonicalExpression: values.canonicalExpression?.trim() || null,
  sourceTables: parseTextList(values.sourceTablesText),
  sourceFields: parseTextList(values.sourceFieldsText),
  relatedRules: parseTextList(values.relatedRulesText),
  relatedTemplates: parseTextList(values.relatedTemplatesText),
  features: parseTextList(values.featuresText),
  conflictTerms: parseTextList(values.conflictTermsText),
  status: values.status || 'active',
});

export type KnowledgeBusinessTermsStageProps = {
  isKnowledgeMutationDisabled: boolean;
  runtimeSelector: ClientRuntimeScopeSelector;
};

export default function KnowledgeBusinessTermsStage({
  isKnowledgeMutationDisabled,
  runtimeSelector,
}: KnowledgeBusinessTermsStageProps) {
  const [form] = Form.useForm<BusinessTermFormValues>();
  const [terms, setTerms] = useState<BusinessTerm[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingTerm, setEditingTerm] = useState<BusinessTerm | null>(null);

  const canLoad = hasKnowledgeRuleSqlScope(runtimeSelector);

  const loadTerms = useCallback(async () => {
    if (!canLoad) {
      setTerms([]);
      return;
    }
    setLoading(true);
    try {
      setTerms(await listKnowledgeBusinessTerms(runtimeSelector));
    } catch (error: any) {
      message.error(error?.message || '加载业务词典失败，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }, [canLoad, runtimeSelector]);

  useEffect(() => {
    void loadTerms();
  }, [loadTerms]);

  const openDrawer = useCallback(
    (term?: BusinessTerm) => {
      if (!term && isKnowledgeMutationDisabled) {
        message.info('当前知识库为只读状态，不支持新建业务词。');
        return;
      }
      setEditingTerm(term || null);
      form.setFieldsValue(toFormValues(term));
      setDrawerOpen(true);
    },
    [form, isKnowledgeMutationDisabled],
  );

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    setEditingTerm(null);
    form.resetFields();
  }, [form]);

  const handleSubmit = useCallback(async () => {
    if (isKnowledgeMutationDisabled) {
      message.info('当前知识库为只读状态，不支持保存业务词。');
      return;
    }
    const values = await form.validateFields();
    const payload = toPayload(values);
    setSaving(true);
    try {
      if (editingTerm) {
        await updateKnowledgeBusinessTerm(
          runtimeSelector,
          editingTerm.id,
          payload,
        );
        message.success('已更新业务词典');
      } else {
        await createKnowledgeBusinessTerm(runtimeSelector, payload);
        message.success('已创建业务词典');
      }
      await loadTerms();
      closeDrawer();
    } catch (error: any) {
      message.error(error?.message || '保存业务词典失败，请稍后重试。');
    } finally {
      setSaving(false);
    }
  }, [
    closeDrawer,
    editingTerm,
    form,
    isKnowledgeMutationDisabled,
    loadTerms,
    runtimeSelector,
  ]);

  const handleDelete = useCallback(
    async (term: BusinessTerm) => {
      if (isKnowledgeMutationDisabled) {
        message.info('当前知识库为只读状态，不支持删除业务词。');
        return;
      }
      try {
        await deleteKnowledgeBusinessTerm(runtimeSelector, term.id);
        message.success('已删除业务词典');
        await loadTerms();
      } catch (error: any) {
        message.error(error?.message || '删除业务词典失败，请稍后重试。');
      }
    },
    [isKnowledgeMutationDisabled, loadTerms, runtimeSelector],
  );

  const columns = useMemo<ColumnsType<BusinessTerm>>(
    () => [
      {
        title: '名称',
        dataIndex: 'name',
        width: 180,
        render: (_, term) => (
          <Space direction="vertical" size={0}>
            <Text strong>{term.name}</Text>
            <Text type="secondary">{term.termId}</Text>
          </Space>
        ),
      },
      {
        title: '类型',
        dataIndex: 'category',
        width: 110,
        render: (value) => <Tag>{value}</Tag>,
      },
      {
        title: '同义词',
        dataIndex: 'aliases',
        render: (aliases: string[]) =>
          (aliases || [])
            .slice(0, 4)
            .map((item) => <Tag key={item}>{item}</Tag>),
      },
      {
        title: '关联',
        width: 180,
        render: (_, term) =>
          `规则 ${term.relatedRules.length} / 模板 ${term.relatedTemplates.length}`,
      },
      {
        title: '状态',
        dataIndex: 'status',
        width: 100,
      },
      {
        title: '操作',
        width: 160,
        render: (_, term) => (
          <Space>
            <Button type="link" onClick={() => openDrawer(term)}>
              {isKnowledgeMutationDisabled ? '查看' : '编辑'}
            </Button>
            {!isKnowledgeMutationDisabled ? (
              <Popconfirm
                title="确认删除该业务词？"
                onConfirm={() => handleDelete(term)}
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
          <Text strong>业务词典</Text>
          <br />
          <Text type="secondary">
            维护业务概念、同义词、关联规则与模板，驱动问数理解和模板匹配。
          </Text>
        </div>
        {isKnowledgeMutationDisabled ? (
          <Text type="secondary">
            当前知识库只读，可查看已预置业务词，不支持新建或编辑。
          </Text>
        ) : (
          <Button
            type="primary"
            disabled={!canLoad}
            onClick={() => openDrawer()}
          >
            新建业务词
          </Button>
        )}
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={terms}
        columns={columns}
        pagination={{ pageSize: 10 }}
      />
      <Drawer
        size="large"
        title={
          isKnowledgeMutationDisabled
            ? '查看业务词典'
            : editingTerm
              ? '编辑业务词典'
              : '新建业务词典'
        }
        open={drawerOpen}
        onClose={closeDrawer}
        extra={
          isKnowledgeMutationDisabled ? (
            <Button onClick={closeDrawer}>关闭</Button>
          ) : (
            <Space>
              <Button onClick={closeDrawer}>取消</Button>
              <Button
                type="primary"
                loading={saving}
                onClick={() => void handleSubmit()}
              >
                保存
              </Button>
            </Space>
          )
        }
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ category: 'metric', status: 'active' }}
        >
          <Form.Item
            label="业务词 ID"
            name="termId"
            rules={[{ required: true, message: '请输入业务词 ID' }]}
          >
            <Input
              disabled={isKnowledgeMutationDisabled || Boolean(editingTerm)}
              placeholder="first_deposit"
            />
          </Form.Item>
          <Form.Item
            label="名称"
            name="name"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input disabled={isKnowledgeMutationDisabled} placeholder="首存" />
          </Form.Item>
          <Form.Item label="类型" name="category">
            <Select
              disabled={isKnowledgeMutationDisabled}
              options={[
                { label: '指标 metric', value: 'metric' },
                { label: '维度 dimension', value: 'dimension' },
                { label: '分层 segment', value: 'segment' },
                { label: '公式 formula', value: 'formula' },
                { label: '事件 event', value: 'event' },
                {
                  label: '业务流程 business_process',
                  value: 'business_process',
                },
              ]}
            />
          </Form.Item>
          <Form.Item label="同义词（逗号或换行分隔）" name="aliasesText">
            <Input.TextArea disabled={isKnowledgeMutationDisabled} rows={3} />
          </Form.Item>
          <Form.Item label="定义" name="definition">
            <Input.TextArea disabled={isKnowledgeMutationDisabled} rows={3} />
          </Form.Item>
          <Form.Item label="规范表达式" name="canonicalExpression">
            <Input.TextArea disabled={isKnowledgeMutationDisabled} rows={3} />
          </Form.Item>
          <Form.Item label="来源表" name="sourceTablesText">
            <Input.TextArea disabled={isKnowledgeMutationDisabled} rows={2} />
          </Form.Item>
          <Form.Item label="来源字段" name="sourceFieldsText">
            <Input.TextArea disabled={isKnowledgeMutationDisabled} rows={2} />
          </Form.Item>
          <Form.Item label="关联分析规则 ID" name="relatedRulesText">
            <Input.TextArea
              disabled={isKnowledgeMutationDisabled}
              rows={2}
              placeholder="R02"
            />
          </Form.Item>
          <Form.Item label="关联 SQL 模板 ID" name="relatedTemplatesText">
            <Input.TextArea
              disabled={isKnowledgeMutationDisabled}
              rows={2}
              placeholder="T03"
            />
          </Form.Item>
          <Form.Item label="业务特征" name="featuresText">
            <Input.TextArea
              disabled={isKnowledgeMutationDisabled}
              rows={2}
              placeholder="cohort"
            />
          </Form.Item>
          <Form.Item label="易混淆概念" name="conflictTermsText">
            <Input.TextArea disabled={isKnowledgeMutationDisabled} rows={2} />
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

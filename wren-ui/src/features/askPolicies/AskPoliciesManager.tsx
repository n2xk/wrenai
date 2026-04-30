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
import type { TableColumnsType } from 'antd';
import PlusOutlined from '@ant-design/icons/PlusOutlined';

import { WorkbenchSectionPanel } from '@/features/knowledgePage/index.styles';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import { buildRuntimeScopeUrl } from '@/runtime/client/runtimeScope';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import { getAbsoluteTime } from '@/utils/time';
import { appMessage as message } from '@/utils/antdAppBridge';

type AskPolicyRule = {
  id: number;
  name: string;
  status: 'active' | 'disabled';
  version: number;
  workspaceId: string;
  knowledgeBaseId?: string | null;
  queryContainsAny: string[];
  templateIds: string[];
  forbiddenTemplates: string[];
  requiredSlots: string[];
  reasonCode: string;
  description?: string | null;
  updatedAt?: string | null;
};

type AskPolicyRuleFormValues = {
  name: string;
  status: 'active' | 'disabled';
  queryContainsAny?: string[];
  templateIds?: string[];
  forbiddenTemplates?: string[];
  requiredSlots?: string[];
  reasonCode?: string;
  description?: string;
};

type AskPoliciesManagerProps = {
  runtimeScopeSelector: ClientRuntimeScopeSelector;
  hasRuntimeScope: boolean;
  routerReady?: boolean;
  embedded?: boolean;
  mutationDisabled?: boolean;
  mutationDisabledHint?: string | null;
  title?: string;
  description?: string;
};

const policyManagerStyles = `
  .ask-policy-manager {
    width: 100%;
  }

  .ask-policy-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 18px;
  }

  .ask-policy-manager--embedded .ask-policy-toolbar {
    margin-bottom: 14px;
  }

  .ask-policy-table.console-table .ant-table-thead > tr > th {
    background: #f7f9fc;
    color: #475467;
    font-size: 13px;
    font-weight: 600;
    padding: 14px 16px;
  }

  .ask-policy-table.console-table .ant-table-tbody > tr > td {
    padding: 16px;
    vertical-align: top;
  }

  .ask-policy-name-row,
  .ask-policy-action-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .ask-policy-name {
    max-width: 220px;
    color: #1f2937;
    font-size: 14px;
    font-weight: 600;
    line-height: 20px;
  }

  .ask-policy-reason {
    display: block;
    max-width: 280px;
    color: #98a2b3;
    font-size: 12px;
    line-height: 18px;
  }

  .ask-policy-chip-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    min-width: 0;
  }

  .ask-policy-chip-list--nowrap {
    flex-wrap: nowrap;
    overflow: hidden;
  }

  .ask-policy-tag.ant-tag {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    margin-inline-end: 0;
    border-color: rgba(91, 75, 219, 0.12);
    background: rgba(91, 75, 219, 0.06);
    color: #5b4bdb;
    font-weight: 500;
  }

  .ask-policy-tag .ant-tag-content {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ask-policy-status.ant-tag {
    margin-inline-end: 0;
    border-radius: 999px;
    font-size: 12px;
    line-height: 20px;
  }

  .ask-policy-empty-value {
    color: #98a2b3;
    font-size: 13px;
  }

  .ask-policy-updated-at {
    color: #667085;
    font-size: 13px;
    white-space: nowrap;
  }

  .ask-policy-action-row {
    gap: 4px;
  }

  .ask-policy-action-row .ant-btn {
    height: 28px;
    padding: 0 6px;
  }
`;

const toArray = (value?: string[] | null) =>
  Array.isArray(value) ? value.filter(Boolean) : [];

const renderTagList = (
  values?: string[] | null,
  empty = '未配置',
  options: { nowrap?: boolean } = {},
) => {
  const items = toArray(values);
  if (!items.length) {
    return <span className="ask-policy-empty-value">{empty}</span>;
  }

  return (
    <div
      className={`ask-policy-chip-list${
        options.nowrap ? ' ask-policy-chip-list--nowrap' : ''
      }`}
    >
      {items.map((item) => (
        <Tag className="ask-policy-tag" key={item} title={item}>
          {item}
        </Tag>
      ))}
    </div>
  );
};

export default function AskPoliciesManager({
  runtimeScopeSelector,
  hasRuntimeScope,
  routerReady = true,
  embedded = false,
  mutationDisabled = false,
  mutationDisabledHint,
  title = '问数策略',
  description = '用可版本化的策略约束模板采纳、必填业务槽位和问数路由。',
}: AskPoliciesManagerProps) {
  const [form] = Form.useForm<AskPolicyRuleFormValues>();
  const [items, setItems] = useState<AskPolicyRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingRule, setEditingRule] = useState<AskPolicyRule | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const listUrl = useMemo(
    () =>
      buildRuntimeScopeUrl(
        '/api/v1/ask-policy-rules',
        {},
        runtimeScopeSelector,
      ),
    [runtimeScopeSelector],
  );

  const loadRules = useCallback(async () => {
    if (!hasRuntimeScope || !routerReady) {
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(listUrl, {
        credentials: 'include',
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || '加载问数策略失败，请稍后重试。');
      }
      setItems(Array.isArray(payload?.items) ? payload.items : []);
    } catch (error) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '加载问数策略失败，请稍后重试。',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  }, [hasRuntimeScope, listUrl, routerReady]);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  const openCreateDrawer = () => {
    if (mutationDisabled) {
      if (mutationDisabledHint) {
        message.info(mutationDisabledHint);
      }
      return;
    }

    setEditingRule(null);
    form.setFieldsValue({
      name: '',
      status: 'active',
      queryContainsAny: [],
      templateIds: [],
      forbiddenTemplates: [],
      requiredSlots: [],
      reasonCode: '',
      description: '',
    });
    setDrawerOpen(true);
  };

  const openEditDrawer = (rule: AskPolicyRule) => {
    if (mutationDisabled) {
      if (mutationDisabledHint) {
        message.info(mutationDisabledHint);
      }
      return;
    }

    setEditingRule(rule);
    form.setFieldsValue({
      name: rule.name,
      status: rule.status,
      queryContainsAny: toArray(rule.queryContainsAny),
      templateIds: toArray(rule.templateIds),
      forbiddenTemplates: toArray(rule.forbiddenTemplates),
      requiredSlots: toArray(rule.requiredSlots),
      reasonCode: rule.reasonCode,
      description: rule.description || '',
    });
    setDrawerOpen(true);
  };

  const saveRule = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const response = await fetch(
        editingRule
          ? buildRuntimeScopeUrl(
              `/api/v1/ask-policy-rules/${editingRule.id}`,
              {},
              runtimeScopeSelector,
            )
          : listUrl,
        {
          method: editingRule ? 'PATCH' : 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...values,
            scope: 'knowledge_base',
          }),
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || '保存问数策略失败，请稍后重试。');
      }
      message.success('问数策略已保存');
      setDrawerOpen(false);
      await loadRules();
    } catch (error) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '保存问数策略失败，请稍后重试。',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteRule = async (rule: AskPolicyRule) => {
    const response = await fetch(
      buildRuntimeScopeUrl(
        `/api/v1/ask-policy-rules/${rule.id}`,
        {},
        runtimeScopeSelector,
      ),
      { method: 'DELETE', credentials: 'include' },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error || '删除问数策略失败，请稍后重试。');
    }
    message.success('问数策略已删除');
    await loadRules();
  };

  const columns: TableColumnsType<AskPolicyRule> = [
    {
      title: '策略',
      dataIndex: 'name',
      key: 'name',
      width: 330,
      render: (_value, record) => (
        <Space orientation="vertical" size={4}>
          <div className="ask-policy-name-row">
            <Typography.Text
              className="ask-policy-name"
              ellipsis={{ tooltip: record.name }}
            >
              {record.name}
            </Typography.Text>
            <Tag
              className="ask-policy-status"
              color={record.status === 'active' ? 'green' : 'default'}
            >
              {record.status === 'active' ? '启用' : '停用'}
            </Tag>
          </div>
          <Typography.Text
            className="ask-policy-reason"
            ellipsis={{ tooltip: record.reasonCode }}
          >
            {record.reasonCode}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '触发词',
      dataIndex: 'queryContainsAny',
      key: 'queryContainsAny',
      width: 180,
      render: (values) => renderTagList(values, '未配置', { nowrap: true }),
    },
    {
      title: '禁用模板',
      dataIndex: 'forbiddenTemplates',
      key: 'forbiddenTemplates',
      render: (values) => renderTagList(values, '不限制'),
    },
    {
      title: '必填槽位',
      dataIndex: 'requiredSlots',
      key: 'requiredSlots',
      render: (values) => renderTagList(values, '不要求'),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 180,
      render: (value) => (
        <span className="ask-policy-updated-at">
          {value ? getAbsoluteTime(value) : '-'}
        </span>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      render: (_value, record) => {
        return (
          <div className="ask-policy-action-row">
            <Button
              type="text"
              size="small"
              disabled={mutationDisabled}
              onClick={() => openEditDrawer(record)}
            >
              编辑
            </Button>
            <Popconfirm
              title="删除问数策略？"
              description="删除后后续问数不会再注入该策略。"
              onConfirm={() =>
                deleteRule(record).catch((error) =>
                  message.error(error.message || '删除问数策略失败'),
                )
              }
              disabled={mutationDisabled}
            >
              <Button
                type="text"
                danger
                size="small"
                disabled={mutationDisabled}
              >
                删除
              </Button>
            </Popconfirm>
          </div>
        );
      },
    },
  ];

  return (
    <WorkbenchSectionPanel
      className={`ask-policy-manager${
        embedded ? ' ask-policy-manager--embedded' : ''
      }`}
    >
      <style jsx global>
        {policyManagerStyles}
      </style>
      <Space orientation="vertical" size={18} style={{ width: '100%' }}>
        <div className="ask-policy-toolbar">
          <Space orientation="vertical" size={2}>
            <Typography.Title
              level={embedded ? 5 : 4}
              style={{ marginBottom: 0 }}
            >
              {title}
            </Typography.Title>
            <Typography.Text type="secondary">{description}</Typography.Text>
          </Space>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={mutationDisabled || !hasRuntimeScope}
            onClick={openCreateDrawer}
          >
            新建策略
          </Button>
        </div>
        <Table
          className="ask-policy-table console-table"
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={items}
          tableLayout="fixed"
          pagination={false}
          locale={{
            emptyText: hasRuntimeScope
              ? '暂无问数策略'
              : '请先选择工作空间和知识库',
          }}
        />
      </Space>

      <Drawer
        title={editingRule ? '编辑问数策略' : '新建问数策略'}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        size="large"
        extra={
          <Space>
            <Button onClick={() => setDrawerOpen(false)}>取消</Button>
            <Button
              type="primary"
              loading={saving}
              onClick={() => void saveRule()}
            >
              保存
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item
            name="name"
            label="策略名称"
            rules={[{ required: true, message: '请输入策略名称' }]}
          >
            <Input placeholder="例如：渠道首充必须补充租户平台" />
          </Form.Item>
          <Space size={12} style={{ width: '100%' }} align="start">
            <Form.Item name="status" label="状态" style={{ width: 180 }}>
              <Select
                options={[
                  { label: '启用', value: 'active' },
                  { label: '停用', value: 'disabled' },
                ]}
              />
            </Form.Item>
          </Space>
          <Form.Item name="queryContainsAny" label="触发词">
            <Select
              mode="tags"
              tokenSeparators={[',', '，']}
              placeholder="输入后回车，例如：渠道、首充"
            />
          </Form.Item>
          <Form.Item name="forbiddenTemplates" label="命中后禁止采用的模板 ID">
            <Select
              mode="tags"
              tokenSeparators={[',', '，']}
              placeholder="例如：T08、sql_pair_123"
            />
          </Form.Item>
          <Form.Item name="requiredSlots" label="必填槽位">
            <Select
              mode="tags"
              tokenSeparators={[',', '，']}
              placeholder="例如：tenant_plat_id、date_range"
            />
          </Form.Item>
          <Form.Item name="reasonCode" label="原因代码">
            <Input placeholder="例如：policy_missing_tenant_for_channel_metric" />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea
              rows={3}
              placeholder="说明策略用途，便于诊断和回归测试定位。"
            />
          </Form.Item>
        </Form>
      </Drawer>
    </WorkbenchSectionPanel>
  );
}

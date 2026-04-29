import { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { Alert, Button, Form, Input, Modal, Radio, Typography } from 'antd';
import InfoCircleOutlined from '@ant-design/icons/InfoCircleOutlined';
import { appMessage as message } from '@/utils/antdAppBridge';
import ErrorCollapse from '@/components/ErrorCollapse';
import SQLEditor from '@/components/editor/SQLEditor';
import PreviewData from '@/components/dataPreview/PreviewData';
import useAuthSession from '@/hooks/useAuthSession';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { ModalAction } from '@/hooks/useModalAction';
import {
  SQL_PAIR_BUSINESS_TEMPLATE_PRESET,
  SQL_PAIR_REFERENCE_PRESET,
  type CreateSqlPairInput,
  type SqlPair,
} from '@/types/knowledge';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import { ERROR_TEXTS } from '@/utils/error';
import { FORM_MODE } from '@/utils/enum';
import { generateKnowledgeSqlPairQuestion } from '@/utils/knowledgeRuleSqlRest';
import {
  previewSql,
  validateSql,
  type SqlPreviewDataResponse,
  type SqlPreviewMode,
} from '@/utils/sqlPreviewRest';
import { createSQLPairQuestionValidator } from '@/utils/validator';
import { isWorkspaceOwnerEquivalentRole } from '@/utils/workspaceGovernance';

type SqlPairModalValue = Partial<SqlPair> & {
  sqlMode?: SqlPreviewMode;
};

type Props = ModalAction<
  SqlPairModalValue,
  {
    data: CreateSqlPairInput;
    id?: number;
  },
  {
    isCreateMode: boolean;
    responseId?: number;
    sqlMode?: SqlPreviewMode;
  }
> & {
  loading?: boolean;
};

type ModalErrorState = {
  message: string;
  shortMessage: string;
  code: string;
  stacktrace?: string[] | string;
} | null;

const StyledForm = styled(Form)`
  .ant-form-item {
    margin-bottom: 14px;
  }

  .adm-question-form-item > div > label {
    width: 100%;
  }

  .ant-form-item-label > label {
    font-size: 13px;
    font-weight: 600;
    color: #4b5563;
  }

  .ant-form-item-extra {
    margin-top: 4px;
    color: #8b95a1;
    font-size: 12px;
    line-height: 1.45;
  }

  .ant-input {
    min-height: 36px;
    border-radius: 10px;
    border-color: #dbe2ea;
    box-shadow: none;
  }

  .ant-radio-button-wrapper {
    height: 30px;
    padding-inline: 12px;
    font-size: 12px;
    line-height: 28px;
  }
`;

const StyledModal = styled(Modal)`
  .ant-modal-content {
    border-radius: 16px;
    overflow: hidden;
    border: 1px solid #e5e7eb;
    box-shadow: 0 20px 56px rgba(15, 23, 42, 0.12);
  }

  .ant-modal-header {
    padding: 16px 20px 14px;
    border-bottom: 1px solid #eef2f7;
  }

  .ant-modal-title {
    font-size: 17px;
    font-weight: 700;
    color: #111827;
  }

  .ant-modal-body {
    max-height: min(70vh, 680px);
    overflow-y: auto;
    padding: 16px 20px 12px;
  }

  .ant-modal-footer {
    margin-top: 0;
    padding: 12px 20px 16px;
    border-top: 1px solid #eef2f7;
  }
`;

const QuestionLabel = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
`;

const QuestionHint = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #7b8491;
  font-size: 12px;
  font-weight: 400;
  white-space: nowrap;
`;

const PreviewPanel = styled.div`
  margin-top: 2px;
  padding-top: 12px;
  border-top: 1px solid #eef2f7;
`;

const PreviewHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
`;

const PreviewTitle = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const PreviewResult = styled.div`
  margin-top: 10px;

  .ant-table {
    font-size: 12px;
  }
`;

const Footer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
`;

const FooterHint = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  max-width: 430px;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.55;
`;

export default function QuestionSQLPairModal(props: Props) {
  const {
    defaultValue,
    formMode,
    loading,
    onClose,
    onSubmit,
    visible,
    payload,
  } = props;

  // pass payload?.isCreateMode to prevent formMode from being set to Update when passing defaultValue, for the 'Add a SQL pair from an existing answer' scenario use.
  const isCreateMode = formMode === FORM_MODE.CREATE || payload?.isCreateMode;
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const { data: authSession } = useAuthSession({ includeWorkspaceQuery: true });

  const [form] = Form.useForm();
  const [error, setError] = useState<ModalErrorState>(null);
  const [previewing, setPreviewing] = useState<boolean>(false);
  const [previewData, setPreviewData] = useState<
    SqlPreviewDataResponse | undefined
  >(undefined);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [generatingQuestion, setGeneratingQuestion] = useState<boolean>(false);
  const [showPreview, setShowPreview] = useState<boolean>(false);

  const sqlValue = Form.useWatch('sql', form);
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

  const resolveSaveMode = (
    sqlPair?: Pick<SqlPair, 'templateMode' | 'assetKind'> | null,
  ) =>
    sqlPair?.templateMode === 'anchored_template' ||
    sqlPair?.templateMode === 'executable_template' ||
    sqlPair?.assetKind === 'sql_template'
      ? 'business'
      : 'reference';
  const preserveExistingBusinessSaveMode =
    resolveSaveMode(defaultValue) === 'business';

  useEffect(() => {
    if (visible) {
      form.setFieldsValue({
        question: defaultValue?.question,
        sql: defaultValue?.sql,
        saveMode:
          !canManageBusinessTemplate && !preserveExistingBusinessSaveMode
            ? 'reference'
            : resolveSaveMode(defaultValue),
      });
    }
  }, [
    canManageBusinessTemplate,
    defaultValue,
    form,
    preserveExistingBusinessSaveMode,
    visible,
  ]);

  const handleReset = () => {
    setPreviewData(undefined);
    setShowPreview(false);
    setError(null);
    form.resetFields();
  };

  const sqlMode = defaultValue?.sqlMode || payload?.sqlMode;

  const onValidateSQL = async () => {
    await validateSql(runtimeScopeNavigation.selector, sqlValue, sqlMode);
  };

  const handleError = (error: unknown) => {
    const errorMessage = resolveAbortSafeErrorMessage(error, 'SQL 语法无效');
    if (!errorMessage) {
      return;
    }
    setError({
      message: errorMessage,
      shortMessage: 'SQL 语法无效',
      code: '',
      stacktrace: undefined,
    });
  };

  const onPreviewData = async () => {
    setError(null);
    setPreviewing(true);
    try {
      await onValidateSQL();
      setShowPreview(true);
      const data = await previewSql(
        runtimeScopeNavigation.selector,
        sqlValue,
        50,
        sqlMode,
      );
      setPreviewData(data);
    } catch (error) {
      setShowPreview(false);
      setPreviewData(undefined);
      handleError(error);
    } finally {
      setPreviewing(false);
    }
  };

  const onSubmitButton = () => {
    setError(null);
    setSubmitting(true);
    setShowPreview(false);
    form
      .validateFields()
      .then(async (values) => {
        try {
          await onValidateSQL();
          if (onSubmit) {
            const { saveMode, ...draft } = values;
            const templateMetadata =
              saveMode === 'business'
                ? SQL_PAIR_BUSINESS_TEMPLATE_PRESET
                : SQL_PAIR_REFERENCE_PRESET;
            await onSubmit({
              data: {
                ...draft,
                ...templateMetadata,
                ...(sqlMode ? { sqlMode } : {}),
              },
              id: defaultValue?.id,
            });
          }
          onClose();
        } catch (error) {
          handleError(error);
        } finally {
          setSubmitting(false);
        }
      })
      .catch((err) => {
        setSubmitting(false);
        const errorMessage = resolveAbortSafeErrorMessage(
          err,
          '保存失败，请稍后重试。',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
      });
  };

  const onGenerateQuestion = async () => {
    try {
      setGeneratingQuestion(true);
      const question = await generateKnowledgeSqlPairQuestion(
        runtimeScopeNavigation.selector,
        sqlValue,
      );
      form.setFieldsValue({ question });
    } catch (error) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '生成问题失败，请稍后重试。',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setGeneratingQuestion(false);
    }
  };

  const confirmLoading = loading || submitting;
  const disabled = !sqlValue;

  return (
    <>
      <StyledModal
        title={isCreateMode ? '新增 SQL 模板' : '更新 SQL 模板'}
        centered
        closable
        confirmLoading={confirmLoading}
        destroyOnHidden
        mask={{ closable: false }}
        onCancel={onClose}
        open={visible}
        width={760}
        cancelButtonProps={{ disabled: confirmLoading }}
        okButtonProps={{ disabled: previewing }}
        afterClose={() => handleReset()}
        footer={
          <Footer>
            <FooterHint>
              <InfoCircleOutlined className="mt-1" />
              <Typography.Text type="secondary" className="text-left">
                {sqlMode === 'dialect' ? (
                  <>
                    当前 SQL
                    会按数据源方言预览与校验，适合从问数结果沉淀为参考/业务模板。
                  </>
                ) : (
                  <>
                    这里使用的<b>SQL</b>是基于 ANSI
                    SQL，并针对当前语义引擎做了优化。{` `}
                    <Typography.Link
                      type="secondary"
                      href="https://docs.getwren.ai/oss/guide/home/wren_sql"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      了解语法说明。
                    </Typography.Link>
                  </>
                )}
              </Typography.Text>
            </FooterHint>
            <div style={{ display: 'flex', gap: 12 }}>
              <Button onClick={onClose}>取消</Button>
              <Button
                type="primary"
                onClick={onSubmitButton}
                loading={confirmLoading}
              >
                提交
              </Button>
            </div>
          </Footer>
        }
      >
        <StyledForm form={form} preserve={false} layout="vertical">
          <Form.Item
            className="adm-question-form-item"
            label={
              <QuestionLabel>
                <span>问题</span>
                <QuestionHint>
                  <span>让 AI 生成匹配的问题描述</span>
                  <Button
                    size="small"
                    loading={generatingQuestion}
                    onClick={onGenerateQuestion}
                    disabled={disabled}
                  >
                    <span className="text-sm">生成问题</span>
                  </Button>
                </QuestionHint>
              </QuestionLabel>
            }
            name="question"
            required
            rules={[
              {
                validator: createSQLPairQuestionValidator(
                  ERROR_TEXTS.SQL_PAIR.QUESTION,
                ),
              },
            ]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            label="保存为"
            name="saveMode"
            initialValue="reference"
            tooltip="业务口径会作为 L2 锚定模板使用，系统会尽量保持 SQL 骨架不被改写。"
            extra={
              canManageBusinessTemplate
                ? null
                : '仅工作空间所有者或管理员可以标记为业务口径，普通成员默认保存为参考样例。'
            }
          >
            <Radio.Group
              options={[
                {
                  label: '参考样例',
                  value: 'reference',
                },
                {
                  label: '业务口径',
                  value: 'business',
                  disabled:
                    !canManageBusinessTemplate &&
                    !preserveExistingBusinessSaveMode,
                },
              ]}
              optionType="button"
              buttonStyle="solid"
            />
          </Form.Item>
          <Form.Item
            label="SQL 语句"
            name="sql"
            required
            rules={[
              {
                required: true,
                message: ERROR_TEXTS.SQL_PAIR.SQL.REQUIRED,
              },
            ]}
          >
            <SQLEditor autoComplete autoFocus height={220} />
          </Form.Item>
        </StyledForm>
        <PreviewPanel>
          <PreviewHeader>
            <PreviewTitle>
              <Typography.Text className="gray-8">数据预览</Typography.Text>
              <Typography.Text type="secondary" className="text-sm">
                默认读取前 50 行，用于确认 SQL 可以在当前数据源执行。
              </Typography.Text>
            </PreviewTitle>
            <Button
              onClick={onPreviewData}
              loading={previewing}
              disabled={disabled}
            >
              预览数据
            </Button>
          </PreviewHeader>
          {showPreview && (
            <PreviewResult>
              <PreviewData
                loading={previewing}
                previewData={previewData}
                copyable={false}
                showExport={false}
                tableScrollY={180}
              />
            </PreviewResult>
          )}
        </PreviewPanel>
        {!!error && (
          <Alert
            showIcon
            type="error"
            message={error.shortMessage}
            description={<ErrorCollapse message={error.message} />}
          />
        )}
      </StyledModal>
    </>
  );
}

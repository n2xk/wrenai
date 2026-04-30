import type {
  DiagramModel,
  DiagramModelField,
  DiagramModelNestedField,
  DiagramModelRelationField,
  DiagramView,
  DiagramViewField,
} from '@/types/modeling';

export type ModelingAssistantTaskSummary = {
  key: 'semantics' | 'relationships' | 'governance';
  state: 'todo' | 'done';
  countLabel: string;
  detailLabel: string;
};

const hasDescription = (value?: string | null) =>
  typeof value === 'string' && value.trim().length > 0;

const fieldNeedsDescription = (
  field:
    | DiagramModelField
    | DiagramModelNestedField
    | DiagramViewField
    | null
    | undefined,
) => Boolean(field) && !hasDescription(field?.description);

const modelNeedsDescription = (model: DiagramModel | null | undefined) => {
  if (!model) {
    return false;
  }

  if (!hasDescription(model.description)) {
    return true;
  }

  return (model.fields || []).some((field) => fieldNeedsDescription(field));
};

const viewNeedsDescription = (view: DiagramView | null | undefined) => {
  if (!view) {
    return false;
  }

  if (!hasDescription(view.description)) {
    return true;
  }

  return (view.fields || []).some((field) => fieldNeedsDescription(field));
};

export const buildModelingAssistantTaskSummaries = ({
  models,
  views,
}: {
  models: Array<DiagramModel | null>;
  views?: Array<DiagramView | null>;
}): ModelingAssistantTaskSummary[] => {
  const relationCount = models.reduce(
    (total, model) =>
      total +
      (model?.relationFields || []).filter(
        (field): field is DiagramModelRelationField => Boolean(field),
      ).length,
    0,
  );
  const relationshipsState = relationCount > 0 ? 'done' : 'todo';
  const semanticsPendingCount =
    models.filter((model) => modelNeedsDescription(model)).length +
    (views || []).filter((view) => viewNeedsDescription(view)).length;
  const hasSemanticsGaps = semanticsPendingCount > 0;

  return [
    {
      key: 'semantics',
      state: hasSemanticsGaps ? 'todo' : 'done',
      countLabel: '1',
      detailLabel: hasSemanticsGaps
        ? `还有 ${semanticsPendingCount} 项缺少描述`
        : '描述已补充完成',
    },
    {
      key: 'relationships',
      state: relationshipsState,
      countLabel: '1',
      detailLabel:
        relationCount > 0
          ? `模型中已有 ${relationCount} 条关联关系`
          : '还没有已保存的关联关系',
    },
    {
      key: 'governance',
      state: 'todo',
      countLabel: '1',
      detailLabel: '可推荐业务词、SQL 模板和外部依赖治理字段',
    },
  ];
};

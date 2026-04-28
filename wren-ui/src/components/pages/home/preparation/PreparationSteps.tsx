import { Typography, Timeline, Badge, Tag } from 'antd';
import { useState } from 'react';
import styled from 'styled-components';
import CheckCircleFilled from '@ant-design/icons/CheckCircleFilled';
import CloseCircleFilled from '@ant-design/icons/CloseCircleFilled';
import MarkdownBlock from '@/components/editor/MarkdownBlock';
import type { Props } from './index';
import type {
  PreparationTimelineModel,
  PreparationTimelineStepStatus,
} from './preparationTimelineModel';

const StyledBadge = styled(Badge)`
  position: absolute;
  top: -5px;
  left: -3px;
  .ant-badge-status-dot {
    width: 7px;
    height: 7px;
  }
  .ant-badge-status-text {
    display: none;
  }
`;

const StyledTimeline = styled(Timeline)`
  && {
    margin-bottom: 0;
  }

  .ant-timeline-item {
    min-height: 30px;
    padding-bottom: 2px;
  }

  .ant-timeline-item-last {
    padding-bottom: 0;
  }

  .ant-steps-item-wrapper,
  .ant-steps-item-section {
    min-height: 0;
  }

  && .ant-steps-item-content,
  .ant-timeline-item-content {
    min-height: 20px !important;
    padding-bottom: 0;
  }

  .ant-timeline-item-head {
    background: transparent;
  }
`;

const StepHeader = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 18px;
`;

const StepTitle = styled(Typography.Text)`
  && {
    color: #273142;
    font-size: 12.5px;
    font-weight: 600;
    line-height: 1.35;
  }
`;

const StepDescription = styled.div`
  margin-top: 2px;
  color: #667085;
  font-size: 12px;
  line-height: 1.45;
`;

const StepMarkdown = styled.div`
  margin-top: 4px;
  max-height: 150px;
  overflow-y: auto;
  color: #475467;
  font-size: 12px;
  line-height: 1.5;
`;

const DetailToggleButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 18px;
  padding: 0 6px 0 5px;
  border: 1px solid rgba(111, 71, 255, 0.12);
  border-radius: 999px;
  background: rgba(111, 71, 255, 0.045);
  color: #6b7280;
  cursor: pointer;
  font-size: 11px;
  font-weight: 500;
  line-height: 18px;

  &:hover {
    border-color: rgba(111, 71, 255, 0.22);
    background: rgba(111, 71, 255, 0.08);
    color: #4c1d95;
  }

  &:focus-visible {
    outline: 2px solid rgba(111, 71, 255, 0.28);
    outline-offset: 2px;
    border-radius: 6px;
  }
`;

const DetailToggleIcon = styled.span<{ $expanded: boolean }>`
  display: inline-block;
  line-height: 1;
  transform: rotate(${(props) => (props.$expanded ? '90deg' : '0deg')});
  transition: transform 0.14s ease;
`;

const StepTags = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 4px;

  .ant-tag {
    margin-inline-end: 0;
    padding: 0 8px;
    line-height: 20px;
  }
`;

const getProcessDot = (processing: boolean) =>
  processing ? <StyledBadge color="geekblue" status="processing" /> : null;

export default function PreparationSteps(
  props: Props & { preparationModel: PreparationTimelineModel },
) {
  const { className, preparationModel } = props;
  const [expandedDetailKeys, setExpandedDetailKeys] = useState<
    Record<string, boolean>
  >({});

  const toggleDetail = (detailKey: string) => {
    setExpandedDetailKeys((current) => ({
      ...current,
      [detailKey]: !current[detailKey],
    }));
  };

  const getDot = (status: PreparationTimelineStepStatus) => {
    if (status === 'running') {
      return getProcessDot(true);
    }

    if (status === 'finished') {
      return <CheckCircleFilled style={{ color: '#52c41a' }} />;
    }

    if (status === 'failed') {
      return <CloseCircleFilled style={{ color: '#ff4d4f' }} />;
    }

    return undefined;
  };

  return (
    <StyledTimeline
      className={className}
      items={preparationModel.steps.map((step, index) => {
        const detailKey = `${step.key}-${index}`;
        const detailId = `preparation-detail-${detailKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
        const isDetailExpanded = Boolean(expandedDetailKeys[detailKey]);
        const shouldCollapseDescription = (step.description?.length || 0) > 72;
        const hasCollapsibleDetails = Boolean(
          shouldCollapseDescription || step.tags?.length || step.detailMarkdown,
        );

        return {
          key: detailKey,
          icon: getDot(step.status),
          content: (
            <>
              <StepHeader>
                <StepTitle>{step.title}</StepTitle>
                {hasCollapsibleDetails ? (
                  <DetailToggleButton
                    type="button"
                    aria-label={`${isDetailExpanded ? '收起详情' : '查看详情'}：${step.title}`}
                    aria-expanded={isDetailExpanded}
                    aria-controls={detailId}
                    onClick={() => toggleDetail(detailKey)}
                  >
                    <DetailToggleIcon $expanded={isDetailExpanded}>
                      ›
                    </DetailToggleIcon>
                    {isDetailExpanded ? '收起' : '详情'}
                  </DetailToggleButton>
                ) : null}
              </StepHeader>
              {step.description && !shouldCollapseDescription ? (
                <StepDescription>{step.description}</StepDescription>
              ) : null}
              {hasCollapsibleDetails ? (
                <>
                  {isDetailExpanded ? (
                    <StepMarkdown id={detailId}>
                      {step.description && shouldCollapseDescription ? (
                        <StepDescription>{step.description}</StepDescription>
                      ) : null}
                      {step.tags?.length ? (
                        <StepTags>
                          {step.tags.map((tag) => (
                            <Tag
                              key={`${detailKey}-${tag}`}
                              className="gray-7 mb-0"
                            >
                              {tag}
                            </Tag>
                          ))}
                        </StepTags>
                      ) : null}
                      {step.detailMarkdown ? (
                        <MarkdownBlock content={step.detailMarkdown} />
                      ) : null}
                    </StepMarkdown>
                  ) : null}
                </>
              ) : null}
            </>
          ),
        };
      })}
    />
  );
}

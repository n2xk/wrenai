import { Typography } from 'antd';
import styled from 'styled-components';
import Prompt from '@/components/pages/home/prompt';

const { Title } = Typography;

export const Stage = styled.div`
  min-height: 100%;
  padding: clamp(36px, 6vh, 72px) 20px clamp(96px, 14vh, 152px);
  max-width: 920px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: clamp(16px, 2.4vh, 22px);
  background: transparent;
  position: relative;
  isolation: isolate;

  &::before {
    content: '';
    position: absolute;
    top: clamp(24px, 7vh, 72px);
    left: 50%;
    width: min(960px, 118vw);
    height: clamp(360px, 54vh, 500px);
    transform: translateX(-50%);
    border-radius: var(--nova-radius-chip);
    background: radial-gradient(
      ellipse at 50% 26%,
      rgba(123, 87, 232, 0.08) 0%,
      rgba(123, 87, 232, 0.035) 28%,
      rgba(247, 242, 235, 0.34) 52%,
      rgba(255, 255, 255, 0) 74%
    );
    filter: blur(2px);
    pointer-events: none;
    z-index: -1;
  }
`;

export const HeroPanel = styled.div`
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
`;

export const HeroGreeting = styled(Title)`
  &.ant-typography {
    margin: 0 !important;
    font-size: 28px;
    line-height: 1.18;
    text-align: center;
    color: #111827;
    font-weight: 650;
  }
`;

export const HeroTitle = styled(Title)`
  &.ant-typography {
    margin: 0 !important;
    font-size: 17px;
    line-height: 1.5;
    text-align: center;
    color: #6b7280;
    font-weight: 400;
    max-width: 28ch;
  }
`;

export const ComposerCard = styled.div`
  border-radius: var(--nova-radius-panel);
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid #e7ecf3;
  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.055);
  padding: 10px 14px;
`;

export const ComposerShell = styled.div<{ $dropdownOpen?: boolean }>`
  width: min(100%, 680px);
  position: relative;
  margin-top: 8px;
`;

export const SourceChip = styled.div`
  height: 28px;
  border-radius: var(--nova-radius-control);
  background: #ffffff;
  color: #4b5563;
  border: 1px solid #e5e7eb;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
`;

export const SourceChipRemove = styled.button`
  width: 16px;
  height: 16px;
  border: 0;
  border-radius: var(--nova-radius-control);
  padding: 0;
  background: transparent;
  color: #9ca3af;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;

  &:hover {
    color: #6b7280;
    background: #f3f4f6;
  }
`;

export const KnowledgePickerList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 18px;
  max-height: 420px;
  overflow: auto;
`;

export const KnowledgePickerCard = styled.button<{ $active?: boolean }>`
  width: 100%;
  border-radius: var(--nova-radius-card);
  border: 1px solid
    ${(props) =>
      props.$active ? 'rgba(141, 101, 225, 0.24)' : 'var(--nova-outline-soft)'};
  background: ${(props) =>
    props.$active ? 'rgba(123, 87, 232, 0.04)' : '#ffffff'};
  padding: 16px 18px;
  text-align: left;
  cursor: pointer;
  transition:
    background 0.18s ease,
    border-color 0.18s ease;

  &:hover {
    background: ${(props) =>
      props.$active ? 'rgba(123, 87, 232, 0.05)' : '#fafafa'};
    border-color: rgba(141, 101, 225, 0.2);
  }
`;

export const RecommendationSection = styled.section`
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

export const RecommendationRow = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;

  @media (max-width: 1180px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @media (max-width: 860px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

export const RecommendationCard = styled.button<{ $accent: string }>`
  border: 1px solid #e8edf4;
  background: rgba(255, 255, 255, 0.92);
  border-radius: var(--nova-radius-card);
  padding: 14px 15px;
  text-align: left;
  cursor: pointer;
  height: 134px;
  min-height: 134px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.024);
  transition:
    background 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.98);
    border-color: rgba(123, 87, 232, 0.2);
    box-shadow: 0 12px 28px rgba(15, 23, 42, 0.045);
    transform: translateY(-1px);
  }
`;

export const RecommendationCardHeader = styled.div`
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 7px;
  max-width: 100%;
  margin-bottom: 10px;
`;

export const RecommendationBadge = styled.span<{ $primary?: boolean }>`
  height: 22px;
  max-width: 100%;
  display: inline-flex;
  align-items: center;
  padding: 0 8px;
  border-radius: var(--nova-radius-chip);
  color: ${(props) => (props.$primary ? 'var(--nova-primary)' : '#7b5f49')};
  background: ${(props) =>
    props.$primary
      ? 'rgba(141, 101, 225, 0.065)'
      : 'rgba(239, 225, 209, 0.36)'};
  font-size: 11.5px;
  line-height: 1;
  font-weight: 600;
  white-space: nowrap;
`;

export const RecommendationQuestion = styled.span`
  display: -webkit-box;
  color: #334155;
  font-size: 13px;
  line-height: 1.56;
  font-weight: 400;
  overflow: hidden;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
`;

export const RecommendationAssetName = styled.span`
  display: block;
  margin-top: auto;
  padding-top: 8px;
  color: var(--nova-text-secondary, #667085);
  font-size: 12px;
  line-height: 1.45;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const RecommendationIcon = styled.div<{ $accent: string }>`
  width: 23px;
  height: 23px;
  border-radius: var(--nova-radius-control);
  background: color-mix(in srgb, ${(props) => props.$accent} 70%, #ffffff);
  color: #6366f1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  font-size: 13px;
`;

export const ComposerScopeRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
`;

export const KnowledgeDropdownPanel = styled.div`
  position: absolute;
  top: calc(100% + 14px);
  left: 0;
  right: 0;
  z-index: 8;
  border: 1px solid #e7ecf3;
  border-radius: var(--nova-radius-panel);
  background: #ffffff;
  box-shadow: 0 18px 42px rgba(15, 23, 42, 0.08);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

export const KnowledgeDropdownSearchShell = styled.label`
  height: 30px;
  width: 100%;
  background: transparent;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 2px 8px;
  border-bottom: 1px solid #edf1f5;
`;

export const KnowledgeDropdownSearch = styled.input`
  flex: 1;
  min-width: 0;
  height: auto;
  padding: 0;
  font-size: 12.5px;
  color: #4b5563;
  background: transparent;
  border: 0;
  box-shadow: none;
  outline: none;

  &::placeholder {
    color: #b8c1cf;
  }
`;

export const ComposerScopeChip = styled.button`
  height: 28px;
  border-radius: var(--nova-radius-chip);
  border: 1px solid #e7ecf3;
  background: #f8fafc;
  color: #4b5563;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    background 0.2s ease,
    color 0.2s ease;

  &:hover {
    border-color: rgba(123, 87, 232, 0.2);
    background: rgba(123, 87, 232, 0.06);
    color: #111827;
  }
`;

export const ComposerPassiveChip = styled.div`
  height: 28px;
  border-radius: var(--nova-radius-chip);
  border: 1px solid #eef2f7;
  background: #fbfcfe;
  color: #6b7280;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 500;
`;

export const ComposerAtMark = styled.span`
  width: 18px;
  height: 18px;
  border-radius: var(--nova-radius-chip);
  background: rgba(123, 87, 232, 0.1);
  color: var(--nova-primary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
`;

export const ComposerPrompt = styled(Prompt)`
  width: 100%;

  > div {
    gap: 6px;
  }

  .ant-input {
    min-height: 54px !important;
    color: #111827;
  }

  .ant-input::placeholder {
    color: #b2bac8;
  }

  .prompt-footer {
    align-items: flex-end;
  }

  .prompt-footer-tools {
    transform: translateY(8px);
  }

  .prompt-send-button.ant-btn {
    width: 32px;
    height: 32px;
    border-radius: var(--nova-radius-control);
  }
`;

export const ComposerToolButton = styled.button<{ $active?: boolean }>`
  height: 28px;
  border-radius: var(--nova-radius-chip);
  border: 1px solid
    ${(props) => (props.$active ? 'rgba(123, 87, 232, 0.22)' : '#eef2f7')};
  background: ${(props) =>
    props.$active ? 'rgba(123, 87, 232, 0.08)' : '#fbfcfe'};
  color: ${(props) => (props.$active ? 'var(--nova-primary)' : '#6b7280')};
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    background 0.2s ease,
    color 0.2s ease;

  &:hover:not(:disabled) {
    border-color: rgba(123, 87, 232, 0.16);
    background: rgba(123, 87, 232, 0.05);
    color: #111827;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.48;
  }
`;

export const ComposerKnowledgeAction = styled(ComposerScopeChip)`
  background: #ffffff;
`;

export const ExploreHeaderBar = styled.div`
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 9px;
  flex-wrap: wrap;
  padding-left: 4px;
`;

export const ExploreTitle = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: #111827;
`;

export const ExploreTemplateTag = styled.span`
  height: 28px;
  border-radius: var(--nova-radius-chip);
  background: #f7f8fb;
  border: 1px solid #edf1f6;
  color: #4b5563;
  padding: 0 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
`;

export const ExploreEmpty = styled.div`
  padding: 18px 16px;
  color: #8b93a3;
  font-size: 13px;
`;

export const KnowledgeOptionList = styled.div`
  display: block;
  max-height: min(380px, 44vh);
  min-height: 0;
  overflow-y: auto;
`;

export const KnowledgeOptionItems = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

export const KnowledgeOptionRow = styled.button<{ $active?: boolean }>`
  width: 100%;
  border: 1px solid
    ${(props) =>
      props.$active ? 'rgba(123, 87, 232, 0.18)' : 'rgba(15, 23, 42, 0.06)'};
  background: ${(props) =>
    props.$active ? 'rgba(123, 87, 232, 0.04)' : '#ffffff'};
  border-radius: var(--nova-radius-card);
  padding: 11px 14px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  text-align: left;
  cursor: pointer;
  transition:
    background 0.2s ease,
    border-color 0.2s ease;

  &:hover {
    background: ${(props) =>
      props.$active ? 'rgba(123, 87, 232, 0.06)' : '#fbfcfe'};
    border-color: rgba(123, 87, 232, 0.14);
  }
`;

export const KnowledgeOptionMain = styled.div`
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
`;

export const KnowledgeOptionCopy = styled.div`
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
`;

export const KnowledgeOptionMeta = styled.div<{ $active?: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  color: ${(props) => (props.$active ? 'var(--nova-primary)' : '#8b93a3')};
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
`;

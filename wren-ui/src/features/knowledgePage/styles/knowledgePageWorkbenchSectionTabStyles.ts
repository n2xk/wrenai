import styled from 'styled-components';

export const WorkbenchSectionTabs = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  width: fit-content;
  padding: 3px;
  border-radius: var(--nova-radius-control);
  border: 1px solid rgba(15, 23, 42, 0.06);
  background: rgba(255, 255, 255, 0.88);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.75);
`;

export const WorkbenchSectionTab = styled.button<{ $active?: boolean }>`
  height: 30px;
  padding: 0 12px;
  border-radius: var(--nova-radius-control);
  border: 1px solid
    ${(props) => (props.$active ? 'rgba(91, 75, 219, 0.18)' : 'transparent')};
  background: ${(props) => (props.$active ? '#ffffff' : 'transparent')};
  color: ${(props) => (props.$active ? '#5b4bdb' : '#626a7b')};
  font-size: 13px;
  font-weight: ${(props) => (props.$active ? 600 : 500)};
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    background 0.18s ease,
    color 0.18s ease,
    box-shadow 0.18s ease;

  box-shadow: ${(props) =>
    props.$active ? '0 6px 14px rgba(15, 23, 42, 0.05)' : 'none'};

  &:hover {
    border-color: rgba(91, 75, 219, 0.16);
    background: ${(props) => (props.$active ? '#ffffff' : '#fafbfd')};
    color: #111827;
  }
`;

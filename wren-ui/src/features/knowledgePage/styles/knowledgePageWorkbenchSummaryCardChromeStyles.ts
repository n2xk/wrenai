import styled from 'styled-components';

export const SummaryCard = styled.div`
  border-radius: var(--nova-radius-card);
  border: 1px solid var(--nova-outline-soft);
  background: linear-gradient(
    180deg,
    rgba(252, 251, 255, 0.98) 0%,
    rgba(255, 255, 255, 0.96) 100%
  );
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.04);
  padding: 14px 16px;
`;

export const SummaryHeader = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

export const SummaryTopRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 30px;

  @media (max-width: 980px) {
    flex-direction: column;
    align-items: flex-start;
  }
`;

export const SummaryInfo = styled.div`
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 5px;
`;

export const SummaryDescription = styled.div`
  max-width: none;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.55;
`;

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import KnowledgeModelingSection from './KnowledgeModelingSection';

jest.mock('@/components/pages/modeling/ModelingWorkspace', () => ({
  __esModule: true,
  default: ({ embedded }: any) => (
    <div data-modeling-workspace>{String(Boolean(embedded))}</div>
  ),
}));

describe('KnowledgeModelingSection', () => {
  it('renders the modeling workspace without the summary cards', () => {
    const html = renderToStaticMarkup(
      <KnowledgeModelingSection
        modelingSummary={{ modelCount: 4, viewCount: 2, relationCount: 3 }}
        modelingWorkspaceKey="kb:workspace"
      />,
    );

    expect(html).toContain('data-modeling-workspace');
    expect(html).not.toContain('模型');
    expect(html).not.toContain('视图');
    expect(html).not.toContain('关系');
  });
});

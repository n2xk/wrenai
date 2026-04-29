import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import KnowledgeBusinessTermsStage from './KnowledgeBusinessTermsStage';

const runtimeSelector = {
  workspaceId: 'workspace-1',
  knowledgeBaseId: 'kb-1',
};

describe('KnowledgeBusinessTermsStage', () => {
  it('shows create entry for writable knowledge bases', () => {
    const html = renderToStaticMarkup(
      <KnowledgeBusinessTermsStage
        isKnowledgeMutationDisabled={false}
        runtimeSelector={runtimeSelector}
      />,
    );

    expect(html).toContain('新建业务词');
    expect(html).not.toContain('当前知识库只读');
  });

  it('hides create entry and shows readonly copy for readonly knowledge bases', () => {
    const html = renderToStaticMarkup(
      <KnowledgeBusinessTermsStage
        isKnowledgeMutationDisabled
        runtimeSelector={runtimeSelector}
      />,
    );

    expect(html).not.toContain('新建业务词');
    expect(html).toContain('当前知识库只读');
    expect(html).toContain('不支持新建或编辑');
  });
});

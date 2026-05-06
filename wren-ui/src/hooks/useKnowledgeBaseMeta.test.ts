import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { KNOWLEDGE_BASE_REQUIRED_MUTATION_HINT } from '@/utils/knowledgeMutationGuard';
import useKnowledgeBaseMeta, {
  resolveActiveKnowledgeBaseFromList,
} from './useKnowledgeBaseMeta';

const kbA = { id: 'kb-a', name: 'A' };
const kbB = { id: 'kb-b', name: 'B' };

describe('useKnowledgeBaseMeta helpers', () => {
  it('prefers route/current knowledge base over pending selected fallback', () => {
    expect(
      resolveActiveKnowledgeBaseFromList({
        knowledgeBases: [kbA, kbB],
        selectedKnowledgeBaseId: 'kb-b',
        routeKnowledgeBaseId: 'kb-a',
        currentKnowledgeBaseId: 'kb-a',
        selectorKnowledgeBaseFallback: null,
      }),
    ).toEqual(kbA);
  });

  it('falls back to selector knowledge base when list is empty', () => {
    expect(
      resolveActiveKnowledgeBaseFromList({
        knowledgeBases: [],
        selectedKnowledgeBaseId: null,
        routeKnowledgeBaseId: undefined,
        currentKnowledgeBaseId: undefined,
        selectorKnowledgeBaseFallback: kbA,
      }),
    ).toEqual(kbA);
  });
});

describe('useKnowledgeBaseMeta', () => {
  const renderMeta = (
    overrides: Partial<Parameters<typeof useKnowledgeBaseMeta>[0]> = {},
  ) => {
    let current!: ReturnType<typeof useKnowledgeBaseMeta>;

    const Harness = () => {
      current = useKnowledgeBaseMeta({
        knowledgeBases: [],
        snapshotReadonlyHint: '历史版本只读',
        canShowKnowledgeLifecycleAction: () => false,
        resolveLifecycleActionLabel: () => '归档',
        resolveReferenceOwner: (owner, fallback) => owner || fallback || '成员',
        ...overrides,
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));
    return current;
  };

  it('disables knowledge mutations when there is no selected knowledge base', () => {
    const meta = renderMeta();

    expect(meta.activeKnowledgeBase).toBeNull();
    expect(meta.isKnowledgeMutationDisabled).toBe(true);
    expect(meta.knowledgeMutationHint).toBe(
      KNOWLEDGE_BASE_REQUIRED_MUTATION_HINT,
    );
  });

  it('treats selector-only knowledge base fallback as non-mutable until listed', () => {
    const meta = renderMeta({
      selectorKnowledgeBaseFallback: kbA,
    });

    expect(meta.activeKnowledgeBase).toEqual(kbA);
    expect(meta.isKnowledgeMutationDisabled).toBe(true);
    expect(meta.knowledgeMutationHint).toBe(
      KNOWLEDGE_BASE_REQUIRED_MUTATION_HINT,
    );
  });
});

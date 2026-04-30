import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SetupConnectionPage from '../../../pages/setup/connection';
import SetupModelsPage from '../../../pages/setup/models';
import SetupRelationshipsPage from '../../../pages/setup/relationships';

const mockReplace = jest.fn();

jest.mock('@/hooks/useRuntimeScopeNavigation', () => ({
  __esModule: true,
  default: () => ({
    replace: mockReplace,
  }),
}));

describe('setup route entries', () => {
  beforeEach(() => {
    mockReplace.mockReset();
  });

  it('keeps /setup/connection as a compatibility redirect', () => {
    expect(renderToStaticMarkup(<SetupConnectionPage />)).toContain(
      '正在进入知识库工作台',
    );
  });

  it('keeps /setup/models as a compatibility redirect', () => {
    expect(renderToStaticMarkup(<SetupModelsPage />)).toContain(
      '正在进入知识库工作台',
    );
  });

  it('keeps /setup/relationships as a compatibility redirect', () => {
    expect(renderToStaticMarkup(<SetupRelationshipsPage />)).toContain(
      '正在进入知识库工作台',
    );
  });
});

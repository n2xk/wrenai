import {
  resolveAssetWizardModelingAssistantIntent,
  resolveAssetWizardModelingAssistantLabel,
} from './assetWizardModelingAssistantSupport';

describe('assetWizardModelingAssistantSupport', () => {
  it('routes batch imports to relationships', () => {
    expect(
      resolveAssetWizardModelingAssistantIntent({
        assets: [
          { id: '1', name: 'Orders', kind: 'model', fieldCount: 4, fields: [] },
          {
            id: '2',
            name: 'Customers',
            kind: 'model',
            fieldCount: 3,
            fields: [],
          },
        ],
        isBatchSelection: true,
      }),
    ).toBe('relationships');
  });

  it('routes a single model import to semantics', () => {
    expect(
      resolveAssetWizardModelingAssistantIntent({
        assets: [
          { id: '1', name: 'Orders', kind: 'model', fieldCount: 4, fields: [] },
        ],
        isBatchSelection: false,
      }),
    ).toBe('semantics');
  });

  it('falls back to modeling when no model asset exists', () => {
    expect(
      resolveAssetWizardModelingAssistantIntent({
        assets: [
          {
            id: '1',
            name: 'Orders View',
            kind: 'view',
            fieldCount: 4,
            fields: [],
          },
        ],
        isBatchSelection: false,
      }),
    ).toBeUndefined();
    expect(resolveAssetWizardModelingAssistantLabel()).toBe('去建模');
  });

  it('returns copy that matches the selected assistant route', () => {
    expect(resolveAssetWizardModelingAssistantLabel('relationships')).toBe(
      '去生成表关系',
    );
    expect(resolveAssetWizardModelingAssistantLabel('semantics')).toBe(
      '去补充语义',
    );
  });
});

import {
  buildSetupModelingAssistantParams,
  resolveSetupModelingAssistantIntent,
} from './setupModelingAssistantSupport';

describe('setupModelingAssistantSupport', () => {
  it('routes sample dataset imports into relationships review', () => {
    expect(resolveSetupModelingAssistantIntent('sample-dataset-import')).toBe(
      'relationships',
    );
    expect(buildSetupModelingAssistantParams('sample-dataset-import')).toEqual({
      section: 'modeling',
      openAssistant: 'relationships',
    });
  });

  it('routes setup relationship completion into semantics review', () => {
    expect(resolveSetupModelingAssistantIntent('relationships-review')).toBe(
      'semantics',
    );
    expect(buildSetupModelingAssistantParams('relationships-review')).toEqual({
      section: 'modeling',
      openAssistant: 'semantics',
    });
  });
});

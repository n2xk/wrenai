import { resolveThreadWorkbenchHeaderActionModel } from './ThreadWorkbenchHeaderActions';

describe('ThreadWorkbenchHeaderActions', () => {
  it('keeps preview header actions minimal', () => {
    expect(
      resolveThreadWorkbenchHeaderActionModel({
        activeArtifact: 'preview',
      }),
    ).toEqual({
      showCloseOnly: true,
    });
  });

  it('keeps chart header actions minimal', () => {
    expect(
      resolveThreadWorkbenchHeaderActionModel({
        activeArtifact: 'chart',
      }),
    ).toEqual({
      showCloseOnly: true,
    });
  });

  it('keeps sql header actions minimal too', () => {
    expect(
      resolveThreadWorkbenchHeaderActionModel({
        activeArtifact: 'sql',
      }),
    ).toEqual({
      showCloseOnly: true,
    });
  });
});

import { SpreadsheetRepository } from './spreadsheetRepository';

const buildKnexRows = (rows: any[]) => {
  const privacyBuilder: any = {
    where: jest.fn(() => privacyBuilder),
    orWhere: jest.fn(() => privacyBuilder),
    orWhereNull: jest.fn(() => privacyBuilder),
  };
  const builder: any = {
    where: jest.fn(() => builder),
    andWhere: jest.fn((callback?: unknown) => {
      if (typeof callback === 'function') {
        callback(privacyBuilder);
      }
      return builder;
    }),
    whereNull: jest.fn(() => builder),
    orderBy: jest.fn(() => builder),
    first: jest.fn().mockResolvedValue(rows[0] ?? null),
    then: (
      resolve: (value: any[]) => unknown,
      reject?: (reason: any) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
  };

  const knex = jest.fn(() => builder);
  return { knex, builder, privacyBuilder };
};

describe('SpreadsheetRepository visibility', () => {
  it('scopes spreadsheets by workspace and limits actor visibility to owned or shared resources', async () => {
    const { knex, builder, privacyBuilder } = buildKnexRows([
      {
        id: 1,
        workspace_id: 'workspace-1',
        actor_user_id: 'user-1',
        is_shared: false,
        name: '私有日报',
        sql: 'select 1',
        current_version: 1,
      },
    ]);
    const repository = new SpreadsheetRepository(knex as unknown as any);

    await repository.findAllVisibleByRuntimeIdentity({
      workspaceId: 'workspace-1',
      actorUserId: 'user-1',
    });

    expect(builder.where).toHaveBeenCalledWith('workspace_id', 'workspace-1');
    expect(builder.andWhere).toHaveBeenCalledWith(expect.any(Function));
    expect(privacyBuilder.where).toHaveBeenCalledWith('is_shared', true);
    expect(privacyBuilder.orWhere).toHaveBeenCalledWith(
      'actor_user_id',
      'user-1',
    );
    expect(privacyBuilder.orWhereNull).toHaveBeenCalledWith('actor_user_id');
  });

  it('keeps compatibility visibility when no actor is available', async () => {
    const { knex, builder } = buildKnexRows([]);
    const repository = new SpreadsheetRepository(knex as unknown as any);

    await repository.findAllVisibleByRuntimeIdentity({
      workspaceId: 'workspace-1',
    });

    expect(builder.where).toHaveBeenCalledWith('workspace_id', 'workspace-1');
    expect(builder.andWhere).not.toHaveBeenCalled();
  });
});

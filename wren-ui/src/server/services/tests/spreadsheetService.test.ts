import { SpreadsheetService } from '../spreadsheetService';

const createSpreadsheetServiceHarness = () => {
  const mockTransaction = { id: 'spreadsheet-tx-1' };
  const mockSpreadsheetRepository = {
    transaction: jest.fn().mockResolvedValue(mockTransaction),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    findAllVisibleByRuntimeIdentity: jest.fn(),
    findOneVisibleByRuntimeIdentity: jest.fn(),
    findBySourceResponseIdVisibleByRuntimeIdentity: jest.fn(),
    createOne: jest.fn(),
    updateOne: jest.fn(),
    deleteOne: jest.fn(),
  };
  const mockSpreadsheetSettingRepository = {
    findOneBySpreadsheetId: jest.fn(),
    createOne: jest.fn(),
    updateOne: jest.fn(),
  };
  const mockSpreadsheetHistoryRepository = {
    findAllBySpreadsheetId: jest.fn(),
    createOne: jest.fn(),
  };
  const spreadsheetService = new SpreadsheetService({
    spreadsheetRepository: mockSpreadsheetRepository as any,
    spreadsheetSettingRepository: mockSpreadsheetSettingRepository as any,
    spreadsheetHistoryRepository: mockSpreadsheetHistoryRepository as any,
  });

  return {
    spreadsheetService,
    mockSpreadsheetRepository,
    mockSpreadsheetSettingRepository,
    mockSpreadsheetHistoryRepository,
    mockTransaction,
  };
};

describe('SpreadsheetService', () => {
  it('creates a spreadsheet with default setting and initial history', async () => {
    const {
      spreadsheetService,
      mockSpreadsheetRepository,
      mockSpreadsheetSettingRepository,
      mockSpreadsheetHistoryRepository,
      mockTransaction,
    } = createSpreadsheetServiceHarness();
    mockSpreadsheetRepository.findBySourceResponseIdVisibleByRuntimeIdentity.mockResolvedValue(
      null,
    );
    mockSpreadsheetRepository.createOne.mockResolvedValue({
      id: 8,
      name: '销售日报',
      sql: 'select * from sales_daily',
      currentVersion: 1,
      sourceResponseId: 99,
    });
    mockSpreadsheetSettingRepository.createOne.mockResolvedValue({
      id: 18,
      spreadsheetId: 8,
      hiddenColumns: [],
      pinnedColumns: [],
      unpinnedColumns: [],
      columnWidths: {},
    });
    mockSpreadsheetHistoryRepository.createOne.mockResolvedValue({
      id: 28,
      spreadsheetId: 8,
      version: 1,
      type: 'INITIALIZE',
      sql: 'select * from sales_daily',
      payload: { sourceResponseId: 99, sourceThreadId: 7 },
    });

    const result = await spreadsheetService.createSpreadsheet({
      runtimeIdentity: {
        projectId: 100,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
      },
      name: '销售日报',
      sql: 'select * from sales_daily',
      sourceThreadId: 7,
      sourceResponseId: 99,
      createdBy: 'user-1',
    });

    expect(mockSpreadsheetRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        name: '销售日报',
        sourceResponseId: 99,
      }),
      { tx: mockTransaction },
    );
    expect(mockSpreadsheetSettingRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({ spreadsheetId: 8 }),
      { tx: mockTransaction },
    );
    expect(mockSpreadsheetHistoryRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        spreadsheetId: 8,
        version: 1,
        type: 'INITIALIZE',
      }),
      { tx: mockTransaction },
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: 8,
        setting: expect.objectContaining({ spreadsheetId: 8 }),
        history: [expect.objectContaining({ version: 1 })],
      }),
    );
  });

  it('returns an existing spreadsheet for the same source response', async () => {
    const {
      spreadsheetService,
      mockSpreadsheetRepository,
      mockSpreadsheetSettingRepository,
      mockSpreadsheetHistoryRepository,
    } = createSpreadsheetServiceHarness();
    mockSpreadsheetRepository.findBySourceResponseIdVisibleByRuntimeIdentity.mockResolvedValue(
      {
        id: 8,
        name: '销售日报',
        sql: 'select * from sales_daily',
        currentVersion: 1,
      },
    );
    mockSpreadsheetSettingRepository.findOneBySpreadsheetId.mockResolvedValue({
      id: 18,
      spreadsheetId: 8,
      hiddenColumns: [],
      pinnedColumns: [],
      unpinnedColumns: [],
      columnWidths: {},
    });
    mockSpreadsheetHistoryRepository.findAllBySpreadsheetId.mockResolvedValue([
      {
        id: 28,
        spreadsheetId: 8,
        version: 1,
        type: 'INITIALIZE',
        sql: 'select * from sales_daily',
        payload: {},
      },
    ]);

    const result = await spreadsheetService.createSpreadsheet({
      runtimeIdentity: { workspaceId: 'workspace-1' },
      name: '销售日报',
      sql: 'select * from sales_daily',
      sourceResponseId: 99,
    });

    expect(mockSpreadsheetRepository.createOne).not.toHaveBeenCalled();
    expect(result.id).toBe(8);
    expect(result.history).toHaveLength(1);
  });

  it('persists sanitized column settings', async () => {
    const {
      spreadsheetService,
      mockSpreadsheetRepository,
      mockSpreadsheetSettingRepository,
      mockSpreadsheetHistoryRepository,
    } = createSpreadsheetServiceHarness();
    mockSpreadsheetRepository.findOneVisibleByRuntimeIdentity.mockResolvedValue(
      {
        id: 8,
        name: '销售日报',
        sql: 'select * from sales_daily',
        currentVersion: 1,
      },
    );
    mockSpreadsheetSettingRepository.findOneBySpreadsheetId
      .mockResolvedValueOnce({
        id: 18,
        spreadsheetId: 8,
        hiddenColumns: [],
        pinnedColumns: [],
        unpinnedColumns: [],
        columnWidths: {},
      })
      .mockResolvedValueOnce({
        id: 18,
        spreadsheetId: 8,
        hiddenColumns: ['channel'],
        pinnedColumns: [],
        unpinnedColumns: ['date', 'channel'],
        columnWidths: {},
      });
    mockSpreadsheetHistoryRepository.findAllBySpreadsheetId.mockResolvedValue(
      [],
    );

    await spreadsheetService.updateSpreadsheetSetting(
      8,
      { workspaceId: 'workspace-1' },
      {
        hiddenColumns: ['channel', 'channel', ''],
        unpinnedColumns: ['date', 'channel'],
      },
    );

    expect(mockSpreadsheetSettingRepository.updateOne).toHaveBeenCalledWith(
      18,
      {
        hiddenColumns: ['channel'],
        unpinnedColumns: ['date', 'channel'],
      },
    );
  });

  it('allows shared spreadsheets to be read by another actor', async () => {
    const {
      spreadsheetService,
      mockSpreadsheetRepository,
      mockSpreadsheetSettingRepository,
      mockSpreadsheetHistoryRepository,
    } = createSpreadsheetServiceHarness();
    mockSpreadsheetRepository.findOneVisibleByRuntimeIdentity.mockResolvedValue(
      {
        id: 8,
        name: '共享日报',
        sql: 'select * from sales_daily',
        currentVersion: 1,
        actorUserId: 'owner-1',
        isShared: true,
      },
    );
    mockSpreadsheetSettingRepository.findOneBySpreadsheetId.mockResolvedValue(
      null,
    );
    mockSpreadsheetHistoryRepository.findAllBySpreadsheetId.mockResolvedValue(
      [],
    );

    const result = await spreadsheetService.getSpreadsheetDetail(8, {
      workspaceId: 'workspace-1',
      actorUserId: 'member-2',
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: 8,
        name: '共享日报',
        isShared: true,
      }),
    );
  });

  it('rejects writes to a shared spreadsheet when the actor is not the owner', async () => {
    const { spreadsheetService, mockSpreadsheetRepository } =
      createSpreadsheetServiceHarness();
    mockSpreadsheetRepository.findOneVisibleByRuntimeIdentity.mockResolvedValue(
      {
        id: 8,
        name: '共享日报',
        sql: 'select * from sales_daily',
        currentVersion: 1,
        actorUserId: 'owner-1',
        isShared: true,
      },
    );

    await expect(
      spreadsheetService.updateSpreadsheet(
        8,
        { workspaceId: 'workspace-1', actorUserId: 'member-2' },
        { name: '其他成员改名' },
      ),
    ).rejects.toMatchObject({
      name: 'SpreadsheetPermissionError',
      statusCode: 403,
    });
    expect(mockSpreadsheetRepository.updateOne).not.toHaveBeenCalled();
  });

  it('allows the owner to update folder and sharing metadata', async () => {
    const {
      spreadsheetService,
      mockSpreadsheetRepository,
      mockSpreadsheetSettingRepository,
      mockSpreadsheetHistoryRepository,
    } = createSpreadsheetServiceHarness();
    mockSpreadsheetRepository.findOneVisibleByRuntimeIdentity.mockResolvedValue(
      {
        id: 8,
        name: '日报',
        sql: 'select * from sales_daily',
        currentVersion: 1,
        actorUserId: 'owner-1',
        isShared: false,
        folderId: null,
      },
    );
    mockSpreadsheetRepository.updateOne.mockResolvedValue({
      id: 8,
      name: '日报',
      sql: 'select * from sales_daily',
      currentVersion: 1,
      actorUserId: 'owner-1',
      isShared: true,
      folderId: '运营日报',
    });
    mockSpreadsheetSettingRepository.findOneBySpreadsheetId.mockResolvedValue(
      null,
    );
    mockSpreadsheetHistoryRepository.findAllBySpreadsheetId.mockResolvedValue(
      [],
    );

    const result = await spreadsheetService.updateSpreadsheet(
      8,
      { workspaceId: 'workspace-1', actorUserId: 'owner-1' },
      { folderId: ' 运营日报 ', isShared: true },
    );

    expect(mockSpreadsheetRepository.updateOne).toHaveBeenCalledWith(8, {
      name: '日报',
      isShared: true,
      folderId: '运营日报',
      updatedBy: null,
    });
    expect(result.folderId).toBe('运营日报');
    expect(result.isShared).toBe(true);
  });
});

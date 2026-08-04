import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MasterDataService } from '../src/modules/master-data/master-data.service';

describe('personnel transaction history', () => {
  let service: MasterDataService;

  beforeEach(() => {
    service = new MasterDataService();
  });

  it('returns an empty commission transaction list for seeded personnel in memory mode', async () => {
    await expect(service.listPersonnelTransactions('personnel-driver-1', 'comp-demo')).resolves.toEqual([]);
  });

  it('validates personnel identity before listing transactions', async () => {
    await expect(service.listPersonnelTransactions('', 'comp-demo')).rejects.toThrow(BadRequestException);
    await expect(service.listPersonnelTransactions('missing-personnel', 'comp-demo')).rejects.toThrow(
      NotFoundException
    );
  });
});

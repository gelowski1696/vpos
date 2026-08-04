import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthRepository } from '../src/modules/auth/auth.repository';
import { AuthService } from '../src/modules/auth/auth.service';
import { MasterDataService } from '../src/modules/master-data/master-data.service';

describe('rider personnel users', () => {
  let authService: AuthService;
  let masterDataService: MasterDataService;

  beforeEach(() => {
    process.env.VPOS_AUTH_ALLOW_MEMORY_FALLBACK = 'true';
    const authRepository = new AuthRepository();
    authService = new AuthService(authRepository, new JwtService());
    masterDataService = new MasterDataService(undefined, undefined, undefined, authService);
  });

  it('creates, updates, deactivates, and deletes rider app logins assigned to personnel', async () => {
    const created = await masterDataService.createRiderUser(
      {
        username: ' Rider.01 ',
        password: 'StrongPass1',
        personnelId: 'personnel-driver-1'
      },
      'comp-demo'
    );

    expect(created).toMatchObject({
      username: 'rider.01',
      personnelId: 'personnel-driver-1',
      personnelName: 'Demo Driver',
      roles: ['rider'],
      isActive: true
    });
    await expect(
      authService.login('rider.01', 'StrongPass1', 'device-rider-1', undefined, { riderChannel: true })
    ).resolves.toMatchObject({ client_id: 'DEMO', must_change_password: false });
    await expect(authService.login('rider.01', 'StrongPass1', 'device-web-1')).rejects.toThrow(
      UnauthorizedException
    );
    await expect(
      masterDataService.createRiderUser(
        {
          username: 'rider.02',
          password: 'StrongPass1',
          personnelId: 'personnel-driver-1'
        },
        'comp-demo'
      )
    ).rejects.toThrow('Selected personnel already has a rider user login.');

    const updated = await masterDataService.updateRiderUser(
      created.id,
      {
        username: 'rider-02',
        password: 'NewStrong1',
        personnelId: 'personnel-helper-1'
      },
      'comp-demo'
    );

    expect(updated).toMatchObject({
      id: created.id,
      username: 'rider-02',
      personnelId: 'personnel-helper-1',
      personnelName: 'Demo Helper',
      isActive: true
    });
    await expect(
      authService.login('rider.01', 'StrongPass1', 'device-rider-old', undefined, { riderChannel: true })
    ).rejects.toThrow();
    await expect(
      authService.login('rider-02', 'NewStrong1', 'device-rider-2', undefined, { riderChannel: true })
    ).resolves.toMatchObject({ client_id: 'DEMO' });

    const deactivated = await masterDataService.safeDeleteRiderUser(created.id, 'comp-demo');
    expect(deactivated.isActive).toBe(false);
    await expect(
      authService.login('rider-02', 'NewStrong1', 'device-rider-3', undefined, { riderChannel: true })
    ).rejects.toThrow('Invalid credentials');

    const deleted = await masterDataService.hardDeleteRiderUser(created.id, 'comp-demo');
    expect(deleted.username).toBe('rider-02');
    await expect(masterDataService.listRiderUsers('comp-demo')).resolves.toEqual([]);
  });

  it('rejects unassigned users on the rider app channel', async () => {
    await authService.upsertManagedUser({
      id: 'user-unassigned-rider',
      company_id: 'comp-demo',
      username: 'loose-rider',
      email: 'loose-rider@rider.vpos.local',
      full_name: 'Loose Rider',
      roles: ['rider'],
      active: true,
      password: 'StrongPass1'
    });

    await expect(
      authService.login('loose-rider', 'StrongPass1', 'device-rider-loose', undefined, { riderChannel: true })
    ).rejects.toThrow('Rider app login is restricted to assigned rider accounts');
  });
});

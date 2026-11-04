import { DEFAULT_DESKTOP_APP_STATE, type DesktopAppState } from '../src/db/schema';
import { desktopDb } from '../src/db/sqlite';
import { desktopAuthService } from '../src/services/desktop-auth.service';
import { DesktopMasterDataService } from '../src/services/desktop-master-data.service';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('DesktopMasterDataService catalog resilience', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('continues required branch downloads when price lists return a server error', async () => {
    const state: DesktopAppState = {
      ...DEFAULT_DESKTOP_APP_STATE,
      setupCompleted: true,
      setup: {
        ...DEFAULT_DESKTOP_APP_STATE.setup,
        apiBaseUrl: 'http://localhost:3001/api',
        branchId: 'branch-1',
        locationId: 'location-1'
      },
      auth: {
        ...DEFAULT_DESKTOP_APP_STATE.auth,
        accessToken: 'test-token'
      }
    };

    jest.spyOn(desktopAuthService, 'authorizedFetch').mockImplementation(async (_state, url) => {
      if (url.endsWith('/master-data/price-lists')) {
        return { response: jsonResponse({ message: 'Internal server error' }, 500), state };
      }
      if (url.endsWith('/master-data/inventory/opening-stock')) {
        return { response: jsonResponse({ rows: [] }), state };
      }
      if (url.includes('/reports/sales/list')) {
        return { response: jsonResponse({ rows: [] }), state };
      }
      if (url.includes('/platform/')) {
        return { response: jsonResponse({ message: 'Unavailable' }, 503), state };
      }
      return { response: jsonResponse([]), state };
    });
    const replaceSpy = jest.spyOn(desktopDb, 'replaceMasterDataEntity').mockResolvedValue(undefined);

    const result = await new DesktopMasterDataService().syncCatalog(state, 'branch-1');

    expect(result.productCount).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Price lists were not refreshed (500');
    expect(replaceSpy).toHaveBeenCalledWith('product', []);
    expect(replaceSpy).not.toHaveBeenCalledWith('price_list', expect.anything());
  });

  it('keeps all active transfer destinations but caches only active applicable price lists', async () => {
    const state: DesktopAppState = {
      ...DEFAULT_DESKTOP_APP_STATE,
      setupCompleted: true,
      setup: {
        ...DEFAULT_DESKTOP_APP_STATE.setup,
        apiBaseUrl: 'http://localhost:3001/api',
        branchId: 'branch-1',
        locationId: 'location-1'
      },
      auth: { ...DEFAULT_DESKTOP_APP_STATE.auth, accessToken: 'test-token' }
    };
    jest.spyOn(desktopAuthService, 'authorizedFetch').mockImplementation(async (_state, url) => {
      if (url.endsWith('/master-data/locations')) {
        return { response: jsonResponse([
          { id: 'location-1', branchId: 'branch-1', name: 'Main', isActive: true },
          { id: 'location-2', branchId: 'branch-2', name: 'Second Branch', isActive: true },
          { id: 'location-3', branchId: 'branch-3', name: 'Closed', isActive: false }
        ]), state };
      }
      if (url.endsWith('/master-data/price-lists')) {
        return { response: jsonResponse([
          { id: 'price-active', scope: 'GLOBAL', isActive: true, rules: [] },
          { id: 'price-inactive', scope: 'GLOBAL', isActive: false, rules: [] },
          { id: 'price-other-branch', scope: 'BRANCH', branchId: 'branch-2', isActive: true, rules: [] }
        ]), state };
      }
      if (url.endsWith('/master-data/inventory/opening-stock')) {
        return { response: jsonResponse({ rows: [] }), state };
      }
      if (url.includes('/reports/sales/list')) {
        return { response: jsonResponse({ rows: [] }), state };
      }
      if (url.includes('/platform/')) {
        return { response: jsonResponse({ message: 'Unavailable' }, 503), state };
      }
      return { response: jsonResponse([]), state };
    });
    const replaceSpy = jest.spyOn(desktopDb, 'replaceMasterDataEntity').mockResolvedValue(undefined);

    await new DesktopMasterDataService().syncCatalog(state, 'branch-1');

    const locationCall = replaceSpy.mock.calls.find(([entity]) => entity === 'location');
    const priceListCall = replaceSpy.mock.calls.find(([entity]) => entity === 'price_list');
    expect(locationCall?.[1]).toHaveLength(2);
    expect(locationCall?.[1].map((row) => row.recordId)).toEqual(['location-1', 'location-2']);
    expect(priceListCall?.[1]).toHaveLength(1);
    expect(priceListCall?.[1][0].recordId).toBe('price-active');
  });
});

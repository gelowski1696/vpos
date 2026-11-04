import { assessDesktopUpdateSafety } from '../src/services/desktop-updater.service';

describe('desktop updater safety', () => {
  it('blocks installation while pending records or sync work exist', () => {
    const result = assessDesktopUpdateSafety({
      pendingOutboxCount: 3,
      hasActiveShift: false,
      syncBusy: true
    });
    expect(result.safe).toBe(false);
    expect(result.blockers.join(' ')).toContain('3 pending records');
    expect(result.blockers.join(' ')).toContain('synchronization');
  });

  it('warns but does not hard-block solely for an open shift', () => {
    const result = assessDesktopUpdateSafety({
      pendingOutboxCount: 0,
      hasActiveShift: true,
      syncBusy: false
    });
    expect(result.safe).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });

  it('allows installation on an idle and synchronized workstation', () => {
    expect(assessDesktopUpdateSafety({
      pendingOutboxCount: 0,
      hasActiveShift: false,
      syncBusy: false
    })).toEqual({ safe: true, blockers: [], warnings: [] });
  });
});

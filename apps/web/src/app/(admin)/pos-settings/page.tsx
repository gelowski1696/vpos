'use client';

import { useEffect, useMemo, useState } from 'react';
import { PosSettingsPanel } from '../../../components/pos-settings-panel';
import { apiRequest, getSessionRoles } from '../../../lib/api-client';
import {
  canManagePosSettings,
  DEFAULT_TENANT_POS_SETTINGS,
  toPosSettingsDraft,
  type PosSettingsAddonFlags,
  type PosSettingsControlKey,
  type TenantPosSettings,
  type TenantPosSettingsDraft
} from '../../../lib/pos-settings-policy';
import { toastError, toastSuccess } from '../../../lib/web-toast';

type CurrentEntitlementResponse = {
  addons?: Partial<PosSettingsAddonFlags>;
};

const DEFAULT_ADDONS: PosSettingsAddonFlags = {
  purchase_order_suite: false,
  delivery_dispatch_suite: false
};

export default function PosSettingsPage(): JSX.Element {
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [policy, setPolicy] = useState<TenantPosSettings>(DEFAULT_TENANT_POS_SETTINGS);
  const [draft, setDraft] = useState<TenantPosSettingsDraft>(() => toPosSettingsDraft(DEFAULT_TENANT_POS_SETTINGS));
  const [note, setNote] = useState('');
  const [addons, setAddons] = useState<PosSettingsAddonFlags>(DEFAULT_ADDONS);

  const canManage = useMemo(() => canManagePosSettings(roles), [roles]);
  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(toPosSettingsDraft(policy)) || note.trim().length > 0,
    [draft, note, policy]
  );

  async function load(): Promise<void> {
    const nextRoles = getSessionRoles();
    setRoles(nextRoles);
    if (!canManagePosSettings(nextRoles)) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [policyResponse, entitlement] = await Promise.all([
        apiRequest<TenantPosSettings>('/platform/pos-settings/current'),
        apiRequest<CurrentEntitlementResponse>('/platform/entitlements/current')
      ]);
      setPolicy(policyResponse);
      setDraft(toPosSettingsDraft(policyResponse));
      setAddons({
        purchase_order_suite: entitlement.addons?.purchase_order_suite === true,
        delivery_dispatch_suite: entitlement.addons?.delivery_dispatch_suite === true
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unable to load POS settings.';
      setError(message);
      toastError('Failed to load POS settings', { description: message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function handleToggle(key: PosSettingsControlKey, next: boolean): void {
    setDraft((current) => ({
      ...current,
      [key]: next
    }));
  }

  async function handleSave(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const response = await apiRequest<{ pos_settings: TenantPosSettings }>('/platform/pos-settings/current', {
        method: 'POST',
        body: {
          ...draft,
          reason: note.trim() || undefined
        }
      });
      setPolicy(response.pos_settings);
      setDraft(toPosSettingsDraft(response.pos_settings));
      setNote('');
      toastSuccess('POS settings updated', {
        description: 'Desktop policy changes will apply after the next branch-data refresh.'
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unable to save POS settings.';
      setError(message);
      toastError('Failed to save POS settings', { description: message });
    } finally {
      setSaving(false);
    }
  }

  function handleReset(): void {
    setDraft(toPosSettingsDraft(policy));
    setNote('');
  }

  if (loading) {
    return (
      <main className="space-y-4">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading POS settings...</p>
        </section>
      </main>
    );
  }

  if (!canManage) {
    return (
      <main className="space-y-4">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Unavailable</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            This page is not available for this web-admin session.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="space-y-4">
      {error ? (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">
          {error}
        </section>
      ) : null}

      <PosSettingsPanel
        addons={addons}
        canEdit={canManage}
        dirty={dirty}
        draft={draft}
        note={note}
        onNoteChange={setNote}
        onReset={handleReset}
        onSave={() => void handleSave()}
        onToggle={handleToggle}
        policy={policy}
        saving={saving}
      />
    </main>
  );
}

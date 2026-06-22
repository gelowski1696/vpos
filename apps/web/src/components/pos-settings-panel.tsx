import {
  POS_SETTINGS_CONTROL_GROUPS,
  type PosSettingsAddonFlags,
  type PosSettingsControlKey,
  type TenantPosSettings,
  type TenantPosSettingsDraft
} from '../lib/pos-settings-policy';

type Props = {
  policy: TenantPosSettings;
  draft: TenantPosSettingsDraft;
  note: string;
  dirty: boolean;
  saving: boolean;
  canEdit: boolean;
  addons: PosSettingsAddonFlags;
  onToggle: (key: PosSettingsControlKey, next: boolean) => void;
  onNoteChange: (value: string) => void;
  onSave: () => void;
  onReset: () => void;
};

function formatUpdatedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() === 0) {
    return 'Inherited default policy';
  }
  return parsed.toLocaleString();
}

export function PosSettingsPanel({
  policy,
  draft,
  note,
  dirty,
  saving,
  canEdit,
  addons,
  onToggle,
  onNoteChange,
  onSave,
  onReset
}: Props): JSX.Element {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            Tenant Controls
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">POS Settings</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
            Control which desktop POS modules remain operational for this tenant. Licensing add-ons still decide whether a feature exists. These settings decide whether the licensed module stays enabled on desktop.
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
          <p className="font-semibold text-slate-800 dark:text-slate-100">Last updated</p>
          <p className="mt-1">{formatUpdatedAt(policy.updated_at)}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {policy.updated_by ? `By ${policy.updated_by}` : 'No custom actor recorded yet'}
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {POS_SETTINGS_CONTROL_GROUPS.map((group) => (
          <section
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
            key={group.title}
          >
            <div className="mb-4">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{group.title}</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{group.description}</p>
            </div>

            <div className="space-y-3">
              {group.items.map((item) => {
                const addonEnabled = item.addon ? addons[item.addon] === true : true;
                const checked = draft[item.key];
                return (
                  <label
                    className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/70"
                    key={item.key}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.label}</span>
                        {item.addon ? (
                          <span className="rounded-full border border-indigo-300 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700 dark:border-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                            Requires add-on
                          </span>
                        ) : null}
                        {!addonEnabled ? (
                          <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                            Not enabled for this tenant
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{item.description}</p>
                    </div>
                    <input
                      aria-label={item.label}
                      checked={checked}
                      disabled={!canEdit || saving}
                      onChange={(event) => onToggle(item.key, event.target.checked)}
                      type="checkbox"
                    />
                  </label>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
          Optional audit note
          <textarea
            className="mt-2 min-h-28 w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-brandPrimary dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            disabled={!canEdit || saving}
            onChange={(event) => onNoteChange(event.target.value)}
            placeholder="Add context for why these desktop POS controls changed..."
            value={note}
          />
        </label>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            disabled={!dirty || saving}
            onClick={onReset}
            type="button"
          >
            Reset Draft
          </button>
          <button
            className="rounded-xl bg-brandPrimary px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!canEdit || !dirty || saving}
            onClick={onSave}
            type="button"
          >
            {saving ? 'Saving...' : 'Save POS Settings'}
          </button>
        </div>
      </section>
    </section>
  );
}

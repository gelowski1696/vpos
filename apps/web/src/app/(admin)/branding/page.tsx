'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { apiRequest, getSessionRoles } from '../../../lib/api-client';

type BrandingConfig = {
  companyName: string;
  companyLogo: string | null;
  logoLight: string | null;
  logoDark: string | null;
  receiptLogo: string | null;
  primaryColor: string;
  secondaryColor: string;
  receiptFooterText: string;
  invoiceNumberFormat: string;
  officialNumberFormat: string;
  updatedAt: string;
};

const defaults: BrandingConfig = {
  companyName: '',
  companyLogo: null,
  logoLight: null,
  logoDark: null,
  receiptLogo: null,
  primaryColor: '#0B3C5D',
  secondaryColor: '#328CC1',
  receiptFooterText: '',
  invoiceNumberFormat: '{BRANCH}-{YYYY}-{SEQ}',
  officialNumberFormat: 'OR-{YYYY}-{SEQ}',
  updatedAt: ''
};

export default function BrandingPage(): JSX.Element {
  const roles = useMemo(() => getSessionRoles(), []);
  const isPlatformOwner = roles.includes('platform_owner');
  const [form, setForm] = useState<BrandingConfig>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const config = await apiRequest<BrandingConfig>('/branding/config');
        setForm(config);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const themeStyle = useMemo(
    () => ({
      ['--brand-preview-primary' as string]: form.primaryColor,
      ['--brand-preview-secondary' as string]: form.secondaryColor
    }),
    [form.primaryColor, form.secondaryColor]
  );

  function setValue<K extends keyof BrandingConfig>(key: K, value: BrandingConfig[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const saved = await apiRequest<BrandingConfig>('/branding/config', {
        method: 'PUT',
        body: {
          companyName: form.companyName,
          companyLogo: form.companyLogo,
          logoLight: form.logoLight,
          logoDark: form.logoDark,
          receiptLogo: form.receiptLogo,
          primaryColor: form.primaryColor,
          secondaryColor: form.secondaryColor,
          receiptFooterText: form.receiptFooterText,
          invoiceNumberFormat: form.invoiceNumberFormat,
          officialNumberFormat: form.officialNumberFormat
        }
      });
      setForm(saved);
      setMessage('Branding saved successfully.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save branding.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">Loading branding configuration...</p>;
  }

  if (isPlatformOwner) {
    return (
      <section className="rounded-2xl border border-amber-300 bg-amber-50/95 p-5 text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
        <h1 className="text-xl font-semibold">Tenant Branding Only</h1>
        <p className="mt-2 text-sm">
          Branding configuration is managed inside each tenant context, not from the platform owner console.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link className="rounded-lg bg-brandPrimary px-3 py-2 text-sm font-semibold text-white" href="/tenants">
            Open Tenant Console
          </Link>
          <Link className="rounded-lg border border-amber-500 px-3 py-2 text-sm font-semibold text-amber-900 dark:text-amber-200" href={'/dashboard' as Route}>
            Open Dashboard
          </Link>
        </div>
      </section>
    );
  }

  return (
    <div style={themeStyle}>
      <h1 className="text-2xl font-bold text-brandPrimary">Branding Configuration</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Theme settings are applied to web admin and receipt rendering.</p>

      <form className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50 md:grid-cols-2" onSubmit={submit}>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Company Name</span>
          <input
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            onChange={(e) => setValue('companyName', e.target.value)}
            value={form.companyName}
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Primary Color</span>
          <input className="h-10 w-full rounded-lg border border-slate-300" onChange={(e) => setValue('primaryColor', e.target.value)} type="color" value={form.primaryColor} />
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Secondary Color</span>
          <input className="h-10 w-full rounded-lg border border-slate-300" onChange={(e) => setValue('secondaryColor', e.target.value)} type="color" value={form.secondaryColor} />
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Receipt Logo URL</span>
          <input
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            onChange={(e) => setValue('receiptLogo', e.target.value || null)}
            value={form.receiptLogo ?? ''}
          />
        </label>

        <label className="text-sm md:col-span-2">
          <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Receipt Footer Text</span>
          <textarea
            className="min-h-20 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            onChange={(e) => setValue('receiptFooterText', e.target.value)}
            value={form.receiptFooterText}
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Invoice Format</span>
          <input
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            onChange={(e) => setValue('invoiceNumberFormat', e.target.value)}
            value={form.invoiceNumberFormat}
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Official Receipt Format</span>
          <input
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            onChange={(e) => setValue('officialNumberFormat', e.target.value)}
            value={form.officialNumberFormat}
          />
        </label>

        <div className="md:col-span-2">
          <button className="rounded-lg bg-brandPrimary px-4 py-2 text-sm font-semibold text-white" disabled={saving} type="submit">
            {saving ? 'Saving...' : 'Save Branding'}
          </button>
        </div>
      </form>

      {message && <p className="mt-3 text-sm text-slate-700 dark:text-slate-200">{message}</p>}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800/50">
          <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-slate-100">Web Theme Preview</h2>
          <div className="rounded-xl p-4" style={{ background: `linear-gradient(120deg, ${form.primaryColor}, ${form.secondaryColor})` }}>
            <p className="text-sm font-semibold text-white">{form.companyName || 'Company Name'}</p>
            <p className="text-xs text-white/80">VPOS Admin Theme</p>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800/50">
          <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-slate-100">58mm Receipt Preview</h2>
          <div className="mx-auto w-[220px] rounded-md border border-slate-300 bg-white p-3 text-[11px] leading-tight">
            <p className="text-center font-bold">{form.companyName || 'Company Name'}</p>
            <p className="mt-1 text-center">OR: {form.officialNumberFormat}</p>
            <hr className="my-2" />
            <p>LPG Refill 11kg x1 .... 950.00</p>
            <p>Deposit ............... 1200.00</p>
            <hr className="my-2" />
            <p>Total ................. 2150.00</p>
            <p className="mt-2 text-center">{form.receiptFooterText || 'Footer text'}</p>
          </div>
        </section>
      </div>
    </div>
  );
}

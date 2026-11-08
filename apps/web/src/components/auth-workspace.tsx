'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';
import type { ReactNode } from 'react';

export function AuthWorkspace({
  badge,
  children,
  description,
  title
}: {
  badge: string;
  children: ReactNode;
  description: string;
  title: string;
}): React.JSX.Element {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f5f4f7] px-4 py-5 text-[#202024] sm:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(420px,560px)] lg:gap-5 lg:p-5">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_82%_12%,rgba(112,71,235,0.12),transparent_28%),radial-gradient(circle_at_12%_88%,rgba(89,54,207,0.08),transparent_32%)]" />

      <section className="relative hidden min-h-[calc(100vh-2.5rem)] overflow-hidden rounded-[1.25rem] bg-[#1e1d24] p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Image
              alt="VPOS logo"
              className="h-11 w-11 rounded-xl bg-white/95 p-1.5"
              height={44}
              priority
              src="/logo.png"
              width={44}
            />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-200">VMJAMTECH</p>
              <p className="text-sm font-semibold text-white">VPOS Operations</p>
            </div>
          </div>
          <div className="mt-20 max-w-xl">
            <p className="text-sm font-semibold text-violet-300">One workspace. Every operation.</p>
            <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-[-0.04em] xl:text-5xl">
              Run the day with clarity.
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-slate-300">
              Sales, inventory, customers, lending, pricing, and reports stay connected in a calm operational workspace.
            </p>
          </div>
        </div>

        <div className="max-w-2xl border-t border-white/10 pt-6">
          <div className="grid grid-cols-3 gap-4 text-sm">
            {['Live inventory', 'Role-aware access', 'Operational reports'].map((label, index) => (
              <div className="flex items-center gap-2 text-slate-300" key={label}>
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-400/15 text-xs font-semibold text-violet-200">
                  {index + 1}
                </span>
                {label}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative flex min-h-[calc(100vh-2.5rem)] items-center justify-center py-8 lg:py-12">
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
          initial={{ opacity: 0, y: 10 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <Image alt="VPOS logo" className="h-10 w-10 rounded-xl bg-white p-1 shadow-sm" height={40} priority src="/logo.png" width={40} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-700">VMJAMTECH</p>
              <p className="text-sm font-semibold">VPOS Operations</p>
            </div>
          </div>

          <div className="mb-8">
            <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-violet-700">
              {badge}
            </span>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-slate-950">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
          </div>

          {children}

          <p className="mt-8 border-t border-slate-200 pt-5 text-xs leading-5 text-slate-500">
            Protected access to your VPOS tenant. Activity is subject to your organization&apos;s roles and audit policy.
          </p>
        </motion.div>
      </section>
    </main>
  );
}

export const authFieldClassName =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-violet-500 focus:ring-4 focus:ring-violet-100';

export const authLabelClassName = 'mb-1.5 block text-sm font-semibold text-slate-700';

export const authRevealButtonClassName =
  'absolute right-2 top-1/2 min-h-8 -translate-y-1/2 rounded-md px-2 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600';

export const authSubmitClassName =
  'mt-2 w-full rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60';

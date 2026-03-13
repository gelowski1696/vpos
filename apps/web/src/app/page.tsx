import Link from 'next/link';
import type { Route } from 'next';

const adminLinks: Array<{ href: string; label: string }> = [
  { href: '/dashboard', label: 'dashboard' },
  { href: '/reports', label: 'reports' },
  { href: '/branches', label: 'branches' },
  { href: '/transfer-list', label: 'transfer-list' },
  { href: '/locations', label: 'locations' },
  { href: '/users', label: 'users' },
  { href: '/customers', label: 'customers' },
  { href: '/suppliers', label: 'suppliers' },
  { href: '/customer-payments', label: 'customer-payments' },
  { href: '/products', label: 'products' },
  { href: '/cylinder-types', label: 'cylinder-types' },
  { href: '/price-lists', label: 'price-lists' },
  { href: '/expenses', label: 'expenses' },
  { href: '/tenants', label: 'tenants' },
  { href: '/audit-logs', label: 'audit-logs' }
];

export default function HomePage(): JSX.Element {
  return (
    <main className="min-h-screen px-6 py-8">
      <div className="mx-auto max-w-6xl rounded-3xl border border-slate-200 bg-white/90 p-8 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <h1 className="text-3xl font-bold text-brandPrimary">VPOS Web Admin</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Online-only administration for LPG operations.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link className="rounded-lg bg-brandPrimary px-4 py-2 text-sm font-semibold text-white" href="/login">
            Login to Admin
          </Link>
          <Link className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-100" href={'/dashboard' as Route}>
            Open Dashboard
          </Link>
        </div>
        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {adminLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href as Route}
              className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-brandSecondary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}

'use client';

import type { Route } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { apiRequest, clearAuthSession, getAccessToken, getSessionRoles } from '../lib/api-client';

type ThemeMode = 'light' | 'dark';

type BrandingTheme = {
  companyName: string;
  primaryColor: string;
  secondaryColor: string;
};

type NavItem = {
  href: Route;
  label: string;
  icon: NavIconName;
  badge?: string;
};

type NavIconName =
  | 'dashboard'
  | 'sales'
  | 'transfer'
  | 'branch'
  | 'location'
  | 'users'
  | 'customer'
  | 'supplier'
  | 'customerPayment'
  | 'product'
  | 'cylinder'
  | 'pricing'
  | 'costing'
  | 'expense'
  | 'branding'
  | 'audit'
  | 'tenant'
  | 'syncReview';

const THEME_STORAGE_KEY = 'vpos_admin_theme';
const SIDEBAR_STORAGE_KEY = 'vpos_admin_sidebar_collapsed';

const NAV_SECTIONS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: 'Overview',
    items: [
      { href: '/dashboard' as Route, label: 'Dashboard', icon: 'dashboard' },
      { href: '/reports', label: 'Reports', icon: 'audit' }
    ]
  },
  {
    title: 'Sales',
    items: [
      { href: '/sales-list' as Route, label: 'Sales List', icon: 'sales' },
      { href: '/customer-payments' as Route, label: 'Customer Payments', icon: 'customerPayment' },
      { href: '/customers', label: 'Customers', icon: 'customer' }
    ]
  },
  {
    title: 'Inventory',
    items: [
      { href: '/products', label: 'Products', icon: 'product' },
      { href: '/product-categories' as Route, label: 'Product Categories', icon: 'product' },
      { href: '/product-brands' as Route, label: 'Product Brands', icon: 'product' },
      { href: '/cylinder-types', label: 'Cylinder Types', icon: 'cylinder' },
      { href: '/inventory-opening' as Route, label: 'Opening Stock', icon: 'product' },
      { href: '/price-lists', label: 'Price Lists', icon: 'pricing' },
      { href: '/costing', label: 'Costing Setup', icon: 'costing' }
    ]
  },
  {
    title: 'Stock Movement',
    items: [
      { href: '/transfer-list' as Route, label: 'Transfer List', icon: 'transfer' },
      { href: '/branches', label: 'Branches', icon: 'branch' },
      { href: '/locations', label: 'Locations', icon: 'location' },
      { href: '/users', label: 'Users', icon: 'users' },
      { href: '/personnels', label: 'Personnel', icon: 'users' },
      { href: '/suppliers' as Route, label: 'Suppliers', icon: 'supplier' }
    ]
  },
  {
    title: 'Settings',
    items: [
      { href: '/branding', label: 'Branding', icon: 'branding', badge: 'Theme' },
      { href: '/personnel-roles', label: 'Personnel Roles', icon: 'users' },
      { href: '/expenses', label: 'Expense Categories', icon: 'expense' },
      { href: '/sync-reviews' as Route, label: 'Sync Reviews', icon: 'syncReview' },
      { href: '/audit-logs', label: 'Audit Logs', icon: 'audit' }
    ]
  },
  {
    title: 'Platform',
    items: [
      { href: '/tenants', label: 'Tenants', icon: 'tenant' }
    ]
  }
];

const PLATFORM_OWNER_ALLOWED_ROUTES: Route[] = [
  '/tenants',
  '/audit-logs',
  '/sync-reviews' as Route,
  '/branches',
  '/locations',
  '/users'
];

function routeIsActive(pathname: string, href: Route): boolean {
  if (pathname === href) {
    return true;
  }
  return pathname.startsWith(`${href}/`);
}

function resolveInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'light';
  }

  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') {
    return stored;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function NavIcon({ name, className }: { name: NavIconName; className?: string }): JSX.Element {
  switch (name) {
    case 'dashboard':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path d="M4 4h7v7H4V4ZM13 4h7v4h-7V4ZM13 10h7v10h-7V10ZM4 13h7v7H4v-7Z" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case 'sales':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path d="M4 5h16v14H4zM8 9h8M8 13h5M8 17h4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        </svg>
      );
    case 'transfer':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path d="M4 7h12m0 0-3-3m3 3-3 3M20 17H8m0 0 3-3m-3 3 3 3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
        </svg>
      );
    case 'branch':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path d="M3 20h18M6 20V8l6-4 6 4v12M9 10h.01M12 10h.01M15 10h.01M9 14h.01M12 14h.01M15 14h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        </svg>
      );
    case 'location':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11Z" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="12" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case 'users':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path d="M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        </svg>
      );
    case 'customer':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path d="M3 20v-1a5 5 0 0 1 5-5h8a5 5 0 0 1 5 5v1M12 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case 'supplier':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path d="M3 20v-2a4 4 0 0 1 4-4h4m10 6v-4l-3-2h-4v6M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
          <circle cx="16.5" cy="18.5" r="1.5" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="20.5" cy="18.5" r="1.5" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case 'customerPayment':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path d="M3 20v-1a5 5 0 0 1 5-5h4M10 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M14 14h7M17.5 11.5v5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        </svg>
      );
    case 'product':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path d="m12 3 9 4.5-9 4.5L3 7.5 12 3ZM3 12l9 4.5 9-4.5M3 16.5 12 21l9-4.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
        </svg>
      );
    case 'cylinder':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path d="M9 6V4h6v2M8 6h8a2 2 0 0 1 2 2v10a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case 'pricing':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path d="M12 2v20M17 6.5a3.5 3.5 0 0 0-3.5-2.5h-3A3.5 3.5 0 0 0 7 7.5c0 2 1.6 3.5 3.5 3.5h3A3.5 3.5 0 0 1 17 14.5 3.5 3.5 0 0 1 13.5 18h-3A3.5 3.5 0 0 1 7 15.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        </svg>
      );
    case 'costing':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path
            d="M4 7h16M4 12h16M4 17h16M9 7v10M15 7v10"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.8"
          />
          <circle cx="9" cy="12" r="2.2" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="15" cy="7" r="2.2" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case 'expense':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path d="M4 7h16M7 4h10M6 11h12M8 15h8M10 19h4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        </svg>
      );
    case 'branding':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path d="M12 3a9 9 0 0 0 0 18h1.6a2.4 2.4 0 0 0 2.4-2.4 2.4 2.4 0 0 0-.8-1.8 2.4 2.4 0 0 1-.8-1.8 2.4 2.4 0 0 1 2.4-2.4h2.2A3 3 0 0 0 22 9.6C21.6 5.8 17.2 3 12 3Z" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="7.5" cy="10" r="1" fill="currentColor" />
          <circle cx="10.5" cy="7.5" r="1" fill="currentColor" />
          <circle cx="14" cy="7.5" r="1" fill="currentColor" />
        </svg>
      );
    case 'audit':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path d="M4 5h12l4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M16 5v4h4M8 13h8M8 17h6M8 9h2" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        </svg>
      );
    case 'syncReview':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path d="M12 4a8 8 0 1 1-7.1 4.3M4 4v5h5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
          <path d="M12 8v5l3 2" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        </svg>
      );
    case 'tenant':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24">
          <path d="M4 20v-2.5A3.5 3.5 0 0 1 7.5 14h9a3.5 3.5 0 0 1 3.5 3.5V20M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M18.5 8.5h3M20 7v3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        </svg>
      );
    default:
      return <svg className={className} />;
  }
}

export function AdminShell({ children }: { children: React.ReactNode }): JSX.Element {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>('light');
  const [brandName, setBrandName] = useState('VPOS');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [roles, setRoles] = useState<string[]>([]);

  useEffect(() => {
    const initialTheme = resolveInitialTheme();
    setTheme(initialTheme);
    document.documentElement.classList.toggle('dark', initialTheme === 'dark');

    const storedSidebar = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    setSidebarCollapsed(storedSidebar === '1');

    setHasToken(Boolean(getAccessToken()));
    setRoles(getSessionRoles());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || !hasToken) {
      return;
    }

    (async () => {
      try {
        const branding = await apiRequest<BrandingTheme>('/branding/config');
        if (branding.companyName) {
          setBrandName(branding.companyName);
        }
        if (branding.primaryColor) {
          document.documentElement.style.setProperty('--brand-primary', branding.primaryColor);
        }
        if (branding.secondaryColor) {
          document.documentElement.style.setProperty('--brand-secondary', branding.secondaryColor);
        }
      } catch {
        // Keep defaults if branding fetch fails.
      }
    })();
  }, [ready, hasToken]);

  const canManageOrgStructure = useMemo(
    () => roles.includes('owner') || roles.includes('platform_owner'),
    [roles]
  );
  const canAccessWebAdmin = useMemo(
    () => roles.includes('admin') || roles.includes('owner') || roles.includes('platform_owner'),
    [roles]
  );
  const canViewOrgStructure = useMemo(
    () => canManageOrgStructure || roles.includes('admin'),
    [canManageOrgStructure, roles]
  );
  const isPlatformOwner = useMemo(() => roles.includes('platform_owner'), [roles]);
  const canViewAuditLogs = useMemo(
    () => roles.includes('admin') || roles.includes('owner') || roles.includes('platform_owner'),
    [roles]
  );

  const visibleNavSections = useMemo(
    () =>
      NAV_SECTIONS.map((section) => ({
        ...section,
        items: section.items.filter((item) => {
          if (isPlatformOwner) {
            return PLATFORM_OWNER_ALLOWED_ROUTES.includes(item.href);
          }

          if (item.href === '/tenants') {
            return false;
          }

          if (item.href === '/audit-logs' && !canViewAuditLogs) {
            return false;
          }

          if (
            !canViewOrgStructure &&
            (item.href === '/branches' || item.href === '/locations' || item.href === '/users')
          ) {
            return false;
          }
          return true;
        })
      })).filter((section) => section.items.length > 0),
    [canViewOrgStructure, canViewAuditLogs, isPlatformOwner]
  );

  const visibleNavItems = useMemo(() => visibleNavSections.flatMap((section) => section.items), [visibleNavSections]);

  const active = useMemo(() => pathname ?? '/', [pathname]);
  const platformOwnerRouteBlocked = useMemo(
    () =>
      isPlatformOwner &&
      !PLATFORM_OWNER_ALLOWED_ROUTES.some((route) => routeIsActive(active, route)),
    [active, isPlatformOwner]
  );
  const pageTitle = useMemo(() => visibleNavItems.find((item) => routeIsActive(active, item.href))?.label ?? 'Web Admin', [active, visibleNavItems]);

  function switchTheme(nextTheme: ThemeMode): void {
    setTheme(nextTheme);
    document.documentElement.classList.toggle('dark', nextTheme === 'dark');
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  }

  function toggleSidebar(): void {
    const nextValue = !sidebarCollapsed;
    setSidebarCollapsed(nextValue);
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, nextValue ? '1' : '0');
  }

  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="rounded-2xl border border-amber-300/35 bg-black/70 px-6 py-4 text-sm text-amber-100 shadow-sm">
          Loading admin workspace...
        </div>
      </main>
    );
  }

  if (!hasToken) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <section className="mx-auto w-full max-w-xl rounded-2xl border border-amber-300/45 bg-black/75 p-6 text-amber-100 shadow-sm">
          <h1 className="text-xl font-semibold">Authentication Required</h1>
          <p className="mt-2 text-sm">Please login to access the VPOS Web Admin modules.</p>
          <Link className="mt-4 inline-flex rounded-lg bg-amber-300 px-4 py-2 text-sm font-semibold text-slate-900" href="/login">
            Go to Login
          </Link>
        </section>
      </main>
    );
  }

  if (!canAccessWebAdmin) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <section className="mx-auto w-full max-w-xl rounded-2xl border border-amber-300/45 bg-black/75 p-6 text-amber-100 shadow-sm">
          <h1 className="text-xl font-semibold">Web Admin Access Required</h1>
          <p className="mt-2 text-sm">This account is intended for mobile/POS use. Login using an owner/admin account for Web Admin.</p>
          <div className="mt-4 flex gap-2">
            <button
              className="rounded-lg bg-amber-300 px-4 py-2 text-sm font-semibold text-slate-900"
              onClick={() => {
                clearAuthSession();
                window.location.href = '/login';
              }}
              type="button"
            >
              Back to Login
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <div className="min-h-screen">
      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden border-r border-amber-300/20 bg-black/90 text-amber-50 shadow-2xl shadow-black/70 transition-[width] duration-200 md:block ${sidebarCollapsed ? 'w-20' : 'w-72'}`}
      >
        <div className={`flex h-16 items-center border-b border-amber-300/20 ${sidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-6'}`}>
          <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg border border-amber-300/50 bg-black/70">
            <Image src="/logo.png" alt="VPOS logo" width={32} height={32} className="h-8 w-8 object-contain p-0.5" />
          </div>
          {!sidebarCollapsed ? (
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-amber-300/80">System</p>
              <p className="text-base font-semibold text-amber-100">{brandName}</p>
            </div>
          ) : null}
        </div>

        <div className={`h-[calc(100vh-4rem)] overflow-y-auto py-5 ${sidebarCollapsed ? 'px-2' : 'px-4'}`}>
          {visibleNavSections.map((section) => (
            <div className="mb-6" key={section.title}>
              {!sidebarCollapsed ? (
                <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-[0.18em] text-amber-300/70">{section.title}</p>
              ) : null}
              <nav className="space-y-1">
                {section.items.map((item) => {
                  const isActive = routeIsActive(active, item.href);
                  return (
                    <Link
                      className={`flex items-center rounded-xl px-3 py-2 text-sm transition ${sidebarCollapsed ? 'justify-center' : 'justify-between'} ${
                        isActive
                          ? 'bg-amber-300 text-slate-900 shadow-lg shadow-black/30'
                          : 'text-amber-50/90 hover:bg-amber-300/12 hover:text-amber-200'
                      }`}
                      href={item.href}
                      key={item.href}
                      title={item.label}
                    >
                      {sidebarCollapsed ? (
                        <NavIcon className="h-4 w-4" name={item.icon} />
                      ) : (
                        <>
                          <span className="flex items-center gap-2">
                            <NavIcon className="h-4 w-4" name={item.icon} />
                            <span>{item.label}</span>
                          </span>
                          {item.badge ? (
                            <span className="rounded-md bg-amber-300/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-100">
                              {item.badge}
                            </span>
                          ) : null}
                        </>
                      )}
                    </Link>
                  );
                })}
              </nav>
            </div>
          ))}
        </div>
      </aside>

      <div className={`transition-[padding] duration-200 ${sidebarCollapsed ? 'md:pl-20' : 'md:pl-72'}`}>
        <header className="sticky top-0 z-20 border-b border-amber-300/20 bg-black/85 backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6">
            <div className="flex min-w-[220px] flex-1 items-center gap-2">
              <button
                aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                className="hidden rounded-lg border border-amber-300/40 p-2 text-amber-100 hover:bg-amber-300/10 md:inline-flex"
                onClick={toggleSidebar}
                type="button"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24">
                  {sidebarCollapsed ? (
                    <path d="M9 6l6 6-6 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                  ) : (
                    <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                  )}
                </svg>
              </button>
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-amber-300/70">{brandName}</p>
                <h1 className="text-lg font-semibold text-amber-100">{pageTitle}</h1>
              </div>
            </div>

            <div className="flex w-full max-w-xl items-center gap-2 rounded-xl border border-amber-300/30 bg-white/10 px-3 py-2 md:w-auto md:flex-1">
              <svg aria-hidden="true" className="h-4 w-4 text-amber-200/70" fill="none" viewBox="0 0 24 24">
                <path d="M21 21L16.65 16.65M10 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
              </svg>
              <input
                className="w-full bg-transparent text-sm text-amber-50 outline-none placeholder:text-amber-200/45"
                placeholder="Type to search module, customer, product..."
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
                className="rounded-lg border border-amber-300/40 p-2 text-amber-100 transition hover:bg-amber-300/10"
                onClick={() => switchTheme(theme === 'light' ? 'dark' : 'light')}
                type="button"
              >
                {theme === 'light' ? (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <path
                      d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 1 0 9.8 9.8Z"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                    />
                  </svg>
                ) : (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
                    <path
                      d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeWidth="2"
                    />
                  </svg>
                )}
              </button>
              <button
                className="rounded-lg border border-amber-300/40 bg-amber-300 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-900 transition hover:bg-amber-200"
                onClick={() => {
                  clearAuthSession();
                  window.location.href = '/login';
                }}
                type="button"
              >
                Logout
              </button>
            </div>
          </div>

          <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-3 md:hidden">
            {visibleNavItems.map((item) => {
              const isActive = routeIsActive(active, item.href);
              return (
                <Link
                  className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold ${isActive ? 'bg-amber-300 text-slate-900' : 'border border-amber-300/40 text-amber-100'}`}
                  href={item.href}
                  key={item.href}
                >
                  <span className="flex items-center gap-1.5">
                    <NavIcon className="h-3.5 w-3.5" name={item.icon} />
                    <span>{item.label}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </header>

        <main className="px-4 py-4 md:px-6 md:py-5">
          <section className="rounded-2xl border border-amber-300/20 bg-black/55 p-4 shadow-sm md:p-6">
            {platformOwnerRouteBlocked ? (
              <div className="rounded-2xl border border-amber-300/45 bg-amber-300/12 p-5 text-amber-100">
                <h2 className="text-xl font-semibold">Platform Console Scope</h2>
                <p className="mt-2 text-sm">
                  This module is outside the current platform-owner menu scope. Use Tenants, Branches, Locations, Users, Sync Reviews, and Audit Logs from the left menu.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link className="rounded-lg bg-amber-300 px-3 py-2 text-sm font-semibold text-slate-900" href="/tenants">
                    Open Tenants
                  </Link>
                  <Link className="rounded-lg border border-amber-300/45 px-3 py-2 text-sm font-semibold text-amber-100" href="/audit-logs">
                    Open Audit Logs
                  </Link>
                </div>
              </div>
            ) : (
              children
            )}
          </section>
        </main>
      </div>
    </div>
  );
}

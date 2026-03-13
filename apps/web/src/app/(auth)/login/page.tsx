'use client';

import Image from 'next/image';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { apiRequest, clearAuthSession, getSessionRoles, saveAuthSession } from '../../../lib/api-client';

export default function LoginPage(): JSX.Element {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await apiRequest<{
        access_token: string;
        refresh_token: string;
        client_id: string;
      }>('/auth/login', {
        method: 'POST',
        auth: false,
        omitClientId: true,
        body: {
          email,
          password,
          device_id: 'web-admin'
        }
      });

      saveAuthSession(response.access_token, response.refresh_token, response.client_id);
      const roles = getSessionRoles();
      const canAccessWebAdmin = roles.some((role) => role === 'admin' || role === 'owner' || role === 'platform_owner');
      if (!canAccessWebAdmin) {
        clearAuthSession();
        setError('This account is not allowed in Web Admin. Use an owner/admin account.');
        return;
      }

      if (roles.includes('platform_owner')) {
        router.push('/tenants');
      } else {
        router.push('/dashboard' as Route);
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_12%_10%,rgba(240,200,111,0.18),transparent_35%),radial-gradient(circle_at_88%_6%,rgba(182,138,61,0.18),transparent_30%),linear-gradient(130deg,#060606,#15110b,#050505)] px-4 py-8 sm:px-6">
      <section className="w-full max-w-md rounded-3xl border border-amber-300/35 bg-black/65 p-5 shadow-2xl shadow-black/50 backdrop-blur-md sm:p-6">
        <div className="mb-4 flex items-center gap-3">
          <Image
            src="/logo.png"
            alt="VPOS logo"
            width={44}
            height={44}
            className="h-11 w-11 rounded-lg border border-amber-300/60 bg-black/30 p-1"
            priority
          />
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-amber-300/90">VMJAMTECH</p>
            <p className="text-sm font-semibold text-amber-100">VPOS Platform</p>
          </div>
        </div>

        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-amber-200">Admin Login</h2>
          <span className="rounded-full border border-amber-300/40 bg-amber-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-100">
            Secure
          </span>
        </div>
        <p className="text-sm text-slate-300">Use your owner/admin credentials to continue.</p>

        <form autoComplete="off" className="mt-5 space-y-3" onSubmit={onSubmit}>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-amber-100">Email</span>
            <input
              autoComplete="off"
              autoCorrect="off"
              className="w-full rounded-xl border border-amber-300/35 bg-slate-900/85 px-3 py-2.5 text-amber-50 placeholder:text-slate-400 outline-none transition focus:border-amber-200/75 focus:ring-2 focus:ring-amber-300/20"
              name="vpos_email"
              onChange={(event) => setEmail(event.target.value)}
              required
              spellCheck={false}
              type="email"
              value={email}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-amber-100">Password</span>
            <div className="relative">
              <input
                autoComplete="new-password"
                className="w-full rounded-xl border border-amber-300/35 bg-slate-900/85 px-3 py-2.5 pr-11 text-amber-50 placeholder:text-slate-400 outline-none transition focus:border-amber-200/75 focus:ring-2 focus:ring-amber-300/20"
                name="vpos_password"
                onChange={(event) => setPassword(event.target.value)}
                required
                type={showPassword ? 'text' : 'password'}
                value={password}
              />
              <button
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-amber-300/40 px-2 py-1 text-xs text-amber-100 hover:bg-amber-300/10"
                onClick={() => setShowPassword((prev) => !prev)}
                type="button"
              >
                {showPassword ? (
                  <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <path d="M3 3l18 18" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
                    <path d="M10.6 10.6A2 2 0 0013.4 13.4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
                    <path d="M9.9 5.2A10.8 10.8 0 0121 12c-.8 1.8-2 3.3-3.5 4.6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
                    <path d="M6.2 6.2A11.1 11.1 0 003 12c1.7 3.7 5.1 6 9 6 1 0 2-.2 3-.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
                  </svg>
                ) : (
                  <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" stroke="currentColor" strokeWidth="1.7" />
                    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
                  </svg>
                )}
              </button>
            </div>
          </label>

          <button
            className="mt-1 w-full rounded-xl bg-amber-300 px-4 py-2.5 font-semibold text-slate-900 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-70"
            disabled={loading}
            type="submit"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
      </section>
    </main>
  );
}

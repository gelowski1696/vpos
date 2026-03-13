'use client';

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
    <main className="min-h-screen px-6 py-10">
      <section className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white/95 p-6 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        <h1 className="text-2xl font-bold text-brandPrimary">VPOS Admin Login</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Authenticate to access online master data and branding modules.</p>

        <form autoComplete="off" className="mt-5 space-y-3" onSubmit={onSubmit}>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Email</span>
            <input
              autoComplete="off"
              autoCorrect="off"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              name="vpos_email"
              onChange={(event) => setEmail(event.target.value)}
              required
              spellCheck={false}
              type="email"
              value={email}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Password</span>
            <div className="relative">
              <input
                autoComplete="new-password"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-11 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                name="vpos_password"
                onChange={(event) => setPassword(event.target.value)}
                required
                type={showPassword ? 'text' : 'password'}
                value={password}
              />
              <button
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700"
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

          <button className="w-full rounded-lg bg-brandPrimary px-4 py-2 font-semibold text-white" disabled={loading} type="submit">
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}
      </section>
    </main>
  );
}

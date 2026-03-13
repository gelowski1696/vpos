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
    <main className="min-h-screen bg-[radial-gradient(circle_at_15%_10%,rgba(240,200,111,0.18),transparent_35%),radial-gradient(circle_at_85%_10%,rgba(182,138,61,0.16),transparent_32%),linear-gradient(125deg,#060606,#16120d,#050505)] px-6 py-10">
      <section className="mx-auto max-w-md rounded-2xl border border-amber-300/40 bg-black/65 p-6 shadow-2xl shadow-black/60 backdrop-blur">
        <div className="mb-4 flex items-center gap-3">
          <Image
            src="/logo.png"
            alt="VPOS logo"
            width={42}
            height={42}
            className="h-10 w-10 rounded-lg border border-amber-300/60 bg-black/40 object-cover p-1"
            priority
          />
          <div>
            <p className="text-[10px] uppercase tracking-[0.22em] text-amber-300/90">VMJAMTECH</p>
            <p className="text-sm font-semibold text-amber-100">VPOS Platform</p>
          </div>
        </div>
        <h1 className="text-2xl font-bold text-amber-200">VPOS Admin Login</h1>
        <p className="mt-1 text-sm text-slate-300">Authenticate to access online master data and branding modules.</p>

        <form autoComplete="off" className="mt-5 space-y-3" onSubmit={onSubmit}>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-amber-100">Email</span>
            <input
              autoComplete="off"
              autoCorrect="off"
              className="w-full rounded-lg border border-amber-300/40 bg-slate-900/80 px-3 py-2 text-amber-50 placeholder:text-slate-400"
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
                className="w-full rounded-lg border border-amber-300/40 bg-slate-900/80 px-3 py-2 pr-11 text-amber-50 placeholder:text-slate-400"
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

          <button className="w-full rounded-lg bg-amber-300 px-4 py-2 font-semibold text-slate-900 hover:bg-amber-200" disabled={loading} type="submit">
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
      </section>
    </main>
  );
}

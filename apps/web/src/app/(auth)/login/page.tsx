'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import {
  apiRequest,
  clearAuthSession,
  getSessionRequiresPasswordChange,
  getSessionRoles,
  saveAuthSession
} from '../../../lib/api-client';
import {
  AuthWorkspace,
  authFieldClassName,
  authLabelClassName,
  authRevealButtonClassName,
  authSubmitClassName
} from '../../../components/auth-workspace';

export default function LoginPage(): React.JSX.Element {
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
        must_change_password?: boolean;
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
      const mustChangePassword = response.must_change_password === true || getSessionRequiresPasswordChange();
      if (mustChangePassword) {
        router.push('/change-password' as Route);
        return;
      }

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
    <AuthWorkspace
      badge="Secure admin access"
      description="Use your owner or administrator credentials to continue to the operations workspace."
      title="Welcome back"
    >
        <form autoComplete="off" className="space-y-4" onSubmit={onSubmit}>
          <label className="block text-sm">
            <span className={authLabelClassName}>Email address</span>
            <input
              autoComplete="off"
              autoCorrect="off"
              className={authFieldClassName}
              name="vpos_email"
              onChange={(event) => setEmail(event.target.value)}
              required
              spellCheck={false}
              type="email"
              value={email}
            />
          </label>

          <label className="block text-sm">
            <span className={authLabelClassName}>Password</span>
            <div className="relative">
              <input
                autoComplete="new-password"
                className={`${authFieldClassName} pr-16`}
                name="vpos_password"
                onChange={(event) => setPassword(event.target.value)}
                required
                type={showPassword ? 'text' : 'password'}
                value={password}
              />
              <button
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className={authRevealButtonClassName}
                onClick={() => setShowPassword((prev) => !prev)}
                type="button"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>

          <button
            className={authSubmitClassName}
            disabled={loading}
            type="submit"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        {error && <p aria-live="polite" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error}</p>}
    </AuthWorkspace>
  );
}

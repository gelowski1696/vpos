'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import {
  apiRequest,
  clearAuthSession,
  getAccessToken,
  getSessionRequiresPasswordChange
} from '../../../lib/api-client';
import {
  AuthWorkspace,
  authFieldClassName,
  authLabelClassName,
  authRevealButtonClassName,
  authSubmitClassName
} from '../../../components/auth-workspace';

export default function ChangePasswordPage(): React.JSX.Element {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const hasToken = Boolean(getAccessToken());
    if (!hasToken) {
      router.replace('/login' as Route);
      return;
    }

    if (!getSessionRequiresPasswordChange()) {
      router.replace('/dashboard' as Route);
    }
  }, [router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const trimmedCurrent = currentPassword.trim();
    const trimmedNew = newPassword.trim();
    const trimmedConfirm = confirmPassword.trim();

    if (trimmedNew.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }

    if (trimmedCurrent === trimmedNew) {
      setError('New password must be different from current password.');
      return;
    }

    if (trimmedNew !== trimmedConfirm) {
      setError('Confirm password does not match.');
      return;
    }

    setLoading(true);
    try {
      await apiRequest<{ success: true }>('/auth/change-password', {
        method: 'POST',
        body: {
          current_password: trimmedCurrent,
          new_password: trimmedNew
        }
      });

      clearAuthSession();
      setSuccess('Password changed successfully. Please login again.');
      window.setTimeout(() => {
        router.replace('/login' as Route);
      }, 650);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to change password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthWorkspace
      badge="Security update required"
      description="For first-login security, choose a new tenant password before opening the operations workspace."
      title="Set a new password"
    >
        <form autoComplete="off" className="space-y-4" onSubmit={onSubmit}>
          <label className="block text-sm">
            <span className={authLabelClassName}>Current password</span>
            <div className="relative">
              <input
                autoComplete="current-password"
                className={`${authFieldClassName} pr-16`}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
                type={showCurrent ? 'text' : 'password'}
                value={currentPassword}
              />
              <button
                aria-label={showCurrent ? 'Hide current password' : 'Show current password'}
                className={authRevealButtonClassName}
                onClick={() => setShowCurrent((prev) => !prev)}
                type="button"
              >
                {showCurrent ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>

          <label className="block text-sm">
            <span className={authLabelClassName}>New password</span>
            <div className="relative">
              <input
                autoComplete="new-password"
                className={`${authFieldClassName} pr-16`}
                onChange={(event) => setNewPassword(event.target.value)}
                required
                type={showNew ? 'text' : 'password'}
                value={newPassword}
              />
              <button
                aria-label={showNew ? 'Hide new password' : 'Show new password'}
                className={authRevealButtonClassName}
                onClick={() => setShowNew((prev) => !prev)}
                type="button"
              >
                {showNew ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>

          <label className="block text-sm">
            <span className={authLabelClassName}>Confirm new password</span>
            <div className="relative">
              <input
                autoComplete="new-password"
                className={`${authFieldClassName} pr-16`}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                type={showConfirm ? 'text' : 'password'}
                value={confirmPassword}
              />
              <button
                aria-label={showConfirm ? 'Hide password confirmation' : 'Show password confirmation'}
                className={authRevealButtonClassName}
                onClick={() => setShowConfirm((prev) => !prev)}
                type="button"
              >
                {showConfirm ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>

          <button
            className={authSubmitClassName}
            disabled={loading}
            type="submit"
          >
            {loading ? 'Updating...' : 'Update Password'}
          </button>
        </form>

        {error && <p aria-live="polite" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error}</p>}
        {success && <p aria-live="polite" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">{success}</p>}
    </AuthWorkspace>
  );
}

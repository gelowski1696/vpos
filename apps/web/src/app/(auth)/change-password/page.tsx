'use client';

import Image from 'next/image';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import {
  apiRequest,
  clearAuthSession,
  getAccessToken,
  getSessionRequiresPasswordChange
} from '../../../lib/api-client';

export default function ChangePasswordPage(): JSX.Element {
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
          <h2 className="text-2xl font-bold text-amber-200">Change Password</h2>
          <span className="rounded-full border border-amber-300/40 bg-amber-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-100">
            Required
          </span>
        </div>
        <p className="text-sm text-slate-300">For first login security, update your tenant password before continuing.</p>

        <form autoComplete="off" className="mt-5 space-y-3" onSubmit={onSubmit}>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-amber-100">Current Password</span>
            <div className="relative">
              <input
                autoComplete="current-password"
                className="w-full rounded-xl border border-amber-300/35 bg-slate-900/85 px-3 py-2.5 pr-11 text-amber-50 placeholder:text-slate-400 outline-none transition focus:border-amber-200/75 focus:ring-2 focus:ring-amber-300/20"
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
                type={showCurrent ? 'text' : 'password'}
                value={currentPassword}
              />
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-amber-300/40 px-2 py-1 text-xs text-amber-100 hover:bg-amber-300/10"
                onClick={() => setShowCurrent((prev) => !prev)}
                type="button"
              >
                {showCurrent ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-amber-100">New Password</span>
            <div className="relative">
              <input
                autoComplete="new-password"
                className="w-full rounded-xl border border-amber-300/35 bg-slate-900/85 px-3 py-2.5 pr-11 text-amber-50 placeholder:text-slate-400 outline-none transition focus:border-amber-200/75 focus:ring-2 focus:ring-amber-300/20"
                onChange={(event) => setNewPassword(event.target.value)}
                required
                type={showNew ? 'text' : 'password'}
                value={newPassword}
              />
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-amber-300/40 px-2 py-1 text-xs text-amber-100 hover:bg-amber-300/10"
                onClick={() => setShowNew((prev) => !prev)}
                type="button"
              >
                {showNew ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-amber-100">Confirm New Password</span>
            <div className="relative">
              <input
                autoComplete="new-password"
                className="w-full rounded-xl border border-amber-300/35 bg-slate-900/85 px-3 py-2.5 pr-11 text-amber-50 placeholder:text-slate-400 outline-none transition focus:border-amber-200/75 focus:ring-2 focus:ring-amber-300/20"
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                type={showConfirm ? 'text' : 'password'}
                value={confirmPassword}
              />
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-amber-300/40 px-2 py-1 text-xs text-amber-100 hover:bg-amber-300/10"
                onClick={() => setShowConfirm((prev) => !prev)}
                type="button"
              >
                {showConfirm ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>

          <button
            className="mt-1 w-full rounded-xl bg-amber-300 px-4 py-2.5 font-semibold text-slate-900 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-70"
            disabled={loading}
            type="submit"
          >
            {loading ? 'Updating...' : 'Update Password'}
          </button>
        </form>

        {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
        {success && <p className="mt-3 text-sm text-emerald-300">{success}</p>}
      </section>
    </main>
  );
}

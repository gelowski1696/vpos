'use client';

import { sileo } from 'sileo';

type ToastOptions = {
  description?: string;
};

type ToastMessage = {
  title: string;
  description?: string;
};

type ToastPromiseOptions<T> = {
  loading: ToastMessage;
  success: ToastMessage | ((value: T) => ToastMessage);
  error: ToastMessage | ((error: unknown) => ToastMessage);
};

function resolveThemeMode(): 'light' | 'dark' {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return 'light';
  }
  const stored = window.localStorage.getItem('vpos_admin_theme');
  if (stored === 'dark' || stored === 'light') {
    return stored;
  }
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function resolveToastFill(): string {
  return resolveThemeMode() === 'dark' ? '#ffffff' : '#0f172a';
}

export function toastSuccess(title: string, options?: ToastOptions): void {
  sileo.success({
    title,
    description: options?.description,
    fill: resolveToastFill()
  });
}

export function toastError(title: string, options?: ToastOptions): void {
  sileo.error({
    title,
    description: options?.description,
    fill: resolveToastFill()
  });
}

export function toastInfo(title: string, options?: ToastOptions): void {
  sileo.info({
    title,
    description: options?.description,
    fill: resolveToastFill()
  });
}

export async function toastPromise<T>(
  promise: Promise<T> | (() => Promise<T>),
  options: ToastPromiseOptions<T>
): Promise<T> {
  const fill = resolveToastFill();
  return sileo.promise(promise, {
    loading: {
      title: options.loading.title,
      description: options.loading.description,
      fill
    },
    success: (value: T) => {
      const message =
        typeof options.success === 'function'
          ? options.success(value)
          : options.success;
      return {
        title: message.title,
        description: message.description,
        fill
      };
    },
    error: (error: unknown) => {
      const message =
        typeof options.error === 'function'
          ? options.error(error)
          : options.error;
      return {
        title: message.title,
        description: message.description,
        fill
      };
    }
  });
}

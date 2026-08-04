import type { Request } from 'express';

export type RequestChannel = 'WEB' | 'MOBILE' | 'DESKTOP' | 'RIDER' | 'SYNC' | 'API';

function pickHeader(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string' && entry.trim()) {
        return entry.trim();
      }
    }
    return null;
  }
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return null;
}

function normalizeChannel(value: string | null): RequestChannel | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (
    normalized === 'WEB' ||
    normalized === 'MOBILE' ||
    normalized === 'DESKTOP' ||
    normalized === 'RIDER' ||
    normalized === 'SYNC' ||
    normalized === 'API'
  ) {
    return normalized;
  }
  return null;
}

export function resolveRequestChannel(req: Pick<Request, 'headers' | 'originalUrl'>): RequestChannel {
  const explicit = normalizeChannel(pickHeader(req.headers['x-client-channel']));
  if (explicit) {
    return explicit;
  }

  const vposClient = normalizeChannel(pickHeader(req.headers['x-vpos-client']));
  if (vposClient) {
    return vposClient;
  }

  const url = String(req.originalUrl ?? '').toLowerCase();
  if (url.includes('/sync/')) {
    return 'SYNC';
  }
  return 'API';
}

export function isWebChannel(channel: RequestChannel): boolean {
  return channel === 'WEB';
}

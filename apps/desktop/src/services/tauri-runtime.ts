type WindowWithTauri = Window & {
  __TAURI_INTERNALS__?: unknown;
  __TAURI_IPC__?: unknown;
  __TAURI_METADATA__?: unknown;
  __TAURI__?: unknown;
};

export function isDesktopTauriRuntime(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const tauriWindow = window as WindowWithTauri;
  return Boolean(
    tauriWindow.__TAURI_INTERNALS__ ||
    tauriWindow.__TAURI_IPC__ ||
    tauriWindow.__TAURI_METADATA__ ||
    tauriWindow.__TAURI__
  );
}

import { isDesktopTauriRuntime } from './tauri-runtime';

/** Close the native desktop window from startup/login screens. */
export async function exitDesktopApplication(): Promise<void> {
  if (isDesktopTauriRuntime()) {
    const { appWindow } = await import('@tauri-apps/api/window');
    await appWindow.close();
    return;
  }

  if (typeof window !== 'undefined') {
    window.close();
  }
}

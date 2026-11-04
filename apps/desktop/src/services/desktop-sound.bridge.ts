import { invoke } from '@tauri-apps/api/tauri';
import { isDesktopTauriRuntime } from './tauri-runtime';

const startupSoundUrl = new URL('../assets/wav.mp3', import.meta.url).href;
let startupAudio: HTMLAudioElement | null = null;

async function playAssetStartupSound(): Promise<void> {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') {
    throw new Error('HTML audio is not available.');
  }

  if (!startupAudio) {
    startupAudio = new Audio(startupSoundUrl);
    startupAudio.preload = 'auto';
    startupAudio.volume = 0.48;
  }

  startupAudio.pause();
  startupAudio.currentTime = 0;
  await startupAudio.play();
}

export async function playNativeStartupSound(): Promise<void> {
  if (!isDesktopTauriRuntime()) {
    return;
  }
  await invoke('desktop_play_startup_sound');
}

export async function playDesktopStartupSound(): Promise<void> {
  try {
    await playAssetStartupSound();
    return;
  } catch {
    await playNativeStartupSound();
  }
}

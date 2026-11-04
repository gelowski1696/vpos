import { playDesktopStartupSound } from '../../services/desktop-sound.bridge';

let startupCuePlayed = false;

export async function playDesktopStartupCueOnce(): Promise<void> {
  if (startupCuePlayed) {
    return;
  }
  startupCuePlayed = true;

  try {
    await playDesktopStartupSound();
  } catch {
    // Ignore startup cue failures so launch flow never blocks.
  }
}

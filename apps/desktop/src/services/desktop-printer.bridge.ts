import { invoke } from '@tauri-apps/api/tauri';
import type { ReceiptLine } from '@vpos/printing-core';
import { isDesktopTauriRuntime } from './tauri-runtime';

type PrinterConfig = {
  mode: 'USB' | 'LAN' | 'NONE';
  printerName?: string | null;
  printerHost?: string | null;
  printerPort?: number | null;
};

export async function printEscPosNative(lines: ReceiptLine[], config: PrinterConfig): Promise<boolean> {
  if (!isDesktopTauriRuntime()) {
    return false;
  }
  await invoke('desktop_print_esc_pos', { lines, config });
  return true;
}

export async function listNativePrinters(): Promise<string[]> {
  if (!isDesktopTauriRuntime()) {
    return [];
  }
  return invoke<string[]>('desktop_list_printers');
}

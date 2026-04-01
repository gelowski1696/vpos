import { invoke } from '@tauri-apps/api/tauri';
import type { ReceiptLine } from '@vpos/printing-core';

type PrinterConfig = {
  mode: 'USB' | 'LAN' | 'NONE';
  printerName?: string | null;
  printerHost?: string | null;
  printerPort?: number | null;
};

type WindowWithTauri = Window & {
  __TAURI_INTERNALS__?: unknown;
};

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in (window as WindowWithTauri);
}

export async function printEscPosNative(lines: ReceiptLine[], config: PrinterConfig): Promise<boolean> {
  if (!isTauriRuntime()) {
    return false;
  }
  await invoke('desktop_print_esc_pos', { lines, config });
  return true;
}

export async function listNativePrinters(): Promise<string[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  return invoke<string[]>('desktop_list_printers');
}

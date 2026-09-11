/**
 * WhatsApp link IPC — status/start/stop/unpair for companion-device pairing.
 * No credentials cross IPC (creds stay in main-side files); only the QR image
 * (public one-time pairing payload) and status travel to the renderer.
 */
import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { whatsAppLink } from '../messaging/whatsapp-link.js';

export function registerWhatsAppLinkIpc(): void {
  ipcMain.handle(IPC.WHATSAPP_LINK_STATUS, async () => {
    try {
      return { ok: true, ...whatsAppLink.status() };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.handle(IPC.WHATSAPP_LINK_START, async () => {
    try {
      const status = await whatsAppLink.start();
      return { ok: true, ...status };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.handle(IPC.WHATSAPP_LINK_STOP, async () => {
    try {
      return { ok: true, ...whatsAppLink.stop() };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.handle(IPC.WHATSAPP_LINK_UNPAIR, async () => {
    try {
      return { ok: true, ...(await whatsAppLink.unpair()) };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
}

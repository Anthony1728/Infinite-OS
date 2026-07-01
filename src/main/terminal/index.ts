/**
 * Terminal Index
 * 
 * Exports the terminal subsystem components.
 */

export { PtyManager, getPtyManager, type PtyOptions, type PtyData } from './pty.js';
export { registerTerminalIpc, cleanupWindowTerminals } from './handler.js';
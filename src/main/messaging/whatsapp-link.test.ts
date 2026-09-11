import { describe, expect, it } from 'vitest';
import { normalizeJid, isSelfChat, extractInboundText, shouldAnswerInbound } from './whatsapp-link.js';

const base = {
  ownJid: '15551234567@s.whatsapp.net',
  fromMe: false,
  isGroup: false,
  isBroadcast: false,
  messageId: 'msg-1',
  messageTimeMs: Date.now(),
  linkStartedAtMs: Date.now() - 60_000,
  sentIds: new Set<string>(),
  extraAllowedJids: new Set<string>(),
  hasText: true,
};

describe('whatsapp link gating', () => {
  it('normalizes JIDs across device suffixes and case', () => {
    expect(normalizeJid('15551234567.12:34@s.whatsapp.net')).toBe('15551234567@s.whatsapp.net');
    expect(normalizeJid('USER@S.WhatsApp.Net')).toBe('user@s.whatsapp.net');
    expect(normalizeJid('')).toBe('');
    expect(isSelfChat('15551234567@s.whatsapp.net', '15551234567.5:1@s.whatsapp.net')).toBe(true);
    expect(isSelfChat('999@s.whatsapp.net', '15551234567@s.whatsapp.net')).toBe(false);
  });

  it('extracts text, extended text, and captions only', () => {
    expect(extractInboundText({ message: { conversation: '  hi  ' } })).toBe('hi');
    expect(extractInboundText({ message: { extendedTextMessage: { text: 'longer' } } })).toBe('longer');
    expect(extractInboundText({ message: { imageMessage: { caption: 'look' } } })).toBe('look');
    expect(extractInboundText({ message: { audioMessage: {} } })).toBe('');
    expect(extractInboundText(null)).toBe('');
  });

  it('unwraps disappearing and view-once messages', () => {
    expect(extractInboundText({ message: { ephemeralMessage: { message: { conversation: 'secret hi' } } } })).toBe('secret hi');
    expect(extractInboundText({ message: { viewOnceMessage: { message: { extendedTextMessage: { text: 'once' } } } } })).toBe('once');
    expect(extractInboundText({ message: { ephemeralMessage: { message: { audioMessage: {} } } } })).toBe('');
  });

  it('answers the self-chat in both directions with echo protection', () => {
    expect(shouldAnswerInbound({ ...base, remoteJid: '15551234567@s.whatsapp.net' }).answer).toBe(true);
    expect(shouldAnswerInbound({ ...base, remoteJid: '15551234567@s.whatsapp.net', fromMe: true, messageId: 'msg-2' }).answer).toBe(true);
    expect(
      shouldAnswerInbound({ ...base, remoteJid: '15551234567@s.whatsapp.net', messageId: 'msg-1', sentIds: new Set(['msg-1']) }).reason,
    ).toBe('own-echo');
  });

  it('ignores groups, broadcasts, history, strangers, and textless messages', () => {
    expect(shouldAnswerInbound({ ...base, remoteJid: 'group@g.us', isGroup: true }).reason).toBe('group');
    expect(shouldAnswerInbound({ ...base, remoteJid: 'status@broadcast', isBroadcast: true }).reason).toBe('broadcast');
    expect(shouldAnswerInbound({ ...base, remoteJid: '15551234567@s.whatsapp.net', hasText: false }).reason).toBe('no-text');
    expect(
      shouldAnswerInbound({ ...base, remoteJid: '15551234567@s.whatsapp.net', messageTimeMs: Date.now() - 3600_000 }).reason,
    ).toBe('history');
    expect(shouldAnswerInbound({ ...base, remoteJid: '19998887777@s.whatsapp.net' }).reason).toBe('not-owner');
    expect(
      shouldAnswerInbound({
        ...base,
        remoteJid: '19998887777@s.whatsapp.net',
        extraAllowedJids: new Set(['19998887777@s.whatsapp.net']),
      }).answer,
    ).toBe(true);
  });
});

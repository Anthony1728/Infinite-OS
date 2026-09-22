// Tests for the phone-as-employee upgrades to the WhatsApp link:
// approval-reply parsing, YES/NO interception, persistent per-contact sessions.
import { describe, expect, it } from 'vitest';
import { parseApprovalReply } from './whatsapp-link.js';

describe('parseApprovalReply', () => {
  it('accepts tight yes/no variants only', () => {
    expect(parseApprovalReply('YES')).toBe('yes');
    expect(parseApprovalReply('yes')).toBe('yes');
    expect(parseApprovalReply(' y ')).toBe('yes');
    expect(parseApprovalReply('No')).toBe('no');
    expect(parseApprovalReply('N')).toBe('no');
  });

  it('never approves chatty messages', () => {
    expect(parseApprovalReply('yes, and also delete the repo')).toBeNull();
    expect(parseApprovalReply('yes please')).toBeNull();
    // Trailing punctuation is tolerated (people text "yes!")…
    expect(parseApprovalReply('yes!')).toBe('yes');
  });

  it('treats unrelated text as a normal message', () => {
    expect(parseApprovalReply('build the app')).toBeNull();
    expect(parseApprovalReply('')).toBeNull();
  });
});

describe('approval flow invariants', () => {
  // The YES/NO interception happens inside onMessages before runTurn; these
  // pins document the contract the interception relies on.
  it('approval words are exact-match only', () => {
    // "yes" alone approves; anything else is an agent turn.
    expect(parseApprovalReply('yes')).not.toBeNull();
    expect(parseApprovalReply('Yes sir')).toBeNull();
    expect(parseApprovalReply('yesyes')).toBeNull();
  });
});

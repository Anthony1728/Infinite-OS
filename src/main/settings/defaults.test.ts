// The defaults registry consolidates every known settings key into one place.
// These tests pin the contract that the rest of the app depends on.

import { describe, expect, it } from 'vitest';
import {
  SETTINGS_DEFAULTS,
  isKnownSetting,
  knownSettingKeys,
  settingsDefault,
} from '../../shared/settings-defaults.js';

describe('settings defaults registry', () => {
  it('gates messaging surfaces closed by default (self-chat / allowlist only)', () => {
    expect(settingsDefault('telegramInboundEnabled')).toBe(false);
    expect(settingsDefault('whatsappAllowedJids')).toEqual([]);
  });

  it('defaults permissions to the audited workspace profile, not full system', () => {
    expect(settingsDefault('permissionMode')).toBe('workspace');
    // Colon form: agent/context.ts improvises ':workspace' — the registry
    // must match that spelling exactly (resolvePermissionProfile accepts both).
    expect(settingsDefault('permissionProfile')).toBe(':workspace');
    expect(settingsDefault('selfProtectionEnabled')).toBe(true);
  });

  it('does NOT default browserPreference — its true default is dynamic (fullscreen-based routing)', () => {
    // A static 'extension' default here silently disabled the call site's
    // fullscreen fallback. Absence means get() returns undefined and the
    // call site keeps its dynamic behavior.
    expect(settingsDefault('browserPreference')).toBeUndefined();
    expect(isKnownSetting('browserPreference')).toBe(false);
  });

  it('keeps failover and auto-switch ON (the live behavior call sites relied on)', () => {
    expect(settingsDefault('failoverEnabled')).toBe(true);
    expect(settingsDefault('autoSwitchModel')).toBe(true);
  });

  it('has no invented defaults for identity keys (provider/model/cwd/apiKey stay undefined)', () => {
    for (const key of ['provider', 'model', 'cwd', 'apiKey']) {
      expect(settingsDefault(key)).toBeUndefined();
    }
  });

  it('agentMaxTurns has no implicit ceiling', () => {
    expect(settingsDefault('agentMaxTurns')).toBeUndefined();
  });

  it('isKnownSetting distinguishes known keys from unknown ones', () => {
    expect(isKnownSetting('failoverEnabled')).toBe(true);
    expect(isKnownSetting('definitely-not-a-setting')).toBe(false);
  });

  it('every default value is JSON-serializable (settings files are JSON)', () => {
    for (const [key, value] of Object.entries(SETTINGS_DEFAULTS)) {
      expect(() => JSON.stringify({ [key]: value })).not.toThrow();
    }
  });

  it('exposes a stable key list for the settings UI', () => {
    const keys = knownSettingKeys();
    expect(keys.length).toBeGreaterThan(25);
    expect(new Set(keys).size).toBe(keys.length); // no duplicates
  });
});

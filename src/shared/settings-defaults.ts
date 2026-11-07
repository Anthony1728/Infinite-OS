// Settings defaults registry — the single map of every known settings key
// and its default value.
//
// Before this registry, `settings.get(key)` returned `undefined` for anything
// the user had never written, and every call site improvised its own default
// (`?? 'ollama'`, `?? 5 * 60_000`, `?? []`…). Thirty-one keys × improvised
// defaults meant the same setting could behave differently in the loop vs the
// UI, and no one could enumerate the real settings surface — which is itself
// the bug. Now the default lives in exactly one place; call sites may still
// specialize (the registry value is the contract), and `get()` returns it so
// `settings.get('failoverEnabled') === false` is true without a user file.

/**
 * Every known settings key with its default.
 *
 * Semantics of the defaults mirror what the current call sites do — this is a
 * consolidation, not a behavior change. A key's absence from this map means
 * "no meaningful default" (e.g. `apiKey`, `cwd`): `get()` still returns
 * `undefined` for those, exactly as before.
 */
export const SETTINGS_DEFAULTS: Record<string, unknown> = {
  // Agent behavior
  agentContextMessages: 400,
  agentMaxTurns: undefined, // no implicit ceiling — work-until-done
  autoSwitchModel: true,
  failoverEnabled: true,
  uncensoredMode: false,
  selfProtectionEnabled: true,

  // Provider / model selection (no invented default: absence means the
  // active-model resolution path decides, exactly as today)
  provider: undefined,
  model: undefined,
  cwd: undefined,
  customBaseUrl: undefined,
  customModel: undefined,
  cloudflareAccountId: undefined,
  apiKey: undefined,

  // Permissions — canonical forms match the most common improvised defaults.
  // profile uses the colon-prefixed form (':workspace') because
  // agent/context.ts improvises exactly that; resolvePermissionProfile
  // accepts both spellings. browserPreference is deliberately ABSENT: its
  // true default is dynamic (in-app when the window is fullscreen), and a
  // static 'extension' here silently disabled that fullscreen routing.
  permissionMode: 'workspace',
  permissionProfile: ':workspace',

  // Tools / surfaces — 'smart' is the display-policy fallback for any
  // value outside 'always-visible'/'always-background'.
  automationDisplayMode: 'smart',

  // Messaging gates — closed by default (self-chat-only / allowlist-only)
  telegramInboundEnabled: false,
  telegramAllowedChatIds: [],
  telegramDefaultChatId: undefined,
  whatsappAllowedJids: [],

  // Voice
  voiceCommunicationProvider: undefined,
  voiceCommunicationModel: undefined,

  // Self-evolution loop (disabled unless explicitly enabled). Interval must
  // match EVOLVE_DEFAULT_INTERVAL_MS (45 min) — the loop's clampInterval
  // falls back to that constant for undefined, and a divergent registry
  // value would change the cadence for existing users.
  evolveLoopEnabled: false,
  evolveIntervalMs: 45 * 60_000,
  evolveCycles: 0,
  evolveLastRunAt: undefined,
  evolveSessionId: undefined,

  // System
  bootOptimization: true,
  hooks: {},
  permissions: {},
};

// Object/array defaults are frozen so a consumer mutating
// `settings.get('permissions')` cannot poison the process-wide default.
for (const value of Object.values(SETTINGS_DEFAULTS)) {
  if (value !== null && typeof value === 'object') Object.freeze(value);
}

/** The default for `key`, or undefined when the key has no meaningful default. */
export function settingsDefault(key: string): unknown {
  return SETTINGS_DEFAULTS[key];
}

/** True when a settings key is known to the registry. */
export function isKnownSetting(key: string): boolean {
  return key in SETTINGS_DEFAULTS;
}

/** All known setting keys (for the settings UI and dump/debug paths). */
export function knownSettingKeys(): string[] {
  return Object.keys(SETTINGS_DEFAULTS);
}

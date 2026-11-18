// Settings. Everything lives in chrome.storage.local — never .sync, so API keys
// don't leave the machine via the Microsoft/Google account.

export const DEFAULTS = {
  // 'none' | 'ollama' | 'openai' | 'anthropic' | 'edge'
  provider: 'none',

  ollama: {
    baseUrl: 'http://localhost:11434',
    model: 'llama3.2',
  },

  // Any OpenAI-compatible endpoint: OpenAI, LM Studio, llama.cpp, OpenRouter…
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    apiKey: '',
  },

  anthropic: {
    model: 'claude-opus-5-5',
    apiKey: '',
  },

  dedupe: {
    ignoreHash: true,
    stripTracking: true,
    ignoreTrailingSlash: true,
    includeNewTabPages: false,
    allWindows: false,
  },

  stale: {
    // Suggest tabs that haven't been active for this many days.
    days: 7,
    includeGrouped: false,
    allWindows: false,
  },

  grouping: {
    allWindows: false,
    useRules: true,
    collapseNew: false,
    // Leave tabs that are already in a group alone.
    onlyUngrouped: true,
    // Never send more than this many tabs to an AI in one go.
    maxAiTabs: 80,
  },
};

/** Anthropic model ids saved by earlier versions, mapped to their successors. */
export const LEGACY_MODELS = {
  'claude-opus-5': 'claude-opus-5-5',
  'claude-sonnet-5': 'claude-sonnet-5-5',
  'claude-haiku-4-5': 'claude-haiku-5-5',
};

function merge(base, patch) {
  if (patch === undefined || patch === null) return base;
  if (typeof base !== 'object' || Array.isArray(base)) return patch;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = k in base ? merge(base[k], v) : v;
  }
  return out;
}

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  // A copy, so nothing a caller does to the result can change DEFAULTS.
  const out = merge(structuredClone(DEFAULTS), settings);
  // A model id saved by an earlier version would leave the model picker blank.
  out.anthropic.model = LEGACY_MODELS[out.anthropic.model] ?? out.anthropic.model;
  return out;
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const next = merge(current, patch);
  await chrome.storage.local.set({ settings: next });
  return next;
}

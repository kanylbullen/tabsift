// Inställningar. Allt ligger i chrome.storage.local — aldrig .sync, så att
// API-nycklar inte lämnar maskinen via Microsoft-/Google-kontot.

export const DEFAULTS = {
  // 'none' | 'ollama' | 'openai' | 'anthropic' | 'edge'
  provider: 'none',

  ollama: {
    baseUrl: 'http://localhost:11434',
    model: 'llama3.2',
  },

  // Alla OpenAI-kompatibla endpoints: OpenAI, LM Studio, llama.cpp, OpenRouter…
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    apiKey: '',
  },

  anthropic: {
    model: 'claude-opus-5',
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
    // Föreslå flikar som inte varit aktiva på så här många dagar.
    days: 7,
    includeGrouped: false,
    allWindows: false,
  },

  grouping: {
    allWindows: false,
    useRules: true,
    collapseNew: false,
    // Låt flikar som redan ligger i en grupp vara i fred.
    onlyUngrouped: true,
    // Skicka aldrig fler än så här många flikar till en AI i ett svep.
    maxAiTabs: 80,
  },
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
  return merge(DEFAULTS, settings);
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const next = merge(current, patch);
  await chrome.storage.local.set({ settings: next });
  return next;
}

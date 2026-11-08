import { getSettings, saveSettings } from '../lib/settings.js';
import { getProvider, ensurePermissions, classify } from '../lib/ai/index.js';
import { MODELS as ANTHROPIC_MODELS } from '../lib/ai/anthropic.js';
import { listModels as listOllamaModels } from '../lib/ai/ollama.js';
import { availability as edgeAvailability } from '../lib/ai/edge.js';
import { t, localizeDocument } from '../lib/i18n.js';

const $ = (id) => document.getElementById(id);
let settings;

// ---------------------------------------------------------------------- load

function fillAnthropicModels() {
  const select = $('anthropic-model');
  select.textContent = '';
  for (const m of ANTHROPIC_MODELS) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = t(m.labelKey);
    select.appendChild(opt);
  }
}

function fillForm() {
  $('provider').value = settings.provider;

  $('ollama-url').value = settings.ollama.baseUrl;
  $('ollama-model').value = settings.ollama.model;

  $('openai-url').value = settings.openai.baseUrl;
  $('openai-model').value = settings.openai.model;
  $('openai-key').value = settings.openai.apiKey;

  $('anthropic-model').value = settings.anthropic.model;
  $('anthropic-key').value = settings.anthropic.apiKey;

  $('d-hash').checked = settings.dedupe.ignoreHash;
  $('d-tracking').checked = settings.dedupe.stripTracking;
  $('d-slash').checked = settings.dedupe.ignoreTrailingSlash;
  $('d-newtab').checked = settings.dedupe.includeNewTabPages;
  $('d-windows').checked = settings.dedupe.allWindows;

  $('s-days').value = settings.stale.days;
  $('s-grouped').checked = settings.stale.includeGrouped;
  $('s-windows').checked = settings.stale.allWindows;

  $('g-rules').checked = settings.grouping.useRules;
  $('g-ungrouped').checked = settings.grouping.onlyUngrouped;
  $('g-collapse').checked = settings.grouping.collapseNew;
  $('g-windows').checked = settings.grouping.allWindows;
  $('g-max').value = settings.grouping.maxAiTabs;

  $('ollama-origin-hint').textContent =
    `OLLAMA_ORIGINS='chrome-extension://${chrome.runtime.id}' ollama serve`;
}

function readForm() {
  return {
    provider: $('provider').value,
    ollama: {
      baseUrl: $('ollama-url').value.trim() || 'http://localhost:11434',
      model: $('ollama-model').value.trim(),
    },
    openai: {
      baseUrl: $('openai-url').value.trim() || 'https://api.openai.com/v1',
      model: $('openai-model').value.trim(),
      apiKey: $('openai-key').value.trim(),
    },
    anthropic: {
      model: $('anthropic-model').value,
      apiKey: $('anthropic-key').value.trim(),
    },
    dedupe: {
      ignoreHash: $('d-hash').checked,
      stripTracking: $('d-tracking').checked,
      ignoreTrailingSlash: $('d-slash').checked,
      includeNewTabPages: $('d-newtab').checked,
      allWindows: $('d-windows').checked,
    },
    stale: {
      days: Math.max(1, Math.min(365, Math.round(Number($('s-days').value)) || 7)),
      includeGrouped: $('s-grouped').checked,
      allWindows: $('s-windows').checked,
    },
    grouping: {
      useRules: $('g-rules').checked,
      onlyUngrouped: $('g-ungrouped').checked,
      collapseNew: $('g-collapse').checked,
      allWindows: $('g-windows').checked,
      maxAiTabs: Math.max(10, Math.min(300, Number($('g-max').value) || 80)),
    },
  };
}

// --------------------------------------------------------------------- UI

function syncPanels() {
  const provider = $('provider').value;
  for (const panel of document.querySelectorAll('.panel')) {
    panel.hidden = panel.dataset.provider !== provider;
  }
  $('ai-actions').hidden = provider === 'none';
  $('btn-permission').hidden = provider === 'edge';
  setStatus($('test-status'), '');
  if (provider === 'edge') void showEdgeStatus();
}

function setStatus(el, text, kind = '') {
  el.textContent = text;
  el.className = `status ${kind}`.trim();
}

async function showEdgeStatus() {
  const state = await edgeAvailability();
  const map = {
    missing: [t('opt_edge_missing'), 'error'],
    unavailable: [t('opt_edge_unavailable'), 'error'],
    downloadable: [t('opt_edge_downloadable'), ''],
    downloading: [t('opt_edge_downloading'), ''],
    available: [t('opt_edge_available'), 'ok'],
  };
  const [text, kind] = map[state] ?? [state, ''];
  setStatus($('edge-status'), text, kind);
}

let saveTimer;
async function persist() {
  settings = await saveSettings(readForm());
  clearTimeout(saveTimer);
  $('saved').hidden = false;
  saveTimer = setTimeout(() => ($('saved').hidden = true), 1200);
}

// ------------------------------------------------------------------- actions

$('btn-permission').addEventListener('click', async () => {
  await persist();
  const provider = getProvider(settings.provider);
  const origins = provider?.hostPermissions(settings) ?? [];
  if (!origins.length) {
    setStatus($('test-status'), t('opt_no_perm_needed'), 'ok');
    return;
  }
  try {
    const granted = await ensurePermissions(settings);
    setStatus(
      $('test-status'),
      granted ? t('opt_granted', origins.join(', ')) : t('opt_denied'),
      granted ? 'ok' : 'error',
    );
  } catch (err) {
    setStatus($('test-status'), err.message, 'error');
  }
});

$('btn-test').addEventListener('click', async () => {
  await persist();
  setStatus($('test-status'), t('opt_testing'));
  try {
    const result = await classify(
      settings,
      [
        { title: 'Pull request #412 — fix auth redirect', host: 'github.com' },
        { title: 'OAuth 2.0 redirect_uri mismatch', host: 'stackoverflow.com' },
        { title: 'Weekly deals', host: 'ica.se' },
      ],
      [],
      [t('cat_code'), t('cat_shopping')],
    );
    const names = [...new Set(result.values())];
    setStatus(
      $('test-status'),
      names.length
        ? t('opt_test_ok', names.join(', '))
        : t('opt_test_empty'),
      names.length ? 'ok' : 'error',
    );
  } catch (err) {
    setStatus($('test-status'), err.message, 'error');
  }
});

$('ollama-url').addEventListener('blur', async () => {
  await persist();
  try {
    const models = await listOllamaModels(settings);
    const list = $('ollama-models');
    list.textContent = '';
    for (const name of models) {
      const opt = document.createElement('option');
      opt.value = name;
      list.appendChild(opt);
    }
  } catch {
    // The server may not be running yet, or permission is missing. Stay quiet —
    // the "Test connection" button gives a real error when the user asks.
  }
});

$('btn-shortcuts').addEventListener('click', () => {
  const scheme = navigator.userAgent.includes('Edg/') ? 'edge' : 'chrome';
  chrome.tabs.create({ url: `${scheme}://extensions/shortcuts` });
});

$('provider').addEventListener('change', async () => {
  await persist();
  syncPanels();
});

for (const el of document.querySelectorAll('input, select')) {
  if (el.id === 'provider') continue;
  el.addEventListener('change', persist);
}

(async () => {
  localizeDocument();
  document.title = t('opt_title');
  fillAnthropicModels();
  settings = await getSettings();
  fillForm();
  syncPanels();
})();

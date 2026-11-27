import { getSettings, saveSettings } from '../lib/settings.js';
import { getProvider, ensurePermissions, classify } from '../lib/ai/index.js';
import { MODELS as ANTHROPIC_MODELS } from '../lib/ai/anthropic.js';
import { listModels as listOllamaModels } from '../lib/ai/ollama.js';
import { availability as edgeAvailability } from '../lib/ai/edge.js';
import { t, localizeDocument } from '../lib/i18n.js';
import { MIN_HOURS, reopenAutoClosed, clearAutoClosed } from '../lib/autoclose.js';
import { formatAge } from '../lib/tabs.js';
import { displayHost } from '../lib/urlkey.js';

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

  $('ac-enabled').checked = settings.autoClose.enabled;
  $('ac-grouped').checked = settings.autoClose.includeGrouped;
  $('ac-rules').textContent = '';
  for (const rule of settings.autoClose.rules) addRuleRow(rule);

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
      // Fractions are allowed (0.01 days is about 15 minutes), mostly for trying it out.
      days: Math.max(0.01, Math.min(365, Math.round(Number($('s-days').value) * 100) / 100 || 7)),
      includeGrouped: $('s-grouped').checked,
      allWindows: $('s-windows').checked,
    },
    autoClose: {
      enabled: $('ac-enabled').checked,
      includeGrouped: $('ac-grouped').checked,
      rules: readRules(),
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

// ------------------------------------------------------------ auto-close rules

function addRuleRow(rule = { pattern: '', hours: 24 }) {
  const row = document.createElement('div');
  row.className = 'rule';

  const pattern = document.createElement('input');
  pattern.type = 'text';
  pattern.className = 'pattern';
  pattern.value = rule.pattern;
  pattern.placeholder = t('opt_ac_placeholder');
  pattern.setAttribute('aria-label', t('opt_ac_pattern'));
  pattern.autocomplete = 'off';
  pattern.spellcheck = false;

  const hours = document.createElement('input');
  hours.type = 'number';
  hours.className = 'hours';
  hours.min = String(MIN_HOURS);
  hours.max = '8760';
  hours.step = 'any';
  hours.value = rule.hours;
  hours.setAttribute('aria-label', t('opt_ac_hours'));

  const unit = document.createElement('span');
  unit.className = 'unit';
  unit.textContent = t('opt_ac_unit');

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'remove';
  remove.textContent = '×';
  remove.title = t('opt_ac_remove');
  remove.setAttribute('aria-label', t('opt_ac_remove'));
  remove.addEventListener('click', () => {
    row.remove();
    void persist();
  });

  row.append(pattern, hours, unit, remove);
  $('ac-rules').appendChild(row);
  return pattern;
}

function readRules() {
  const rules = [];
  for (const row of $('ac-rules').querySelectorAll('.rule')) {
    const pattern = row.querySelector('.pattern').value.trim();
    if (!pattern) continue; // a row still being typed
    const raw = row.querySelector('.hours').value.trim();
    // Only an empty or invalid field falls back to a day; 0 is clamped like any small value.
    const hours = raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : 24;
    rules.push({
      pattern,
      hours: Math.max(MIN_HOURS, Math.min(8760, Math.round(hours * 100) / 100)),
    });
  }
  return rules;
}

$('ac-add').addEventListener('click', () => addRuleRow().focus());
// Rows are added later, so listen on their container.
$('ac-rules').addEventListener('change', persist);

// Tabs closed automatically, newest first, with a way back.
async function renderLog() {
  const { autoClosed = [] } = await chrome.storage.local.get('autoClosed');
  const list = $('ac-log');
  list.textContent = '';
  $('ac-log-empty').hidden = autoClosed.length > 0;
  $('ac-clear').hidden = autoClosed.length === 0;

  const now = Date.now();
  for (const entry of autoClosed) {
    const li = document.createElement('li');
    const what = document.createElement('div');
    what.className = 'what';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = entry.title || entry.url;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${displayHost(entry.url)} · ${t('opt_ac_ago', formatAge(now - entry.at))}`;
    what.append(title, meta);

    const reopen = document.createElement('button');
    reopen.type = 'button';
    reopen.textContent = t('opt_ac_reopen');
    reopen.addEventListener('click', async () => {
      reopen.disabled = true;
      try {
        await reopenAutoClosed(entry);
      } catch (err) {
        console.error('[tabsift] reopen', err);
        reopen.disabled = false;
      }
    });

    li.append(what, reopen);
    list.appendChild(li);
  }
}

$('ac-clear').addEventListener('click', () => void clearAutoClosed());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.autoClosed) void renderLog();
});

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
let ready = false; // saving before the form is filled would overwrite settings with blanks
let saving = Promise.resolve();
function persist() {
  if (!ready) return saving;
  // One save at a time, so an older snapshot never lands after a newer one.
  saving = saving.then(async () => {
    settings = await saveSettings(readForm());
    clearTimeout(saveTimer);
    $('saved').hidden = false;
    saveTimer = setTimeout(() => ($('saved').hidden = true), 1200);
  }).catch((err) => console.error('[tabsift] save', err));
  return saving;
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
  ready = true;
  syncPanels();
  await renderLog();
})();

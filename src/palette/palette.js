// The tab palette. Runs in the popup context and talks to chrome.tabs directly:
// no background channel, no content scripts, nothing that touches page content.

import { getSettings } from '../lib/settings.js';
import {
  queryTabs, tabUrl, planDedupe, applyDedupe, undoClose,
  planStale, closeWithUndo, formatAge, applyGrouping, focusTab, colorFor,
} from '../lib/tabs.js';
import { normalizeUrl, displayHost } from '../lib/urlkey.js';
import { planGrouping } from '../lib/grouping.js';
import { matchBest } from '../lib/fuzzy.js';
import { t, tn, localizeDocument } from '../lib/i18n.js';

const els = {
  query: document.getElementById('query'),
  counts: document.getElementById('counts'),
  results: document.getElementById('results'),
  empty: document.getElementById('empty'),
  notice: document.getElementById('notice'),
  dedupe: document.getElementById('btn-dedupe'),
  group: document.getElementById('btn-group'),
  stale: document.getElementById('btn-stale'),
  undo: document.getElementById('btn-undo'),
  options: document.getElementById('btn-options'),
};

let settings;
let tabs = [];
let dupKeys = new Set();
let mode = 'search';
let dedupePlan = null;
let groupPlan = null;
let stalePlan = null;
/** Tab ids the user unchecked in the inactive-tab preview. */
let staleKeep = new Set();
let visible = [];
let cursor = 0;

// ------------------------------------------------------------------- helpers

/** Builds DOM from text nodes — tab titles are untrusted input from web pages. */
function highlighted(text, positions = []) {
  const frag = document.createDocumentFragment();
  if (!positions.length) {
    frag.appendChild(document.createTextNode(text));
    return frag;
  }
  const hit = new Set(positions);
  let run = '';
  let runMarked = hit.has(0);

  const flush = () => {
    if (!run) return;
    if (runMarked) {
      const mark = document.createElement('mark');
      mark.textContent = run;
      frag.appendChild(mark);
    } else {
      frag.appendChild(document.createTextNode(run));
    }
    run = '';
  };

  for (let i = 0; i < text.length; i++) {
    const marked = hit.has(i);
    if (marked !== runMarked) {
      flush();
      runMarked = marked;
    }
    run += text[i];
  }
  flush();
  return frag;
}

function safeFavicon(url) {
  if (typeof url !== 'string') return null;
  return /^(https?:|data:image\/)/i.test(url) ? url : null;
}

function setNotice(text, isError = false) {
  els.notice.textContent = text ?? '';
  els.notice.classList.toggle('error', !!isError);
  els.notice.hidden = !text;
}

// ---------------------------------------------------------------------- load

async function load() {
  settings = await getSettings();
  tabs = await queryTabs({ allWindows: settings.dedupe.allWindows });

  const seen = new Map();
  dupKeys = new Set();
  for (const tab of tabs) {
    const key = normalizeUrl(tabUrl(tab), settings.dedupe);
    if (!key) continue;
    if (seen.has(key)) dupKeys.add(key);
    else seen.set(key, tab.id);
  }

  const { lastClose } = await chrome.storage.local.get('lastClose');
  const fresh = lastClose && Date.now() - lastClose.at < 10 * 60 * 1000;
  els.undo.hidden = !fresh;
  if (fresh) els.undo.textContent = t('btn_undo_count', lastClose.tabs.length);
}

// -------------------------------------------------------------------- render

function renderCounts() {
  els.counts.textContent = '';
  const dupTabs = tabs.filter((tab) => dupKeys.has(normalizeUrl(tabUrl(tab), settings.dedupe)));

  /** @type {[number|null, string][]} */
  const parts = [[tabs.length, tn('count_tabs', tabs.length)]];
  if (dupTabs.length) parts.push([dupTabs.length, tn('count_dupes', dupTabs.length)]);
  const stale = planStale(tabs, Date.now(), settings.stale).length;
  if (stale) parts.push([stale, t('count_stale', settings.stale.days)]);
  if (settings.provider === 'none') parts.push([null, t('count_ai_off')]);

  parts.forEach(([n, label], i) => {
    if (i > 0) els.counts.appendChild(document.createTextNode(' · '));
    if (n !== null) {
      const b = document.createElement('b');
      b.textContent = String(n);
      els.counts.append(b, document.createTextNode(' '));
    }
    els.counts.appendChild(document.createTextNode(label));
  });
}

function renderSearch() {
  const q = els.query.value.trim();
  els.results.textContent = '';

  visible = [];
  for (const tab of tabs) {
    const title = tab.title || tabUrl(tab);
    const host = displayHost(tabUrl(tab));
    if (!q) {
      visible.push({ tab, title, host, positions: [], score: -tab.index });
      continue;
    }
    const res = matchBest(q, [
      { text: title, weight: 1 },
      { text: host, weight: 0.9 },
    ]);
    if (res) {
      visible.push({
        tab, title, host,
        positions: res.field === title ? res.positions : [],
        score: res.score,
      });
    }
  }

  if (q) visible.sort((a, b) => b.score - a.score);
  cursor = Math.min(cursor, Math.max(visible.length - 1, 0));

  for (const [i, item] of visible.entries()) {
    els.results.appendChild(renderRow(item, i));
  }

  els.empty.hidden = visible.length > 0;
  els.empty.textContent = visible.length ? '' : t('no_match');
  scrollToCursor();
}

function renderRow(item, i) {
  const { tab, title, host, positions } = item;
  const li = document.createElement('li');
  li.className = 'row';
  li.setAttribute('role', 'option');
  li.setAttribute('aria-selected', String(i === cursor));

  const icon = safeFavicon(tab.favIconUrl);
  if (icon) {
    const img = document.createElement('img');
    img.src = icon;
    img.alt = '';
    img.addEventListener('error', () => img.replaceWith(dot()));
    li.appendChild(img);
  } else {
    li.appendChild(dot());
  }

  const text = document.createElement('div');
  text.className = 'text';

  const titleEl = document.createElement('div');
  titleEl.className = 'title';
  titleEl.appendChild(highlighted(title, positions));
  titleEl.title = title;

  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = host;

  text.append(titleEl, sub);
  li.appendChild(text);

  if (tab.pinned) li.appendChild(chip(t('chip_pinned')));
  if (tab.audible) li.appendChild(chip(t('chip_audio')));
  if (dupKeys.has(normalizeUrl(tabUrl(tab), settings.dedupe))) {
    li.appendChild(chip(t('chip_dupe'), 'dup'));
  }

  const close = document.createElement('button');
  close.className = 'close';
  close.type = 'button';
  close.textContent = '×';
  close.title = t('close_tab');
  close.addEventListener('click', async (e) => {
    e.stopPropagation();
    await chrome.tabs.remove(tab.id);
    await load();
    render();
  });
  li.appendChild(close);

  li.addEventListener('click', () => activate(item));
  li.addEventListener('mousemove', () => {
    if (cursor === i) return;
    cursor = i;
    updateSelection();
  });

  return li;
}

function dot() {
  const d = document.createElement('span');
  d.className = 'dot';
  return d;
}

function chip(label, extra = '') {
  const s = document.createElement('span');
  s.className = `chip ${extra}`.trim();
  s.textContent = label;
  return s;
}

function renderPlanView() {
  els.results.textContent = '';
  els.empty.hidden = true;

  if (mode === 'dedupe') {
    if (!dedupePlan?.length) {
      els.empty.hidden = false;
      els.empty.textContent = t('no_dupes');
      return;
    }
    for (const entry of dedupePlan) {
      const section = document.createElement('div');
      section.className = 'section';

      const h = document.createElement('h2');
      h.textContent = entry.keep.title || displayHost(tabUrl(entry.keep));
      const src = document.createElement('span');
      src.className = 'src';
      src.textContent = t('copies', entry.close.length + 1);
      h.appendChild(src);

      const ul = document.createElement('ul');
      const kept = document.createElement('li');
      kept.className = 'kept';
      const keepLabel = document.createElement('span');
      keepLabel.className = 'keep-label';
      keepLabel.textContent = t('keep');
      kept.append(keepLabel, document.createTextNode(' ' + displayHost(tabUrl(entry.keep))));
      ul.appendChild(kept);
      for (const tab of entry.close) {
        const li = document.createElement('li');
        li.className = 'gone';
        li.textContent = tab.title || tabUrl(tab);
        ul.appendChild(li);
      }
      section.append(h, ul);
      els.results.appendChild(section);
    }
    return;
  }

  if (mode === 'stale') {
    renderStale();
    return;
  }

  if (mode === 'group') {
    if (!groupPlan?.groups?.length) {
      els.empty.hidden = false;
      els.empty.textContent = t('nothing_to_group');
      return;
    }
    for (const g of groupPlan.groups) {
      const section = document.createElement('div');
      section.className = 'section';

      const h = document.createElement('h2');
      h.textContent = g.title;
      const src = document.createElement('span');
      src.className = 'src';
      src.textContent =
        `${t(g.source === 'ai' ? 'source_ai' : 'source_rule')} · ${g.tabs.length} · ${colorFor(g.title)}`;
      h.append(src);

      const ul = document.createElement('ul');
      for (const tab of g.tabs.slice(0, 6)) {
        const li = document.createElement('li');
        li.textContent = tab.title || tabUrl(tab);
        ul.appendChild(li);
      }
      if (g.tabs.length > 6) {
        const li = document.createElement('li');
        li.textContent = t('and_more', g.tabs.length - 6);
        ul.appendChild(li);
      }
      section.append(h, ul);
      els.results.appendChild(section);
    }
  }
}

function renderStale() {
  visible = stalePlan ?? [];
  if (!visible.length) {
    els.empty.hidden = false;
    els.empty.textContent = t('stale_none', settings.stale.days);
    return;
  }
  cursor = Math.min(cursor, visible.length - 1);
  const now = Date.now();

  for (const [i, tab] of visible.entries()) {
    const li = document.createElement('li');
    li.className = 'row';
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(i === cursor));

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !staleKeep.has(tab.id);
    box.tabIndex = -1;
    box.setAttribute('aria-label', t('stale_checkbox'));
    li.appendChild(box);

    const icon = safeFavicon(tab.favIconUrl);
    if (icon) {
      const img = document.createElement('img');
      img.src = icon;
      img.alt = '';
      img.addEventListener('error', () => img.replaceWith(dot()));
      li.appendChild(img);
    } else {
      li.appendChild(dot());
    }

    const text = document.createElement('div');
    text.className = 'text';
    const titleEl = document.createElement('div');
    titleEl.className = 'title';
    titleEl.textContent = tab.title || tabUrl(tab);
    titleEl.title = titleEl.textContent;
    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = displayHost(tabUrl(tab));
    text.append(titleEl, sub);
    li.appendChild(text);

    li.appendChild(chip(formatAge(now - tab.lastAccessed)));

    li.addEventListener('click', () => {
      cursor = i;
      toggleStale(tab.id);
    });
    li.addEventListener('mousemove', () => {
      if (cursor === i) return;
      cursor = i;
      updateSelection();
    });
    els.results.appendChild(li);
  }
  scrollToCursor();
}

function toggleStale(tabId) {
  if (staleKeep.has(tabId)) staleKeep.delete(tabId);
  else staleKeep.add(tabId);
  render();
}

function labelWithKey(button, label, key) {
  button.className = 'action';
  button.textContent = label + ' ';
  const kbd = document.createElement('kbd');
  kbd.textContent = key;
  button.appendChild(kbd);
}

const MODES = [
  ['dedupe', 'btn_dedupe', 'Ctrl+D'],
  ['group', 'btn_group', 'Ctrl+G'],
  ['stale', 'btn_stale', 'Ctrl+I'],
];

function renderFooter() {
  if (mode === 'search') {
    for (const [m, label, key] of MODES) {
      labelWithKey(els[m], t(label), key);
      els[m].disabled = false;
      els[m].hidden = false;
    }
    return;
  }

  const own = els[mode];
  own.className = 'action primary';
  own.hidden = false;

  if (mode === 'dedupe') {
    const n = (dedupePlan ?? []).reduce((s, e) => s + e.close.length, 0);
    own.textContent = n ? tn('close_n', n) : t('nothing_to_close');
    own.disabled = !n;
  } else if (mode === 'stale') {
    const n = (stalePlan ?? []).filter((tab) => !staleKeep.has(tab.id)).length;
    own.textContent = n ? tn('close_n', n) : t('nothing_to_close');
    own.disabled = !n;
  } else {
    const n = (groupPlan?.groups ?? []).reduce((s, g) => s + g.tabs.length, 0);
    own.textContent = n ? tn('group_n', n) : t('nothing_to_group');
    own.disabled = !n;
  }

  // One of the other buttons becomes Cancel; the rest are hidden.
  const others = MODES.map(([m]) => m).filter((m) => m !== mode);
  others.forEach((m, i) => {
    const b = els[m];
    b.hidden = i > 0;
    b.className = 'action ghost';
    b.textContent = t('btn_cancel');
    b.disabled = false;
  });
}

function render() {
  renderCounts();
  if (mode === 'search') renderSearch();
  else renderPlanView();
  renderFooter();
}

function updateSelection() {
  const rows = els.results.querySelectorAll('.row');
  rows.forEach((row, i) => row.setAttribute('aria-selected', String(i === cursor)));
  scrollToCursor();
}

function scrollToCursor() {
  const row = els.results.querySelectorAll('.row')[cursor];
  row?.scrollIntoView({ block: 'nearest' });
}

// -------------------------------------------------------------------- actions

async function activate(item) {
  await focusTab(item.tab.id, item.tab.windowId);
  window.close();
}

async function enterDedupe() {
  setNotice('');
  const fresh = await queryTabs({ allWindows: settings.dedupe.allWindows });
  dedupePlan = planDedupe(fresh, settings.dedupe);
  mode = 'dedupe';
  els.query.disabled = true;
  render();
}

async function enterGroup() {
  setNotice(t('analyzing'));
  els.group.disabled = true;
  try {
    groupPlan = await planGrouping(settings);
    mode = 'group';
    els.query.disabled = true;
    setNotice(groupPlan.aiError ?? (groupPlan.aiUsed ? t('ai_used') : ''), !!groupPlan.aiError);
  } catch (err) {
    setNotice(err.message, true);
  } finally {
    els.group.disabled = false;
    render();
  }
}

async function enterStale() {
  setNotice('');
  const fresh = await queryTabs({ allWindows: settings.stale.allWindows });
  stalePlan = planStale(fresh, Date.now(), settings.stale);
  staleKeep = new Set();
  cursor = 0;
  mode = 'stale';
  els.query.disabled = true;
  render();
}

function backToSearch() {
  mode = 'search';
  dedupePlan = null;
  groupPlan = null;
  stalePlan = null;
  cursor = 0;
  els.query.disabled = false;
  els.query.focus();
  setNotice('');
  render();
}

async function confirmDedupe() {
  const { closed } = await applyDedupe(dedupePlan ?? []);
  await load();
  backToSearch();
  setNotice(closed ? tn('closed_n', closed) : t('closed_none'));
}

async function confirmStale() {
  const toClose = (stalePlan ?? []).filter((tab) => !staleKeep.has(tab.id));
  const { closed } = await closeWithUndo(toClose);
  await load();
  backToSearch();
  setNotice(closed ? tn('closed_stale', closed) : t('closed_none'));
}

async function confirmGroup() {
  const assignments = new Map((groupPlan?.groups ?? []).map((g) => [g.title, g.tabs]));
  const { grouped, created } = await applyGrouping(assignments, {
    collapseNew: settings.grouping.collapseNew,
  });
  await load();
  backToSearch();
  setNotice(t('grouped_result', grouped, created));
}

// -------------------------------------------------------------------- events

const ENTER = { dedupe: enterDedupe, group: enterGroup, stale: enterStale };
const CONFIRM = { dedupe: confirmDedupe, group: confirmGroup, stale: confirmStale };

for (const [m] of MODES) {
  els[m].addEventListener('click', () => {
    if (mode === 'search') return void ENTER[m]();
    if (mode === m) return void CONFIRM[m]();
    backToSearch();
  });
}

els.undo.addEventListener('click', async () => {
  const { reopened } = await undoClose();
  await load();
  render();
  setNotice(tn('reopened', reopened));
});

els.options.addEventListener('click', () => chrome.runtime.openOptionsPage());

els.query.addEventListener('input', () => {
  cursor = 0;
  renderSearch();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (mode !== 'search') backToSearch();
    else window.close();
    return;
  }

  if (e.ctrlKey && (e.key === 'd' || e.key === 'D')) {
    e.preventDefault();
    if (mode === 'search') void enterDedupe();
    return;
  }
  if (e.ctrlKey && (e.key === 'g' || e.key === 'G')) {
    e.preventDefault();
    if (mode === 'search') void enterGroup();
    return;
  }
  if (e.ctrlKey && (e.key === 'i' || e.key === 'I')) {
    e.preventDefault();
    if (mode === 'search') void enterStale();
    return;
  }

  if (mode === 'stale' && e.key === ' ') {
    e.preventDefault();
    if (visible[cursor]) toggleStale(visible[cursor].id);
    return;
  }

  if (mode !== 'search' && e.key === 'Enter') {
    e.preventDefault();
    if (!els[mode].disabled) void CONFIRM[mode]();
    return;
  }

  if (mode !== 'search' && mode !== 'stale') return;

  if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
    e.preventDefault();
    cursor = Math.min(cursor + 1, visible.length - 1);
    updateSelection();
  } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
    e.preventDefault();
    cursor = Math.max(cursor - 1, 0);
    updateSelection();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (visible[cursor]) void activate(visible[cursor]);
  }
});

(async () => {
  localizeDocument();
  await load();
  render();
  els.query.focus();
})();

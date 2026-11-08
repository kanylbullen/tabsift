// Flikpaletten. Körs i popup-kontexten och pratar direkt med chrome.tabs —
// ingen bakgrundskanal, inga content scripts, inget som rör sidornas innehåll.

import { getSettings } from '../lib/settings.js';
import {
  queryTabs, tabUrl, planDedupe, applyDedupe, undoClose,
  planStale, closeWithUndo, formatAge, applyGrouping, focusTab, colorFor,
} from '../lib/tabs.js';
import { normalizeUrl, displayHost } from '../lib/urlkey.js';
import { planGrouping } from '../lib/grouping.js';
import { matchBest } from '../lib/fuzzy.js';

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
/** Flik-id:n användaren bockat ur i förhandsvisningen av inaktiva flikar. */
let staleKeep = new Set();
let visible = [];
let cursor = 0;

// ------------------------------------------------------------------ hjälpare

/** Bygger DOM med textnoder — flikrubriker är opålitlig indata från webbsidor. */
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

// ------------------------------------------------------------------- laddning

async function load() {
  settings = await getSettings();
  tabs = await queryTabs({ allWindows: settings.dedupe.allWindows });

  const seen = new Map();
  dupKeys = new Set();
  for (const t of tabs) {
    const key = normalizeUrl(tabUrl(t), settings.dedupe);
    if (!key) continue;
    if (seen.has(key)) dupKeys.add(key);
    else seen.set(key, t.id);
  }

  const { lastClose } = await chrome.storage.local.get('lastClose');
  const fresh = lastClose && Date.now() - lastClose.at < 10 * 60 * 1000;
  els.undo.hidden = !fresh;
  if (fresh) els.undo.textContent = `Ångra (${lastClose.tabs.length})`;
}

// -------------------------------------------------------------------- render

function renderCounts() {
  els.counts.textContent = '';
  const dupTabs = tabs.filter((t) => dupKeys.has(normalizeUrl(tabUrl(t), settings.dedupe)));

  /** @type {[number|null, string][]} */
  const parts = [[tabs.length, 'flikar']];
  if (dupTabs.length) parts.push([dupTabs.length, 'dubbletter']);
  const stale = planStale(tabs, Date.now(), settings.stale).length;
  if (stale) parts.push([stale, `inaktiva > ${settings.stale.days} d`]);
  if (settings.provider === 'none') parts.push([null, 'AI av']);

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
  els.empty.textContent = visible.length ? '' : 'Ingen flik matchar.';
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

  if (tab.pinned) li.appendChild(chip('fäst'));
  if (tab.audible) li.appendChild(chip('ljud'));
  if (dupKeys.has(normalizeUrl(tabUrl(tab), settings.dedupe))) {
    li.appendChild(chip('dubblett', 'dup'));
  }

  const close = document.createElement('button');
  close.className = 'close';
  close.type = 'button';
  close.textContent = '×';
  close.title = 'Stäng fliken';
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
      els.empty.textContent = 'Inga dubbletter hittades.';
      return;
    }
    for (const entry of dedupePlan) {
      const section = document.createElement('div');
      section.className = 'section';

      const h = document.createElement('h2');
      h.textContent = entry.keep.title || displayHost(tabUrl(entry.keep));
      const src = document.createElement('span');
      src.className = 'src';
      src.textContent = `${entry.close.length + 1} kopior`;
      h.appendChild(src);

      const ul = document.createElement('ul');
      const kept = document.createElement('li');
      kept.className = 'kept';
      kept.textContent = displayHost(tabUrl(entry.keep));
      ul.appendChild(kept);
      for (const t of entry.close) {
        const li = document.createElement('li');
        li.className = 'gone';
        li.textContent = t.title || tabUrl(t);
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
      els.empty.textContent = 'Inget att gruppera.';
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
        `${g.source === 'ai' ? 'AI' : 'regel'} · ${g.tabs.length} · ${colorFor(g.title)}`;
      h.append(src);

      const ul = document.createElement('ul');
      for (const t of g.tabs.slice(0, 6)) {
        const li = document.createElement('li');
        li.textContent = t.title || tabUrl(t);
        ul.appendChild(li);
      }
      if (g.tabs.length > 6) {
        const li = document.createElement('li');
        li.textContent = `… och ${g.tabs.length - 6} till`;
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
    els.empty.textContent = `Ingen flik har varit inaktiv i mer än ${settings.stale.days} dagar.`;
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
    box.setAttribute('aria-label', 'Stäng den här fliken');
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
  ['dedupe', 'Dubbletter', 'Ctrl+D'],
  ['group', 'Gruppera', 'Ctrl+G'],
  ['stale', 'Inaktiva', 'Ctrl+I'],
];

function renderFooter() {
  if (mode === 'search') {
    for (const [m, label, key] of MODES) {
      labelWithKey(els[m], label, key);
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
    own.textContent = n ? `Stäng ${n} flikar` : 'Inget att stänga';
    own.disabled = !n;
  } else if (mode === 'stale') {
    const n = (stalePlan ?? []).filter((t) => !staleKeep.has(t.id)).length;
    own.textContent = n ? `Stäng ${n} flikar` : 'Inget att stänga';
    own.disabled = !n;
  } else {
    const n = (groupPlan?.groups ?? []).reduce((s, g) => s + g.tabs.length, 0);
    own.textContent = n ? `Gruppera ${n} flikar` : 'Inget att gruppera';
    own.disabled = !n;
  }

  // En av de andra knapparna blir Avbryt, resten göms.
  const others = MODES.map(([m]) => m).filter((m) => m !== mode);
  others.forEach((m, i) => {
    const b = els[m];
    b.hidden = i > 0;
    b.className = 'action ghost';
    b.textContent = 'Avbryt';
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
  setNotice('Analyserar flikar…');
  els.group.disabled = true;
  try {
    groupPlan = await planGrouping(settings);
    mode = 'group';
    els.query.disabled = true;
    setNotice(groupPlan.aiError ?? (groupPlan.aiUsed ? 'AI användes för de flikar reglerna missade.' : ''), !!groupPlan.aiError);
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
  setNotice(closed ? `Stängde ${closed} flikar.` : 'Inga flikar stängdes.');
}

async function confirmStale() {
  const toClose = (stalePlan ?? []).filter((t) => !staleKeep.has(t.id));
  const { closed } = await closeWithUndo(toClose);
  await load();
  backToSearch();
  setNotice(closed ? `Stängde ${closed} inaktiva flikar.` : 'Inga flikar stängdes.');
}

async function confirmGroup() {
  const assignments = new Map((groupPlan?.groups ?? []).map((g) => [g.title, g.tabs]));
  const { grouped, created } = await applyGrouping(assignments, {
    collapseNew: settings.grouping.collapseNew,
  });
  await load();
  backToSearch();
  setNotice(`Grupperade ${grouped} flikar i ${created} nya grupper.`);
}

// ------------------------------------------------------------------ händelser

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
  setNotice(`Öppnade ${reopened} flikar igen.`);
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
  await load();
  render();
  els.query.focus();
})();

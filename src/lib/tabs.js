// Tab logic: querying, duplicate planning, inactive tabs, grouping, undo.
// Nothing here calls an AI — everything in this file is deterministic.

import { normalizeUrl, isNewTabPage, displayHost } from './urlkey.js';
import { t, tn } from './i18n.js';

export function tabUrl(tab) {
  return tab.url || tab.pendingUrl || '';
}

export async function queryTabs({ allWindows = false } = {}) {
  const query = allWindows ? {} : { currentWindow: true };
  const tabs = await chrome.tabs.query(query);
  // Without the "tabs" permission url/title are empty. The extension is then
  // pointless, so we let that show rather than silently doing the wrong thing.
  return tabs.filter((tab) => typeof tab.id === 'number');
}

// ---------------------------------------------------------------- duplicates

/**
 * Picks which tab in a set of duplicates to keep.
 * Priority: pinned > active > playing audio > already grouped > most recently used.
 */
function keeperScore(tab) {
  let s = 0;
  if (tab.pinned) s += 1_000_000;
  if (tab.active) s += 100_000;
  if (tab.audible) s += 10_000;
  if (tab.groupId !== undefined && tab.groupId !== -1) s += 1_000;
  s += (tab.lastAccessed ?? 0) / 1e9;
  return s;
}

/**
 * Works out what a duplicate cleanup would do — without doing it.
 * @returns {{keep: chrome.tabs.Tab, close: chrome.tabs.Tab[], key: string}[]}
 */
export function planDedupe(tabs, opts = {}) {
  const buckets = new Map();

  for (const tab of tabs) {
    const url = tabUrl(tab);
    if (!url) continue;
    if (!opts.includeNewTabPages && isNewTabPage(url)) continue;

    const key = normalizeUrl(url, opts);
    if (!key) continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(tab);
  }

  const plan = [];
  for (const [key, group] of buckets) {
    if (group.length < 2) continue;

    const sorted = [...group].sort((a, b) => keeperScore(b) - keeperScore(a));
    const keep = sorted[0];
    // Pinned tabs are never closed, however many duplicates they have.
    const close = sorted.slice(1).filter((tab) => !tab.pinned);
    if (close.length === 0) continue;

    plan.push({ key, keep, close });
  }

  // Biggest cleanup first in the UI.
  plan.sort((a, b) => b.close.length - a.close.length);
  return plan;
}

/**
 * Applies a plan and saves what was closed so it can be undone.
 * @returns {Promise<{closed: number}>}
 */
export async function applyDedupe(plan) {
  return closeWithUndo(plan.flatMap((entry) => entry.close));
}

/**
 * Closes tabs and saves them so the latest cleanup can be undone — whether it
 * came from duplicates or inactive tabs.
 * @returns {Promise<{closed: number}>}
 */
export async function closeWithUndo(toClose) {
  if (toClose.length === 0) return { closed: 0 };

  const undo = toClose.map((tab) => ({
    url: tabUrl(tab),
    windowId: tab.windowId,
    index: tab.index,
    pinned: tab.pinned,
  }));

  // Save before closing: when the active tab is among them the popup is
  // dismissed along with it, and anything after the removal may never run.
  await chrome.storage.local.set({
    lastClose: { at: Date.now(), tabs: undo },
  });
  try {
    await chrome.tabs.remove(toClose.map((tab) => tab.id));
  } catch (err) {
    // Nothing (or not everything) closed, so an undo would open duplicates.
    await chrome.storage.local.remove('lastClose');
    throw err;
  }

  return { closed: toClose.length };
}

/** Reopens the tabs the latest cleanup closed. */
export async function undoClose() {
  const { lastClose } = await chrome.storage.local.get('lastClose');
  if (!lastClose || !lastClose.tabs?.length) return { reopened: 0 };

  const openWindows = new Set((await chrome.windows.getAll()).map((w) => w.id));

  for (const tab of lastClose.tabs) {
    const create = { url: tab.url, active: false, pinned: tab.pinned };
    if (openWindows.has(tab.windowId)) create.windowId = tab.windowId;
    try {
      await chrome.tabs.create(create);
    } catch {
      // Internal pages (edge://…) can't always be opened programmatically.
    }
  }

  await chrome.storage.local.remove('lastClose');
  return { reopened: lastClose.tabs.length };
}

// ------------------------------------------------------------ search matches

/**
 * What "close all matches" may close from a list of search results.
 *
 * The palette's fuzzy search accepts any in-order subsequence of letters, so a
 * short query also lists tabs that don't contain it. Jumping to a tab can
 * afford that; closing can't. Only tabs where every word of the query appears
 * literally in the title or host qualify, and pinned tabs are always left
 * alone. Both kinds of left-out tab are counted so the UI can say so. Order is
 * kept, so the best match stays first in the preview.
 */
export function closableMatches(tabs, query) {
  const terms = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return { close: [], skippedPinned: 0, skippedLoose: 0 };

  const exact = tabs.filter((tab) => {
    const haystack = `${tab.title || ''} ${displayHost(tabUrl(tab))}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
  const close = exact.filter((tab) => !tab.pinned);
  return {
    close,
    skippedPinned: exact.length - close.length,
    skippedLoose: tabs.length - exact.length,
  };
}

// ------------------------------------------------------------ inactive tabs

const DAY = 24 * 60 * 60 * 1000;

/**
 * Tabs that haven't been active for `days` days, oldest first. Only works it
 * out — closes nothing.
 *
 * Pinned, active and audible tabs are never suggested, and neither are tabs
 * without a timestamp: better to miss an old tab than close one the browser
 * simply knows nothing about.
 * @returns {chrome.tabs.Tab[]}
 */
export function planStale(tabs, now, opts = {}) {
  const days = Number(opts.days);
  if (!(days > 0)) return [];
  const cutoff = now - days * DAY;

  return tabs
    .filter((tab) => {
      if (tab.pinned || tab.active || tab.audible) return false;
      if (!opts.includeGrouped && tab.groupId !== undefined && tab.groupId !== -1) return false;
      const at = tab.lastAccessed;
      return typeof at === 'number' && at > 0 && at <= cutoff;
    })
    .sort((a, b) => a.lastAccessed - b.lastAccessed);
}

/** "3 h", "5 days", "6 weeks", "4 mo" — coarse on purpose. */
export function formatAge(ms) {
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 24) return t('age_hours', Math.max(hours, 0));
  const days = Math.floor(ms / DAY);
  if (days < 14) return tn('age_days', days);
  if (days < 60) return t('age_weeks', Math.floor(days / 7));
  return t('age_months', Math.floor(days / 30));
}

// -------------------------------------------------------------------- groups

const GROUP_COLORS = [
  'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange', 'grey',
];

/** The same title always gets the same color, so groups look the same over time. */
export function colorFor(title) {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0;
  return GROUP_COLORS[h % GROUP_COLORS.length];
}

export async function existingGroups({ allWindows = false } = {}) {
  const query = allWindows ? {} : { windowId: chrome.windows.WINDOW_ID_CURRENT };
  try {
    return await chrome.tabGroups.query(query);
  } catch {
    return [];
  }
}

/**
 * Puts tabs into named groups. Reuses an existing group with the same title in
 * the same window, otherwise creates a new one.
 * @param {Map<string, chrome.tabs.Tab[]>} assignments title -> tabs
 */
export async function applyGrouping(assignments, opts = {}) {
  const groups = await existingGroups({ allWindows: true });
  const byWindowTitle = new Map();
  for (const g of groups) {
    if (g.title) byWindowTitle.set(`${g.windowId}::${g.title}`, g.id);
  }

  let grouped = 0;
  let created = 0;

  for (const [title, tabs] of assignments) {
    if (!title || tabs.length === 0) continue;

    // Tabs from different windows can't end up in the same group.
    const byWindow = new Map();
    for (const tab of tabs) {
      if (!byWindow.has(tab.windowId)) byWindow.set(tab.windowId, []);
      byWindow.get(tab.windowId).push(tab);
    }

    for (const [windowId, windowTabs] of byWindow) {
      const tabIds = windowTabs.map((tab) => tab.id);
      const existingId = byWindowTitle.get(`${windowId}::${title}`);

      try {
        if (existingId !== undefined) {
          await chrome.tabs.group({ tabIds, groupId: existingId });
        } else {
          const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
          await chrome.tabGroups.update(groupId, {
            title,
            color: colorFor(title),
            collapsed: !!opts.collapseNew,
          });
          byWindowTitle.set(`${windowId}::${title}`, groupId);
          created++;
        }
        grouped += tabIds.length;
      } catch (err) {
        console.warn('[tabsift] could not group', title, err);
      }
    }
  }

  return { grouped, created };
}

/** Jumps to a tab and focuses its window. */
export async function focusTab(tabId, windowId) {
  await chrome.tabs.update(tabId, { active: true });
  if (typeof windowId === 'number') {
    await chrome.windows.update(windowId, { focused: true });
  }
}

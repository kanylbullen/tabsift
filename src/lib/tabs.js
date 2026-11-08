// Fliklogik: hämtning, dubblettplanering, inaktiva flikar, gruppering, ångra.
// Ingenting här anropar en AI — allt i den här filen är deterministiskt.

import { normalizeUrl, isNewTabPage } from './urlkey.js';

export function tabUrl(tab) {
  return tab.url || tab.pendingUrl || '';
}

export async function queryTabs({ allWindows = false } = {}) {
  const query = allWindows ? {} : { currentWindow: true };
  const tabs = await chrome.tabs.query(query);
  // Utan "tabs"-behörighet är url/title tomma. Då är tillägget meningslöst,
  // så vi låter det märkas tydligt i stället för att tyst göra fel sak.
  return tabs.filter((t) => typeof t.id === 'number');
}

// ---------------------------------------------------------------- dubbletter

/**
 * Väljer vilken flik i en dubblettmängd som ska behållas.
 * Prioritet: fäst > aktiv > spelar ljud > redan grupperad > senast använd.
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
 * Räknar ut vad en dubblettstädning skulle göra — utan att göra det.
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
    // Fästa flikar stängs aldrig, oavsett hur många dubbletter de har.
    const close = sorted.slice(1).filter((t) => !t.pinned);
    if (close.length === 0) continue;

    plan.push({ key, keep, close });
  }

  // Störst städvinst först i UI:t.
  plan.sort((a, b) => b.close.length - a.close.length);
  return plan;
}

/**
 * Verkställer en plan och sparar det som stängdes så att det går att ångra.
 * @returns {Promise<{closed: number}>}
 */
export async function applyDedupe(plan) {
  return closeWithUndo(plan.flatMap((entry) => entry.close));
}

/**
 * Stänger flikar och sparar dem så att senaste städningen går att ångra —
 * oavsett om den kom från dubbletter eller inaktiva flikar.
 * @returns {Promise<{closed: number}>}
 */
export async function closeWithUndo(toClose) {
  if (toClose.length === 0) return { closed: 0 };

  const undo = toClose.map((t) => ({
    url: tabUrl(t),
    windowId: t.windowId,
    index: t.index,
    pinned: t.pinned,
  }));

  await chrome.tabs.remove(toClose.map((t) => t.id));
  await chrome.storage.local.set({
    lastClose: { at: Date.now(), tabs: undo },
  });

  return { closed: toClose.length };
}

/** Öppnar de flikar som senaste städningen stängde. */
export async function undoClose() {
  const { lastClose } = await chrome.storage.local.get('lastClose');
  if (!lastClose || !lastClose.tabs?.length) return { reopened: 0 };

  const openWindows = new Set((await chrome.windows.getAll()).map((w) => w.id));

  for (const t of lastClose.tabs) {
    const create = { url: t.url, active: false, pinned: t.pinned };
    if (openWindows.has(t.windowId)) create.windowId = t.windowId;
    try {
      await chrome.tabs.create(create);
    } catch {
      // Interna sidor (edge://…) går inte alltid att öppna programmatiskt.
    }
  }

  await chrome.storage.local.remove('lastClose');
  return { reopened: lastClose.tabs.length };
}

// ---------------------------------------------------------------- inaktiva

const DAY = 24 * 60 * 60 * 1000;

/**
 * Flikar som inte varit aktiva på `days` dagar, äldst först. Räknar bara ut
 * — stänger ingenting.
 *
 * Fästa, aktiva och ljudspelande flikar föreslås aldrig, och inte heller
 * flikar utan tidsstämpel: hellre missa en gammal flik än stänga en som
 * webbläsaren bara inte vet något om.
 * @returns {chrome.tabs.Tab[]}
 */
export function planStale(tabs, now, opts = {}) {
  const days = Number(opts.days);
  if (!(days > 0)) return [];
  const cutoff = now - days * DAY;

  return tabs
    .filter((t) => {
      if (t.pinned || t.active || t.audible) return false;
      if (!opts.includeGrouped && t.groupId !== undefined && t.groupId !== -1) return false;
      const at = t.lastAccessed;
      return typeof at === 'number' && at > 0 && at <= cutoff;
    })
    .sort((a, b) => a.lastAccessed - b.lastAccessed);
}

/** "3 tim", "5 dagar", "6 veckor", "4 mån" — grovt med flit. */
export function formatAge(ms) {
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 24) return `${Math.max(hours, 0)} tim`;
  const days = Math.floor(ms / DAY);
  if (days < 14) return days === 1 ? '1 dag' : `${days} dagar`;
  if (days < 60) return `${Math.floor(days / 7)} veckor`;
  return `${Math.floor(days / 30)} mån`;
}

// ----------------------------------------------------------------- grupper

const GROUP_COLORS = [
  'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange', 'grey',
];

/** Samma titel ger alltid samma färg, så grupper ser likadana ut över tid. */
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
 * Lägger flikar i namngivna grupper. Återanvänder en befintlig grupp med
 * samma titel i samma fönster, annars skapas en ny.
 * @param {Map<string, chrome.tabs.Tab[]>} assignments titel -> flikar
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

    // Flikar från olika fönster kan inte hamna i samma grupp.
    const byWindow = new Map();
    for (const t of tabs) {
      if (!byWindow.has(t.windowId)) byWindow.set(t.windowId, []);
      byWindow.get(t.windowId).push(t);
    }

    for (const [windowId, windowTabs] of byWindow) {
      const tabIds = windowTabs.map((t) => t.id);
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
        console.warn('[tabsift] kunde inte gruppera', title, err);
      }
    }
  }

  return { grouped, created };
}

/** Hoppar till en flik och fokuserar dess fönster. */
export async function focusTab(tabId, windowId) {
  await chrome.tabs.update(tabId, { active: true });
  if (typeof windowId === 'number') {
    await chrome.windows.update(windowId, { focused: true });
  }
}

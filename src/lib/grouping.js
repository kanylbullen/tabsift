// Orkestrering av gruppering: regler först, AI bara på resten.
//
// Poängen med ordningen är att AI:n aldrig behöver se de flikar en enkel
// domänregel redan klarar — färre tokens, snabbare svar, och tillägget
// fungerar helt utan AI om du vill.

import { queryTabs, tabUrl, existingGroups } from './tabs.js';
import { isNewTabPage, displayHost } from './urlkey.js';
import { categorize, ruleCategories } from './rules.js';
import { classify } from './ai/index.js';

/** Flikar som aldrig grupperas: fästa (kan inte ligga i grupper) och tomma. */
function isGroupable(tab) {
  if (tab.pinned) return false;
  const url = tabUrl(tab);
  if (!url || isNewTabPage(url)) return false;
  return true;
}

/**
 * Räknar ut en grupperingsplan utan att röra flikarna.
 * @returns {Promise<{
 *   groups: {title: string, source: 'rule'|'ai', tabs: chrome.tabs.Tab[]}[],
 *   ungrouped: chrome.tabs.Tab[],
 *   aiError: string | null,
 *   aiUsed: boolean,
 * }>}
 */
export async function planGrouping(settings) {
  const all = await queryTabs({ allWindows: settings.grouping.allWindows });

  let candidates = all.filter(isGroupable);
  if (settings.grouping.onlyUngrouped) {
    candidates = candidates.filter((t) => t.groupId === undefined || t.groupId === -1);
  }

  /** @type {Map<string, chrome.tabs.Tab[]>} */
  const byTitle = new Map();
  const sources = new Map();
  const leftovers = [];

  const add = (title, tab, source) => {
    if (!byTitle.has(title)) {
      byTitle.set(title, []);
      sources.set(title, source);
    }
    byTitle.get(title).push(tab);
  };

  // --- 1. Regelpasset (deterministiskt) ------------------------------------
  for (const tab of candidates) {
    const category = settings.grouping.useRules ? categorize(tabUrl(tab)) : null;
    if (category) add(category, tab, 'rule');
    else leftovers.push(tab);
  }

  // --- 2. AI-passet (bara det reglerna missade) -----------------------------
  let aiError = null;
  let aiUsed = false;

  if (settings.provider !== 'none' && leftovers.length > 0) {
    const cap = settings.grouping.maxAiTabs;
    const batch = leftovers.slice(0, cap);

    const payload = batch.map((t) => ({
      title: (t.title || '').slice(0, 120),
      host: displayHost(tabUrl(t)),
    }));

    const groups = await existingGroups({ allWindows: settings.grouping.allWindows });
    const groupNames = [
      ...new Set([...groups.map((g) => g.title).filter(Boolean), ...byTitle.keys()]),
    ];

    try {
      const result = await classify(settings, payload, groupNames, ruleCategories());
      aiUsed = true;
      batch.forEach((tab, i) => {
        const title = result.get(i);
        if (title) add(title, tab, 'ai');
      });
    } catch (err) {
      aiError = err.message;
    }

    if (batch.length < leftovers.length) {
      aiError = [aiError, `Endast de ${cap} första ogrupperade flikarna skickades till AI:n.`]
        .filter(Boolean)
        .join(' ');
    }
  }

  const assigned = new Set([...byTitle.values()].flat().map((t) => t.id));
  const ungrouped = candidates.filter((t) => !assigned.has(t.id));

  // Ensamma AI-grupper är oftast brus — släpp dem tillbaka till ogrupperat.
  const groups = [];
  for (const [title, tabs] of byTitle) {
    if (tabs.length < 2 && sources.get(title) === 'ai') {
      ungrouped.push(...tabs);
      continue;
    }
    groups.push({ title, source: sources.get(title), tabs });
  }

  groups.sort((a, b) => b.tabs.length - a.tabs.length || a.title.localeCompare(b.title, 'sv'));

  return { groups, ungrouped, aiError, aiUsed };
}

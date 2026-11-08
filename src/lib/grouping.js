// Grouping orchestration: rules first, AI only on the rest.
//
// The point of the order is that the AI never sees tabs a simple domain rule
// already handles — fewer tokens, faster answers, and the extension works
// entirely without AI if you want.

import { queryTabs, tabUrl, existingGroups } from './tabs.js';
import { isNewTabPage, displayHost } from './urlkey.js';
import { categorize, ruleCategories } from './rules.js';
import { classify } from './ai/index.js';
import { t, uiLanguage } from './i18n.js';

/** Tabs that are never grouped: pinned (can't be in groups) and empty ones. */
function isGroupable(tab) {
  if (tab.pinned) return false;
  const url = tabUrl(tab);
  if (!url || isNewTabPage(url)) return false;
  return true;
}

/**
 * Works out a grouping plan without touching the tabs.
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

  // --- 1. Rule pass (deterministic) ------------------------------------------
  for (const tab of candidates) {
    const category = settings.grouping.useRules ? categorize(tabUrl(tab)) : null;
    if (category) add(category, tab, 'rule');
    else leftovers.push(tab);
  }

  // --- 2. AI pass (only what the rules missed) ------------------------------
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
      const result = await classify(settings, payload, groupNames, ruleCategories(), uiLanguage());
      aiUsed = true;
      batch.forEach((tab, i) => {
        const title = result.get(i);
        if (title) add(title, tab, 'ai');
      });
    } catch (err) {
      aiError = err.message;
    }

    if (batch.length < leftovers.length) {
      aiError = [aiError, t('ai_capped', cap)]
        .filter(Boolean)
        .join(' ');
    }
  }

  const assigned = new Set([...byTitle.values()].flat().map((t) => t.id));
  const ungrouped = candidates.filter((t) => !assigned.has(t.id));

  // Single-tab AI groups are usually noise — release them back to ungrouped.
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

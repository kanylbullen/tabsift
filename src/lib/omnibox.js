// Address bar integration via chrome.omnibox.
//
// The limitation is the browser's, not ours: an extension can only take part in
// the address bar behind a keyword. Type `t` followed by space or Tab, and every
// keystroke after that comes to us instead of the search engine. The browser's
// own "Switch to this tab" ranking still can't be influenced — there is no API.
//
// The keyword is set in manifest.json under "omnibox".keyword and can't be
// changed at runtime.

import { queryTabs, tabUrl, focusTab } from './tabs.js';
import { displayHost, isNewTabPage } from './urlkey.js';
import { matchBest } from './fuzzy.js';
import { t, tn } from './i18n.js';

const MAX_SUGGESTIONS = 8;
const TITLE_MAX = 80;
const CACHE_MS = 2000;

let cache = { at: 0, tabs: [] };
let lastRanked = [];

/** The five predefined XML entities must be escaped in a description. */
export function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncate(text, max) {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

/**
 * Builds a description with <match> around matched characters. Escape first,
 * then tag — never the other way round, or a tab title could inject markup.
 */
export function describe(title, host, positions = []) {
  const shown = truncate(title, TITLE_MAX);
  const hit = new Set(positions.filter((p) => p < shown.length));

  let out = '';
  let run = '';
  let runMatched = hit.has(0);

  const flush = () => {
    if (!run) return;
    out += runMatched ? `<match>${escapeXml(run)}</match>` : escapeXml(run);
    run = '';
  };

  for (let i = 0; i < shown.length; i++) {
    const matched = hit.has(i);
    if (matched !== runMatched) {
      flush();
      runMatched = matched;
    }
    run += shown[i];
  }
  flush();

  return `${out} <dim>—</dim> <url>${escapeXml(host)}</url>`;
}

/**
 * Ranks tabs against a query. Pure function — testable without a browser.
 * @param {{id:number,title:string,url:string,lastAccessed?:number}[]} tabs
 * @returns {{tabId:number, content:string, description:string}[]}
 */
export function buildSuggestions(tabs, query) {
  const q = query.trim();
  const ranked = [];

  for (const tab of tabs) {
    const url = tabUrl(tab);
    if (!url || isNewTabPage(url)) continue;

    const title = tab.title || url;
    const host = displayHost(url);

    if (!q) {
      ranked.push({ tab, title, host, positions: [], score: tab.lastAccessed ?? 0 });
      continue;
    }
    const res = matchBest(q, [{ text: title, weight: 1 }, { text: host, weight: 0.9 }]);
    if (res) {
      ranked.push({
        tab, title, host,
        positions: res.field === title ? res.positions : [],
        score: res.score,
      });
    }
  }

  ranked.sort((a, b) => b.score - a.score);

  return ranked.slice(0, MAX_SUGGESTIONS).map((r) => ({
    tabId: r.tab.id,
    content: tabUrl(r.tab),
    description: describe(r.title, r.host, r.positions),
  }));
}

async function currentTabs() {
  const now = Date.now();
  if (now - cache.at < CACHE_MS && cache.tabs.length) return cache.tabs;
  // All windows: the point of the address bar is finding the tab wherever it is.
  cache = { at: now, tabs: await queryTabs({ allWindows: true }) };
  return cache.tabs;
}

export function registerOmnibox() {
  if (!chrome.omnibox) return;

  chrome.omnibox.setDefaultSuggestion({
    description: `${escapeXml(t('omni_default'))} — <dim>${escapeXml(t('omni_default_hint'))}</dim>`,
  });

  chrome.omnibox.onInputStarted.addListener(() => {
    cache = { at: 0, tabs: [] };
    lastRanked = [];
  });

  chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
    const tabs = await currentTabs();
    const suggestions = buildSuggestions(tabs, text);
    lastRanked = suggestions;

    chrome.omnibox.setDefaultSuggestion({
      description: suggestions.length
        ? `${escapeXml(t('omni_switch_to'))} <match>${escapeXml(truncate(text.trim() || t('omni_recent'), 40))}</match> <dim>— ${escapeXml(tn('omni_hits', suggestions.length))}</dim>`
        : `<dim>${escapeXml(t('omni_no_match'))}</dim> <match>${escapeXml(truncate(text.trim(), 40))}</match>`,
    });

    // The first suggestion lands below the non-selectable default row, so we
    // send all of them — including the top hit.
    suggest(suggestions.map(({ content, description }) => ({ content, description })));
  });

  chrome.omnibox.onInputEntered.addListener(async (text) => {
    // If the user picked a suggestion, text === its content. If they just pressed
    // Enter on the default row we get the raw query — take the top hit then.
    const picked =
      lastRanked.find((s) => s.content === text) ??
      (lastRanked.length ? lastRanked[0] : null);

    if (!picked) return;

    try {
      const tab = await chrome.tabs.get(picked.tabId);
      await focusTab(tab.id, tab.windowId);
    } catch {
      // The tab was closed between the suggestion and Enter.
    }
  });

  chrome.omnibox.onInputCancelled.addListener(() => {
    cache = { at: 0, tabs: [] };
    lastRanked = [];
  });
}

// Adressfältsintegration via chrome.omnibox.
//
// Begränsningen är webbläsarens, inte vår: ett tillägg kan bara delta i
// adressfältet bakom ett nyckelord. Skriv `t` följt av mellanslag eller Tab, så
// går varje tangenttryck därefter till oss i stället för till sökmotorn.
// Webbläsarens egen "Byt till den här fliken"-rankning går fortfarande inte att
// påverka — det finns inget API för den.
//
// Nyckelordet sätts i manifest.json under "omnibox".keyword och går inte att
// ändra i körtid.

import { queryTabs, tabUrl, focusTab } from './tabs.js';
import { displayHost, isNewTabPage } from './urlkey.js';
import { matchBest } from './fuzzy.js';

const MAX_SUGGESTIONS = 8;
const TITLE_MAX = 80;
const CACHE_MS = 2000;

let cache = { at: 0, tabs: [] };
let lastRanked = [];

/** De fem fördefinierade XML-entiteterna måste escapas i description. */
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
 * Bygger en description med <match> runt träffade tecken. Escapar först,
 * taggar sedan — aldrig tvärtom, annars kan en flikrubrik injicera markup.
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
 * Rangordnar flikar mot en fråga. Ren funktion — testbar utan webbläsare.
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
  // Alla fönster: poängen med adressfältet är att hitta fliken oavsett var den ligger.
  cache = { at: now, tabs: await queryTabs({ allWindows: true }) };
  return cache.tabs;
}

export function registerOmnibox() {
  if (!chrome.omnibox) return;

  chrome.omnibox.setDefaultSuggestion({
    description: 'Sök bland öppna flikar — <dim>skriv för att filtrera, Enter byter flik</dim>',
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
        ? `Byt till <match>${escapeXml(truncate(text.trim() || 'senaste fliken', 40))}</match> <dim>— ${suggestions.length} träffar</dim>`
        : `<dim>Ingen öppen flik matchar</dim> <match>${escapeXml(truncate(text.trim(), 40))}</match>`,
    });

    // Det första förslaget hamnar under den icke-valbara standardraden, så vi
    // skickar med alla — inklusive topträffen.
    suggest(suggestions.map(({ content, description }) => ({ content, description })));
  });

  chrome.omnibox.onInputEntered.addListener(async (text) => {
    // Valde användaren ett förslag är text === dess content. Tryckte hen bara
    // Enter på standardraden får vi den råa frågan — ta topträffen då.
    const picked =
      lastRanked.find((s) => s.content === text) ??
      (lastRanked.length ? lastRanked[0] : null);

    if (!picked) return;

    try {
      const tab = await chrome.tabs.get(picked.tabId);
      await focusTab(tab.id, tab.windowId);
    } catch {
      // Fliken hann stängas mellan förslaget och Enter.
    }
  });

  chrome.omnibox.onInputCancelled.addListener(() => {
    cache = { at: 0, tabs: [] };
    lastRanked = [];
  });
}

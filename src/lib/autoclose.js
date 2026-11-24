// Automatic cleanup: close tabs that match a rule once they have been inactive
// for that rule's number of hours. The planning is pure; the two functions at
// the bottom touch the browser.

import { tabUrl } from './tabs.js';

const HOUR = 60 * 60 * 1000;
export const LOG_MAX = 100;
export const MIN_HOURS = 0.1; // 6 minutes; the sweep runs every 5

/**
 * Turns what the user typed into something matchable, or null when it is empty.
 *   github.com            the host and its subdomains
 *   github.com/pulls      … only paths that start with /pulls
 *   *.atlassian.net       `*` matches any run of characters
 * A scheme in front (https://) is ignored.
 */
export function parsePattern(raw) {
  let s = String(raw ?? '').trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  const slash = s.indexOf('/');
  const host = (slash === -1 ? s : s.slice(0, slash)).replace(/\.+$/, '');
  const path = slash === -1 ? '' : s.slice(slash);
  if (!host || host === '*') return null;
  return { host, path: path === '/' ? '' : path, source: s };
}

const globToRegex = (glob) =>
  new RegExp(`^${glob.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}`);

/** Does a parsed pattern match this URL? Only http(s) pages ever match. */
export function matchesPattern(parsed, url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;

  const host = u.hostname.toLowerCase();
  const hostOk = parsed.host.includes('*')
    ? new RegExp(`${globToRegex(parsed.host).source}$`).test(host)
    : host === parsed.host || host.endsWith(`.${parsed.host}`);
  if (!hostOk) return false;

  if (!parsed.path) return true;
  return parsed.path.includes('*')
    ? globToRegex(parsed.path).test(u.pathname.toLowerCase())
    : u.pathname.toLowerCase().startsWith(parsed.path);
}

/** Rules as saved by the options page, minus anything unusable. */
export function usableRules(rules) {
  const out = [];
  for (const r of Array.isArray(rules) ? rules : []) {
    const parsed = parsePattern(r?.pattern);
    const hours = Number(r?.hours);
    if (parsed && hours >= MIN_HOURS) out.push({ parsed, hours });
  }
  return out;
}

/**
 * Which tabs are due to be closed, and by which rule. Closes nothing.
 *
 * Never due: pinned, active and audible tabs; tabs in a group unless
 * `includeGrouped`; tabs without a timestamp (better to miss one than to close
 * a tab the browser knows nothing about). When several rules match a tab the
 * most specific (longest) pattern decides.
 * @returns {{tab: chrome.tabs.Tab, pattern: string}[]}
 */
export function planAutoClose(tabs, now, opts = {}) {
  const rules = usableRules(opts.rules);
  if (!rules.length) return [];

  const due = [];
  for (const tab of tabs) {
    if (tab.pinned || tab.active || tab.audible) continue;
    if (!opts.includeGrouped && tab.groupId !== undefined && tab.groupId !== -1) continue;
    const at = tab.lastAccessed;
    if (typeof at !== 'number' || !(at > 0)) continue;

    const url = tabUrl(tab);
    let best = null;
    for (const rule of rules) {
      if (!matchesPattern(rule.parsed, url)) continue;
      if (!best || rule.parsed.source.length > best.parsed.source.length) best = rule;
    }
    if (best && now - at >= best.hours * HOUR) due.push({ tab, pattern: best.parsed.source });
  }
  return due;
}

// ------------------------------------------------------------------ browser

/**
 * Closes the due tabs one at a time (one that has already gone must not stop
 * the rest) and records the ones that really closed, newest first, so the
 * options page can reopen them.
 * @returns {Promise<{closed: number}>}
 */
export async function applyAutoClose(plan, now = Date.now()) {
  const done = [];
  for (const { tab, pattern } of plan) {
    try {
      await chrome.tabs.remove(tab.id);
      done.push({ url: tabUrl(tab), title: tab.title || '', at: now, pattern });
    } catch {
      // The tab was closed already.
    }
  }
  if (done.length) {
    const { autoClosed = [] } = await chrome.storage.local.get('autoClosed');
    await chrome.storage.local.set({
      autoClosed: [...done.reverse(), ...autoClosed].slice(0, LOG_MAX),
    });
  }
  return { closed: done.length };
}

/** Reopens one logged tab (in the background) and drops it from the log. */
export async function reopenAutoClosed(entry) {
  await chrome.tabs.create({ url: entry.url, active: false });
  const { autoClosed = [] } = await chrome.storage.local.get('autoClosed');
  await chrome.storage.local.set({
    autoClosed: autoClosed.filter((e) => !(e.url === entry.url && e.at === entry.at)),
  });
}

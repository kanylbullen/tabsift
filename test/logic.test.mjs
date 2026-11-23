import { readFileSync, readdirSync } from 'node:fs';
import { normalizeUrl, isNewTabPage } from '../src/lib/urlkey.js';
import { matchBest } from '../src/lib/fuzzy.js';
import { categorize, RULES } from '../src/lib/rules.js';
import { PROVIDERS } from '../src/lib/ai/index.js';
import { MODELS } from '../src/lib/ai/anthropic.js';
import { DEFAULTS, LEGACY_MODELS } from '../src/lib/settings.js';
import { planDedupe, planStale, closableMatches, formatAge, colorFor } from '../src/lib/tabs.js';
import { escapeXml, describe as omniDescribe, buildSuggestions } from '../src/lib/omnibox.js';

// chrome.i18n stand-in with the same substitution rules as the browser:
// $NAME$ -> the placeholder's content, whose $1..$9 -> the substitutions.
const catalog = (lang) =>
  JSON.parse(readFileSync(new URL(`../_locales/${lang}/messages.json`, import.meta.url)));
function fakeI18n(lang) {
  const msgs = catalog(lang);
  return {
    getUILanguage: () => lang,
    getMessage(key, subs = []) {
      const m = msgs[key];
      if (!m) return '';
      return m.message.replace(/\$([A-Za-z0-9_]+)\$/g, (_, name) => {
        const ph = m.placeholders?.[name.toLowerCase()];
        return ph ? ph.content.replace(/\$(\d)/g, (_, n) => subs[n - 1] ?? '') : '';
      });
    },
  };
}
globalThis.chrome = { i18n: fakeI18n('en') };

let fail = 0;
const eq = (name, a, b) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { console.log(`FAIL ${name}\n  got      ${JSON.stringify(a)}\n  expected ${JSON.stringify(b)}`); fail++; }
  else console.log(`ok   ${name}`);
};

const O = { ignoreHash: true, stripTracking: true, ignoreTrailingSlash: true };

// --- URL normalization
eq('www + http/https treated as equal',
  normalizeUrl('http://www.example.com/a/', O), normalizeUrl('https://example.com/a', O));
eq('utm is stripped',
  normalizeUrl('https://x.se/p?utm_source=nl&id=7', O), 'https://x.se/p?id=7');
eq('query is sorted',
  normalizeUrl('https://x.se/p?b=2&a=1', O), normalizeUrl('https://x.se/p?a=1&b=2', O));
eq('fragment is ignored',
  normalizeUrl('https://x.se/p#top', O), 'https://x.se/p');
eq('fragment kept when the option is off',
  normalizeUrl('https://x.se/p#top', {...O, ignoreHash:false}), 'https://x.se/p#top');
eq('different pages are not mixed up',
  normalizeUrl('https://x.se/a', O) === normalizeUrl('https://x.se/b', O), false);
eq('port is preserved',
  normalizeUrl('http://localhost:3000/x', O), 'https://localhost:3000/x');
eq('new tab page is recognized', isNewTabPage('edge://newtab/'), true);

// --- rules
eq('github -> Code', categorize('https://github.com/foo/bar'), 'Code');
eq('subdomain matches', categorize('https://gist.github.com/x'), 'Code');
eq('localhost -> Local', categorize('http://localhost:5173/'), 'Local');
eq('unknown domain -> null', categorize('https://something-random.example/'), null);
eq('github.com.evil.se does NOT match', categorize('https://github.com.evil.se/x'), null);

// --- fuzzy
eq('fuzzy matches a subsequence', !!matchBest('gh', [{text:'GitHub'}]), true);
eq('fuzzy rejects a non-match', matchBest('zzz', [{text:'GitHub'}]), null);
const a = matchBest('git', [{text:'GitHub — pull request'}]).score;
const b = matchBest('git', [{text:'Something about digital signing'}]).score;
eq('prefix match ranks above embedded match', a > b, true);

// --- dedupe plan
const t = (id, url, extra={}) => ({ id, url, windowId: 1, index: id, pinned:false, active:false, audible:false, groupId:-1, lastAccessed: id*1000, title:'t'+id, ...extra });
const plan = planDedupe([
  t(1, 'https://example.com/a'),
  t(2, 'https://www.example.com/a/?utm_source=x'),
  t(3, 'https://example.com/b'),
  t(4, 'edge://newtab/'),
  t(5, 'edge://newtab/'),
], { ...O, includeNewTabPages: false });
eq('one duplicate set found', plan.length, 1);
eq('most recently used is kept', plan[0].keep.id, 2);
eq('one tab marked for closing', plan[0].close.map(x=>x.id), [1]);

const pinnedPlan = planDedupe([
  t(1, 'https://example.com/a', { pinned:true }),
  t(2, 'https://example.com/a'),
], O);
eq('pinned tab is kept', pinnedPlan[0].keep.id, 1);
eq('pinned tab is never closed', pinnedPlan[0].close.map(x=>x.id), [2]);

const bothPinned = planDedupe([
  t(1, 'https://example.com/a', { pinned:true }),
  t(2, 'https://example.com/a', { pinned:true }),
], O);
eq('two pinned duplicates -> no action', bothPinned.length, 0);

const withNewTabs = planDedupe([t(4,'edge://newtab/'), t(5,'edge://newtab/')], { ...O, includeNewTabPages: true });
eq('new tabs are deduped when the option is on', withNewTabs.length, 1);

// --- inactive tabs
const DAY = 86_400_000;
const NOW = 100 * DAY;
const ago = (d) => NOW - d * DAY;
const staleTabs = [
  t(1, 'https://a.se/', { lastAccessed: ago(10) }),
  t(2, 'https://b.se/', { lastAccessed: ago(30) }),
  t(3, 'https://c.se/', { lastAccessed: ago(2) }),
  t(4, 'https://d.se/', { lastAccessed: ago(40), pinned: true }),
  t(5, 'https://e.se/', { lastAccessed: ago(40), active: true }),
  t(6, 'https://f.se/', { lastAccessed: ago(40), audible: true }),
  t(7, 'https://g.se/', { lastAccessed: ago(40), groupId: 3 }),
  t(8, 'https://h.se/', { lastAccessed: undefined }),
  t(9, 'https://i.se/', { lastAccessed: 0 }),
];
eq('inactive oldest first, only past the threshold',
  planStale(staleTabs, NOW, { days: 7 }).map(x=>x.id), [2, 1]);
eq('pinned, active and audible are never suggested',
  planStale(staleTabs, NOW, { days: 7, includeGrouped: true }).map(x=>x.id), [7, 2, 1]);
eq('tab without timestamp is never suggested',
  planStale(staleTabs, NOW, { days: 1 }).some(x => x.id === 8 || x.id === 9), false);
eq('exactly at the threshold counts as inactive',
  planStale([t(1, 'https://a.se/', { lastAccessed: ago(7) })], NOW, { days: 7 }).length, 1);
eq('invalid day count suggests nothing',
  planStale(staleTabs, NOW, { days: 0 }).length, 0);
eq('age in hours', formatAge(5 * 3_600_000), '5 h');
eq('age one day', formatAge(DAY), '1 day');
eq('age in days', formatAge(10 * DAY), '10 days');
eq('age in weeks', formatAge(30 * DAY), '4 weeks');
eq('age in months', formatAge(90 * DAY), '3 mo');

// --- search matches
const found = [t(1,'https://a.se/'), t(2,'https://b.se/',{pinned:true}), t(3,'https://c.se/',{active:true}), t(4,'https://d.se/')];
const cm = closableMatches(found);
eq('close-matches leaves pinned tabs alone', cm.close.map(x=>x.id), [1, 3, 4]);
eq('close-matches counts the pinned it skipped', cm.skippedPinned, 1);
eq('close-matches keeps the ranking order', closableMatches([found[3], found[0]]).close.map(x=>x.id), [4, 1]);
eq('no matches closes nothing', closableMatches([]), { close: [], skippedPinned: 0 });

// --- colors
eq('color is deterministic', colorFor('Code'), colorFor('Code'));

// --- omnibox
eq('escapes all five XML entities',
  escapeXml(`&<>"'`), '&amp;&lt;&gt;&quot;&apos;');
eq('tab title cannot inject markup',
  omniDescribe('Evil <match>fake</match> & co', 'x.se').includes('&lt;match&gt;'), true);
eq('injected tag becomes text, not markup',
  omniDescribe('<url>evil</url>', 'x.se').startsWith('&lt;url&gt;'), true);
eq('host is escaped too',
  omniDescribe('t', 'a&b.se').includes('<url>a&amp;b.se</url>'), true);
eq('matched characters are marked',
  omniDescribe('GitHub', 'github.com', [0,1,2]).startsWith('<match>Git</match>'), true);

const otabs = [
  { id: 11, url: 'https://github.com/foo/bar', title: 'Pull request #412', lastAccessed: 300 },
  { id: 12, url: 'https://stackoverflow.com/q/1', title: 'OAuth redirect_uri mismatch', lastAccessed: 200 },
  { id: 13, url: 'edge://newtab/', title: 'New tab', lastAccessed: 400 },
];
const sugg = buildSuggestions(otabs, 'oauth');
eq('omnibox matches on title', sugg.map(s=>s.tabId), [12]);
eq('omnibox skips empty new tabs',
  buildSuggestions(otabs, '').map(s=>s.tabId), [11, 12]);
eq('omnibox matches on domain', buildSuggestions(otabs, 'github').map(s=>s.tabId), [11]);
eq('content is the tab URL', sugg[0].content, 'https://stackoverflow.com/q/1');
eq('no matches give an empty list', buildSuggestions(otabs, 'zzzzz').length, 0);

// --- Anthropic models
const modelIds = MODELS.map((m) => m.id);
eq('default Anthropic model is in the picker', modelIds.includes(DEFAULTS.anthropic.model), true);
eq('every legacy model id maps to one in the picker',
  Object.values(LEGACY_MODELS).filter((id) => !modelIds.includes(id)), []);

// --- localization
globalThis.chrome = { i18n: fakeI18n('sv') };
eq('Swedish: rule category', categorize('https://github.com/foo/bar'), 'Kod');
eq('Swedish: plural one', formatAge(DAY), '1 dag');
eq('Swedish: plural other', formatAge(10 * DAY), '10 dagar');
globalThis.chrome = { i18n: fakeI18n('en') };

const en = catalog('en'), sv = catalog('sv');
const placeholders = (m) => Object.keys(m.placeholders ?? {}).sort().join();
eq('en and sv have the same keys', Object.keys(sv).sort(), Object.keys(en).sort());
eq('en and sv use the same placeholders',
  Object.keys(en).filter((k) => sv[k] && placeholders(en[k]) !== placeholders(sv[k])), []);

// Every t('key') / tn('key') in the source must exist in the catalog.
const srcFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
  d.isDirectory() ? srcFiles(`${dir}/${d.name}`) : /\.(js|html)$/.test(d.name) ? [`${dir}/${d.name}`] : []);
const root = new URL('..', import.meta.url).pathname;
const used = new Set();
for (const f of srcFiles(`${root}src`)) {
  const code = readFileSync(f, 'utf8');
  for (const m of code.matchAll(/\bt\('([a-z0-9_]+)'/g)) used.add(m[1]);
  for (const m of code.matchAll(/\btn\('([a-z0-9_]+)'/g)) used.add(`${m[1]}_one`).add(`${m[1]}_other`);
  if (f.endsWith('.html')) {
    for (const m of code.matchAll(/data-i18n(?:-[a-z-]+)?="([a-z0-9_]+)"/g)) used.add(m[1]);
  }
  for (const m of code.matchAll(/\blabel: '([a-z0-9_]+)'/g)) used.add(m[1]);
}
// Keys built at runtime, taken from the data that builds them.
for (const r of RULES) used.add(`cat_${r.category}`);
for (const p of Object.values(PROVIDERS)) used.add(p.labelKey);
for (const m of MODELS) used.add(m.labelKey);
const manifest = readFileSync(`${root}manifest.json`, 'utf8');
for (const m of manifest.matchAll(/__MSG_([a-z0-9_]+)__/g)) used.add(m[1]);
eq('every key used in the code exists', [...used].filter((k) => !en[k]).sort(), []);

console.log(fail ? `\n${fail} tests failed` : '\nAll tests green');
process.exit(fail ? 1 : 0);

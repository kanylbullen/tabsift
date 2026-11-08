import { normalizeUrl, isNewTabPage } from '../src/lib/urlkey.js';
import { matchBest } from '../src/lib/fuzzy.js';
import { categorize } from '../src/lib/rules.js';
import { planDedupe, planStale, formatAge, colorFor } from '../src/lib/tabs.js';
import { escapeXml, describe as omniDescribe, buildSuggestions } from '../src/lib/omnibox.js';

let fail = 0;
const eq = (name, a, b) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { console.log(`FAIL ${name}\n  fick     ${JSON.stringify(a)}\n  förväntat ${JSON.stringify(b)}`); fail++; }
  else console.log(`ok   ${name}`);
};

const O = { ignoreHash: true, stripTracking: true, ignoreTrailingSlash: true };

// --- URL-normalisering
eq('www + http/https likställs',
  normalizeUrl('http://www.example.com/a/', O), normalizeUrl('https://example.com/a', O));
eq('utm strippas',
  normalizeUrl('https://x.se/p?utm_source=nl&id=7', O), 'https://x.se/p?id=7');
eq('query sorteras',
  normalizeUrl('https://x.se/p?b=2&a=1', O), normalizeUrl('https://x.se/p?a=1&b=2', O));
eq('fragment ignoreras',
  normalizeUrl('https://x.se/p#top', O), 'https://x.se/p');
eq('fragment behålls när det är avstängt',
  normalizeUrl('https://x.se/p#top', {...O, ignoreHash:false}), 'https://x.se/p#top');
eq('olika sidor blandas inte ihop',
  normalizeUrl('https://x.se/a', O) === normalizeUrl('https://x.se/b', O), false);
eq('port bevaras',
  normalizeUrl('http://localhost:3000/x', O), 'https://localhost:3000/x');
eq('nya fliken känns igen', isNewTabPage('edge://newtab/'), true);

// --- regler
eq('github -> Kod', categorize('https://github.com/foo/bar'), 'Kod');
eq('subdomän matchar', categorize('https://gist.github.com/x'), 'Kod');
eq('localhost -> Lokalt', categorize('http://localhost:5173/'), 'Lokalt');
eq('okänd domän -> null', categorize('https://nagot-slumpmassigt.example/'), null);
eq('github.com.evil.se matchar INTE', categorize('https://github.com.evil.se/x'), null);

// --- fuzzy
eq('fuzzy matchar delsekvens', !!matchBest('gh', [{text:'GitHub'}]), true);
eq('fuzzy nekar icke-träff', matchBest('zzz', [{text:'GitHub'}]), null);
const a = matchBest('git', [{text:'GitHub — pull request'}]).score;
const b = matchBest('git', [{text:'Nagot om digital signering'}]).score;
eq('prefixträff rankas högre än inbäddad', a > b, true);

// --- dedupe-plan
const t = (id, url, extra={}) => ({ id, url, windowId: 1, index: id, pinned:false, active:false, audible:false, groupId:-1, lastAccessed: id*1000, title:'t'+id, ...extra });
const plan = planDedupe([
  t(1, 'https://example.com/a'),
  t(2, 'https://www.example.com/a/?utm_source=x'),
  t(3, 'https://example.com/b'),
  t(4, 'edge://newtab/'),
  t(5, 'edge://newtab/'),
], { ...O, includeNewTabPages: false });
eq('en dubblettmängd hittad', plan.length, 1);
eq('senast använda behålls', plan[0].keep.id, 2);
eq('en flik markerad för stängning', plan[0].close.map(x=>x.id), [1]);

const pinnedPlan = planDedupe([
  t(1, 'https://example.com/a', { pinned:true }),
  t(2, 'https://example.com/a'),
], O);
eq('fäst flik behålls', pinnedPlan[0].keep.id, 1);
eq('fäst flik stängs aldrig', pinnedPlan[0].close.map(x=>x.id), [2]);

const bothPinned = planDedupe([
  t(1, 'https://example.com/a', { pinned:true }),
  t(2, 'https://example.com/a', { pinned:true }),
], O);
eq('två fästa dubbletter -> ingen åtgärd', bothPinned.length, 0);

const withNewTabs = planDedupe([t(4,'edge://newtab/'), t(5,'edge://newtab/')], { ...O, includeNewTabPages: true });
eq('nya flikar dedupas när inställningen är på', withNewTabs.length, 1);

// --- inaktiva flikar
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
eq('inaktiva äldst först, bara över gränsen',
  planStale(staleTabs, NOW, { days: 7 }).map(x=>x.id), [2, 1]);
eq('fäst, aktiv och ljud föreslås aldrig',
  planStale(staleTabs, NOW, { days: 7, includeGrouped: true }).map(x=>x.id), [7, 2, 1]);
eq('flik utan tidsstämpel föreslås aldrig',
  planStale(staleTabs, NOW, { days: 1 }).some(x => x.id === 8 || x.id === 9), false);
eq('exakt på gränsen räknas som inaktiv',
  planStale([t(1, 'https://a.se/', { lastAccessed: ago(7) })], NOW, { days: 7 }).length, 1);
eq('ogiltigt antal dagar föreslår inget',
  planStale(staleTabs, NOW, { days: 0 }).length, 0);
eq('ålder i timmar', formatAge(5 * 3_600_000), '5 tim');
eq('ålder en dag', formatAge(DAY), '1 dag');
eq('ålder i dagar', formatAge(10 * DAY), '10 dagar');
eq('ålder i veckor', formatAge(30 * DAY), '4 veckor');
eq('ålder i månader', formatAge(90 * DAY), '3 mån');

// --- färger
eq('färg är deterministisk', colorFor('Kod'), colorFor('Kod'));

// --- omnibox
eq('escapar alla fem XML-entiteter',
  escapeXml(`&<>"'`), '&amp;&lt;&gt;&quot;&apos;');
eq('flikrubrik kan inte injicera markup',
  omniDescribe('Ondska <match>fejk</match> & co', 'x.se').includes('&lt;match&gt;'), true);
eq('injicerad tagg blir text, inte markup',
  omniDescribe('<url>evil</url>', 'x.se').startsWith('&lt;url&gt;'), true);
eq('host escapas ocksa',
  omniDescribe('t', 'a&b.se').includes('<url>a&amp;b.se</url>'), true);
eq('trafftecken markeras',
  omniDescribe('GitHub', 'github.com', [0,1,2]).startsWith('<match>Git</match>'), true);

const otabs = [
  { id: 11, url: 'https://github.com/foo/bar', title: 'Pull request #412', lastAccessed: 300 },
  { id: 12, url: 'https://stackoverflow.com/q/1', title: 'OAuth redirect_uri mismatch', lastAccessed: 200 },
  { id: 13, url: 'edge://newtab/', title: 'Ny flik', lastAccessed: 400 },
];
const sugg = buildSuggestions(otabs, 'oauth');
eq('omnibox matchar pa rubrik', sugg.map(s=>s.tabId), [12]);
eq('omnibox hoppar over tomma nya flikar',
  buildSuggestions(otabs, '').map(s=>s.tabId), [11, 12]);
eq('omnibox matchar pa doman', buildSuggestions(otabs, 'github').map(s=>s.tabId), [11]);
eq('content ar flikens url', sugg[0].content, 'https://stackoverflow.com/q/1');
eq('inga traffar ger tom lista', buildSuggestions(otabs, 'zzzzz').length, 0);

console.log(fail ? `\n${fail} test misslyckades` : '\nAlla test gröna');
process.exit(fail ? 1 : 0);

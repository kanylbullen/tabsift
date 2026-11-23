// A stand-in `chrome` object so the real palette can run in a plain page for
// store screenshots. Loaded as a classic script before palette.js (a module,
// so it runs later). The tabs are made up; nothing here touches a real browser.

(() => {
  const demo = parent.DEMO;
  const now = Date.now();
  const H = 3_600_000;
  const D = 24 * H;

  // Small letter icons as data URIs, so the page needs no network.
  const icon = (letter, color) =>
    'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">` +
      `<rect width="32" height="32" rx="7" fill="${color}"/>` +
      `<text x="16" y="22" font-family="Segoe UI,Arial" font-size="17" font-weight="700" fill="#fff" text-anchor="middle">${letter}</text></svg>`,
    );

  const rows = [
    ['Fix flaky retry in upload queue · Pull Request #482', 'https://github.com/acme/uploader/pull/482', icon('G', '#24292f'), 0.1 * H],
    ['Array.prototype.findLast() - JavaScript | MDN', 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/findLast', icon('M', '#1b1b1b'), 2 * H],
    ['OAuth redirect_uri mismatch after deploy', 'https://stackoverflow.com/questions/7187031', icon('S', '#f48024'), 3 * H],
    ['Fix flaky retry in upload queue · Pull Request #482', 'https://github.com/acme/uploader/pull/482?utm_source=slack', icon('G', '#24292f'), 5 * H],
    ['Sprint board – Uploader', 'https://acme.atlassian.net/jira/software/projects/UP/boards/3', icon('J', '#0c66e4'), 6 * H],
    ['Design review notes', 'https://docs.google.com/document/d/1x0demo', icon('D', '#1a73e8'), 9 * H],
    ['Meeting notes – Q4 planning', 'https://www.notion.so/acme/Q4-planning', icon('N', '#000000'), 5 * H],
    ['Reading notes – Data-Intensive Apps', 'https://www.example-books.com/notes/ddia', icon('B', '#b45309'), 3 * D],
    ['Release notes 4.2 – draft', 'https://www.notion.so/acme/Release-notes-4-2', icon('N', '#000000'), 1.2 * D],
    ['Rust ownership explained in 10 minutes', 'https://www.youtube.com/watch?v=demo', icon('Y', '#ff0000'), 2 * D],
    ['Bloom filter - Wikipedia', 'https://en.wikipedia.org/wiki/Bloom_filter', icon('W', '#636466'), 9 * D],
    ['Array.prototype.findLast() - JavaScript | MDN', 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/findLast#examples', icon('M', '#1b1b1b'), 11 * D],
    ['Mechanical keyboards – Shop', 'https://www.example-shop.com/keyboards', icon('K', '#7c3aed'), 16 * D],
    ['Conference talk ideas', 'https://www.notion.so/acme/Talk-ideas', icon('N', '#000000'), 23 * D],
    ['Hacker News', 'https://news.ycombinator.com/', icon('Y', '#ff6600'), 34 * D],
    ['How to cook perfect rice', 'https://www.example-recipes.com/rice', icon('R', '#16a34a'), 47 * D],
  ];

  const tabs = rows.map(([title, url, favIconUrl, age], i) => ({
    id: i + 1, index: i, windowId: 1, title, url, favIconUrl,
    active: i === 0, pinned: false, audible: false, groupId: -1,
    lastAccessed: now - age,
  }));

  // Synchronous on purpose: chrome.i18n.getMessage is synchronous, so the
  // catalog must be in place before palette.js runs.
  const xhr = new XMLHttpRequest();
  xhr.open('GET', `/_locales/${demo.lang}/messages.json`, false);
  xhr.send();
  const catalog = JSON.parse(xhr.responseText);

  const store = {};
  const pick = (keys) =>
    Object.fromEntries([].concat(keys).filter((k) => k in store).map((k) => [k, store[k]]));

  window.chrome = {
    i18n: {
      getUILanguage: () => demo.lang,
      getMessage(key, subs = []) {
        const m = catalog[key];
        if (!m) return '';
        return m.message.replace(/\$([A-Za-z0-9_]+)\$/g, (_, name) => {
          const ph = m.placeholders?.[name.toLowerCase()];
          return ph ? ph.content.replace(/\$(\d)/g, (_, n) => subs[n - 1] ?? '') : '';
        });
      },
    },
    tabs: {
      query: async () => tabs,
      remove: async () => {},
      update: async () => {},
      group: async () => 1,
    },
    tabGroups: { query: async () => [], update: async () => {} },
    windows: { WINDOW_ID_CURRENT: -2, getAll: async () => [{ id: 1 }], update: async () => {} },
    storage: {
      local: {
        get: async (keys) => pick(keys),
        set: async (obj) => void Object.assign(store, obj),
        remove: async (keys) => void [].concat(keys).forEach((k) => delete store[k]),
      },
    },
    runtime: { id: 'demo', openOptionsPage: () => {} },
  };
})();

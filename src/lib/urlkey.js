// URL normalization for duplicate detection.
//
// The rule: two tabs are duplicates if their normalized keys are identical.
// Normalization is deliberately conservative — better to miss a duplicate than
// close two tabs that show different things.

const TRACKING_PARAM_PATTERNS = [
  /^utm_/i,
  /^_ga$/i,
  /^_gl$/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^dclid$/i,
  /^msclkid$/i,
  /^yclid$/i,
  /^twclid$/i,
  /^igshid$/i,
  /^mc_(cid|eid)$/i,
  /^ref_src$/i,
  /^ref_url$/i,
  /^s_kwcid$/i,
  /^vero_(id|conv)$/i,
  /^wickedid$/i,
];

const NEW_TAB_PAGES = new Set([
  'edge://newtab/',
  'chrome://newtab/',
  'about:newtab',
  'about:blank',
  'edge://new-tab-page/',
]);

export function isNewTabPage(rawUrl) {
  if (!rawUrl) return true;
  const u = rawUrl.toLowerCase();
  if (NEW_TAB_PAGES.has(u)) return true;
  // Edge's new tab page sometimes has a query tail.
  return u.startsWith('edge://newtab') || u.startsWith('chrome://newtab');
}

function isTracking(name) {
  return TRACKING_PARAM_PATTERNS.some((re) => re.test(name));
}

/**
 * @param {string} rawUrl
 * @param {{ignoreHash?: boolean, stripTracking?: boolean, ignoreTrailingSlash?: boolean}} opts
 * @returns {string} key for duplicate comparison, or '' if the URL can't be parsed
 */
export function normalizeUrl(rawUrl, opts = {}) {
  if (!rawUrl) return '';

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    // edge://…, about:… and the like often parse with URL(), but not everything.
    return rawUrl.trim().toLowerCase();
  }

  // Internal pages (edge://, chrome://, about:, file:) are otherwise left alone —
  // their query parameters are rarely tracking and the path carries meaning.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return `${url.protocol}${url.pathname}${url.search}`.toLowerCase();
  }

  const protocol = 'https:'; // http and https to the same host count as the same page
  let host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (url.port && url.port !== '80' && url.port !== '443') host += `:${url.port}`;

  let path = url.pathname;
  if (opts.ignoreTrailingSlash !== false && path.length > 1) {
    path = path.replace(/\/+$/, '');
  }

  const params = new URLSearchParams(url.search);
  if (opts.stripTracking !== false) {
    for (const name of [...params.keys()]) {
      if (isTracking(name)) params.delete(name);
    }
  }
  // Sort so that ?a=1&b=2 and ?b=2&a=1 become the same key.
  params.sort();
  const search = params.toString();

  const hash = opts.ignoreHash === false ? url.hash : '';

  return `${protocol}//${host}${path}${search ? '?' + search : ''}${hash}`;
}

/** Short, readable description of a tab URL — used in the UI. */
export function displayHost(rawUrl) {
  if (!rawUrl) return '';
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.hostname.replace(/^www\./, '');
    }
    return url.protocol.replace(':', '');
  } catch {
    return rawUrl.slice(0, 40);
  }
}

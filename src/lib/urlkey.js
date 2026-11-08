// URL-normalisering för dubblettdetektering.
//
// Regeln: två flikar är dubbletter om deras normaliserade nyckel är identisk.
// Normaliseringen är avsiktligt konservativ — hellre missa en dubblett än
// stänga två flikar som visar olika saker.

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
  // Edges nya flik har ibland en query-svans.
  return u.startsWith('edge://newtab') || u.startsWith('chrome://newtab');
}

function isTracking(name) {
  return TRACKING_PARAM_PATTERNS.some((re) => re.test(name));
}

/**
 * @param {string} rawUrl
 * @param {{ignoreHash?: boolean, stripTracking?: boolean, ignoreTrailingSlash?: boolean}} opts
 * @returns {string} nyckel för dubblettjämförelse, eller '' om URL:en inte går att tolka
 */
export function normalizeUrl(rawUrl, opts = {}) {
  if (!rawUrl) return '';

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    // edge://…, about:… och liknande går ofta igenom URL(), men inte allt.
    return rawUrl.trim().toLowerCase();
  }

  // Interna sidor (edge://, chrome://, about:, file:) rör vi inte i övrigt —
  // deras query-parametrar är sällan spårning och sökvägen är betydelsebärande.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return `${url.protocol}${url.pathname}${url.search}`.toLowerCase();
  }

  const protocol = 'https:'; // http och https mot samma värd räknas som samma sida
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
  // Sortera så att ?a=1&b=2 och ?b=2&a=1 blir samma nyckel.
  params.sort();
  const search = params.toString();

  const hash = opts.ignoreHash === false ? url.hash : '';

  return `${protocol}//${host}${path}${search ? '?' + search : ''}${hash}`;
}

/** Kort, läsbar beskrivning av en flik-URL — används i UI:t. */
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

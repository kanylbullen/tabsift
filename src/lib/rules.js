// Regelbaserad gruppering. Kör före AI:n och täcker det mesta i praktiken —
// AI:n får bara de flikar som ingen regel känner igen.
//
// Matchning sker på hostname (suffix) eller på hela URL:en (regex).
// Första träffen vinner, så ordningen spelar roll: specifikt före generellt.

/** @type {{category: string, hosts?: string[], urlPattern?: RegExp}[]} */
export const RULES = [
  {
    category: 'Kod',
    hosts: [
      'github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org',
      'stackoverflow.com', 'stackexchange.com', 'serverfault.com',
      'npmjs.com', 'pypi.org', 'crates.io', 'pkg.go.dev', 'nuget.org',
      'developer.mozilla.org', 'caniuse.com', 'regex101.com',
      'codepen.io', 'jsfiddle.net', 'replit.com', 'codesandbox.io',
      'readthedocs.io', 'devdocs.io',
    ],
  },
  {
    category: 'AI',
    hosts: [
      'claude.ai', 'anthropic.com', 'chatgpt.com', 'openai.com',
      'gemini.google.com', 'huggingface.co', 'perplexity.ai',
      'ollama.com', 'replicate.com', 'together.ai', 'mistral.ai',
    ],
  },
  {
    category: 'Molndrift',
    hosts: [
      'portal.azure.com', 'console.aws.amazon.com', 'console.cloud.google.com',
      'vercel.com', 'netlify.com', 'cloudflare.com', 'hetzner.com',
      'digitalocean.com', 'supabase.com', 'render.com', 'fly.io',
      'railway.app', 'coolify.io', 'grafana.com', 'sentry.io', 'datadoghq.com',
    ],
  },
  {
    category: 'Microsoft 365',
    hosts: [
      'office.com', 'office365.com', 'sharepoint.com', 'outlook.com',
      'outlook.office.com', 'teams.microsoft.com', 'onedrive.live.com',
      'admin.microsoft.com', 'entra.microsoft.com', 'security.microsoft.com',
      'learn.microsoft.com', 'microsoft.com',
    ],
  },
  {
    category: 'Google',
    hosts: [
      'mail.google.com', 'calendar.google.com', 'drive.google.com',
      'docs.google.com', 'sheets.google.com', 'meet.google.com',
      'admin.google.com', 'analytics.google.com',
    ],
  },
  {
    category: 'Projekt',
    hosts: [
      'linear.app', 'notion.so', 'clickup.com', 'atlassian.net', 'jira.com',
      'trello.com', 'asana.com', 'monday.com', 'height.app', 'basecamp.com',
    ],
  },
  {
    category: 'Kommunikation',
    hosts: [
      'slack.com', 'discord.com', 'web.whatsapp.com', 'web.telegram.org',
      'zoom.us', 'meet.jit.si', 'signal.org', 'messenger.com',
    ],
  },
  {
    category: 'Video',
    hosts: [
      'youtube.com', 'youtu.be', 'vimeo.com', 'twitch.tv', 'netflix.com',
      'svtplay.se', 'tv4play.se', 'viaplay.se', 'hbomax.com', 'max.com',
      'disneyplus.com', 'primevideo.com',
    ],
  },
  {
    category: 'Socialt',
    hosts: [
      'x.com', 'twitter.com', 'reddit.com', 'linkedin.com', 'facebook.com',
      'instagram.com', 'bsky.app', 'mastodon.social', 'farcaster.xyz',
      'threads.net', 'news.ycombinator.com', 'lobste.rs', 'flashback.org',
    ],
  },
  {
    category: 'Handel',
    hosts: [
      'amazon.com', 'amazon.se', 'tradera.com', 'blocket.se', 'ebay.com',
      'aliexpress.com', 'temu.com', 'komplett.se', 'inet.se', 'netonnet.se',
      'elgiganten.se', 'prisjakt.nu', 'clasohlson.com', 'ikea.com',
    ],
  },
  {
    category: 'Ekonomi',
    hosts: [
      'avanza.se', 'nordnet.se', 'swedbank.se', 'seb.se', 'handelsbanken.se',
      'nordea.se', 'skatteverket.se', 'fortnox.se', 'stripe.com',
      'interactivebrokers.com', 'tradingview.com', 'coingecko.com',
      'coinmarketcap.com', 'hyperliquid.xyz', 'binance.com',
    ],
  },
  {
    category: 'Nyheter',
    hosts: [
      'svt.se', 'dn.se', 'svd.se', 'aftonbladet.se', 'expressen.se',
      'sverigesradio.se', 'di.se', 'nyteknik.se', 'bbc.com', 'reuters.com',
      'theverge.com', 'arstechnica.com', 'techcrunch.com',
    ],
  },
  {
    category: 'Referens',
    hosts: [
      'wikipedia.org', 'wiktionary.org', 'archive.org', 'scholar.google.com',
      'arxiv.org', 'doi.org', 'lagen.nu', 'riksdagen.se', 'domstol.se',
    ],
  },
  {
    // Lokal utveckling — matchar på URL, inte host.
    category: 'Lokalt',
    urlPattern: /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|.*\.local|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?\//i,
  },
];

function hostMatches(hostname, suffix) {
  return hostname === suffix || hostname.endsWith('.' + suffix);
}

/**
 * @param {string} rawUrl
 * @returns {string | null} kategorinamn, eller null om ingen regel matchar
 */
export function categorize(rawUrl) {
  if (!rawUrl) return null;

  let hostname;
  try {
    hostname = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }

  for (const rule of RULES) {
    if (rule.urlPattern && rule.urlPattern.test(rawUrl)) return rule.category;
    if (rule.hosts && hostname && rule.hosts.some((h) => hostMatches(hostname, h))) {
      return rule.category;
    }
  }
  return null;
}

/** Alla kategorinamn reglerna kan producera — ges till AI:n som vokabulär. */
export function ruleCategories() {
  return [...new Set(RULES.map((r) => r.category))];
}

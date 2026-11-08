// Rule-based grouping. Runs before the AI and covers most tabs in practice —
// the AI only gets the tabs no rule recognizes.
//
// Matching is on hostname (suffix) or on the whole URL (regex). First match
// wins, so order matters: specific before general.
//
// `category` is a key; the group name shown to the user is the translated
// message `cat_<category>` from _locales.

import { t } from './i18n.js';

/** @type {{category: string, hosts?: string[], urlPattern?: RegExp}[]} */
export const RULES = [
  {
    category: 'code',
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
    category: 'ai',
    hosts: [
      'claude.ai', 'anthropic.com', 'chatgpt.com', 'openai.com',
      'gemini.google.com', 'huggingface.co', 'perplexity.ai',
      'ollama.com', 'replicate.com', 'together.ai', 'mistral.ai',
    ],
  },
  {
    category: 'cloud',
    hosts: [
      'portal.azure.com', 'console.aws.amazon.com', 'console.cloud.google.com',
      'vercel.com', 'netlify.com', 'cloudflare.com', 'hetzner.com',
      'digitalocean.com', 'supabase.com', 'render.com', 'fly.io',
      'railway.app', 'coolify.io', 'grafana.com', 'sentry.io', 'datadoghq.com',
    ],
  },
  {
    category: 'm365',
    hosts: [
      'office.com', 'office365.com', 'sharepoint.com', 'outlook.com',
      'outlook.office.com', 'teams.microsoft.com', 'onedrive.live.com',
      'admin.microsoft.com', 'entra.microsoft.com', 'security.microsoft.com',
      'learn.microsoft.com', 'microsoft.com',
    ],
  },
  {
    category: 'google',
    hosts: [
      'mail.google.com', 'calendar.google.com', 'drive.google.com',
      'docs.google.com', 'sheets.google.com', 'meet.google.com',
      'admin.google.com', 'analytics.google.com',
    ],
  },
  {
    category: 'projects',
    hosts: [
      'linear.app', 'notion.so', 'clickup.com', 'atlassian.net', 'jira.com',
      'trello.com', 'asana.com', 'monday.com', 'height.app', 'basecamp.com',
    ],
  },
  {
    category: 'chat',
    hosts: [
      'slack.com', 'discord.com', 'web.whatsapp.com', 'web.telegram.org',
      'zoom.us', 'meet.jit.si', 'signal.org', 'messenger.com',
    ],
  },
  {
    category: 'video',
    hosts: [
      'youtube.com', 'youtu.be', 'vimeo.com', 'twitch.tv', 'netflix.com',
      'svtplay.se', 'tv4play.se', 'viaplay.se', 'hbomax.com', 'max.com',
      'disneyplus.com', 'primevideo.com',
    ],
  },
  {
    category: 'social',
    hosts: [
      'x.com', 'twitter.com', 'reddit.com', 'linkedin.com', 'facebook.com',
      'instagram.com', 'bsky.app', 'mastodon.social', 'farcaster.xyz',
      'threads.net', 'news.ycombinator.com', 'lobste.rs', 'flashback.org',
    ],
  },
  {
    category: 'shopping',
    hosts: [
      'amazon.com', 'amazon.se', 'tradera.com', 'blocket.se', 'ebay.com',
      'aliexpress.com', 'temu.com', 'komplett.se', 'inet.se', 'netonnet.se',
      'elgiganten.se', 'prisjakt.nu', 'clasohlson.com', 'ikea.com',
    ],
  },
  {
    category: 'finance',
    hosts: [
      'avanza.se', 'nordnet.se', 'swedbank.se', 'seb.se', 'handelsbanken.se',
      'nordea.se', 'skatteverket.se', 'fortnox.se', 'stripe.com',
      'interactivebrokers.com', 'tradingview.com', 'coingecko.com',
      'coinmarketcap.com', 'hyperliquid.xyz', 'binance.com',
    ],
  },
  {
    category: 'news',
    hosts: [
      'svt.se', 'dn.se', 'svd.se', 'aftonbladet.se', 'expressen.se',
      'sverigesradio.se', 'di.se', 'nyteknik.se', 'bbc.com', 'reuters.com',
      'theverge.com', 'arstechnica.com', 'techcrunch.com',
    ],
  },
  {
    category: 'reference',
    hosts: [
      'wikipedia.org', 'wiktionary.org', 'archive.org', 'scholar.google.com',
      'arxiv.org', 'doi.org', 'lagen.nu', 'riksdagen.se', 'domstol.se',
    ],
  },
  {
    // Local development — matches on the URL, not the host.
    category: 'local',
    urlPattern: /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|.*\.local|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?\//i,
  },
];

function hostMatches(hostname, suffix) {
  return hostname === suffix || hostname.endsWith('.' + suffix);
}

/**
 * @param {string} rawUrl
 * @returns {string | null} category key, or null if no rule matches
 */
export function categoryKey(rawUrl) {
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

/** Translated group name for a URL, or null if no rule matches. */
export function categorize(rawUrl) {
  const key = categoryKey(rawUrl);
  return key ? t(`cat_${key}`) : null;
}

/** Every group name the rules can produce — given to the AI as vocabulary. */
export function ruleCategories() {
  return [...new Set(RULES.map((r) => t(`cat_${r.category}`)))];
}

// The AI layer. Every backend implements the same small interface:
//
//   id, labelKey                             labelKey is a _locales message
//   hostPermissions(settings) -> string[]   patterns that must be granted
//   isConfigured(settings)    -> boolean
//   complete({system, user, schema, settings}) -> Promise<object>
//
// Nothing outside this folder knows which provider is in use.

import * as ollama from './ollama.js';
import * as openai from './openai.js';
import * as anthropic from './anthropic.js';
import * as edge from './edge.js';
import { t } from '../i18n.js';

export const PROVIDERS = { ollama, openai, anthropic, edge };

export function getProvider(id) {
  return PROVIDERS[id] ?? null;
}

// The response format. The model gets it as a JSON schema where the provider
// supports it, so we don't have to parse free text.
export const ASSIGNMENT_SCHEMA = {
  type: 'object',
  properties: {
    assignments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          i: { type: 'integer', description: 'The tab\'s number from the list.' },
          group: { type: 'string', description: 'The name of the group the tab belongs in.' },
        },
        required: ['i', 'group'],
        additionalProperties: false,
      },
    },
  },
  required: ['assignments'],
  additionalProperties: false,
};

function systemPrompt(language) {
  return [
    'You sort browser tabs into groups by what the user is working on.',
    'Give every tab exactly one group. Use an existing group name when it fits,',
    'otherwise make up a new one: one or two words, nouns, written in the',
    `language with code "${language}". Aim for 3–8 groups in total — a few`,
    'meaningful groups rather than one group per tab. Group by task and topic,',
    'not by domain: a GitHub tab and a Stack Overflow tab about the same bug',
    'belong together. Reply only with JSON matching the schema.',
  ].join(' ');
}

/**
 * @param {{title: string, host: string}[]} tabs
 * @param {string[]} existingGroups
 * @param {string[]} knownCategories
 * @param {string} language UI language code for new group names
 */
export function buildPrompt(tabs, existingGroups, knownCategories, language = 'en') {
  const lines = tabs.map((tab, i) => `${i}. ${tab.title || '(untitled)'} — ${tab.host}`);

  const parts = [];
  if (existingGroups.length) {
    parts.push(`Existing groups in the window: ${existingGroups.join(', ')}`);
  }
  if (knownCategories.length) {
    parts.push(`Category names the extension already uses: ${knownCategories.join(', ')}`);
  }
  parts.push('Tabs:', lines.join('\n'));

  return { system: systemPrompt(language), user: parts.join('\n\n') };
}

/**
 * Runs a classification with the selected provider.
 * @returns {Promise<Map<number, string>>} tab index -> group name
 */
export async function classify(settings, tabs, existingGroups, knownCategories, language) {
  const provider = getProvider(settings.provider);
  if (!provider) throw new Error(t('ai_none'));
  if (!provider.isConfigured(settings)) {
    throw new Error(t('ai_not_configured', t(provider.labelKey)));
  }

  const { system, user } = buildPrompt(tabs, existingGroups, knownCategories, language);
  const result = await provider.complete({
    system,
    user,
    schema: ASSIGNMENT_SCHEMA,
    settings,
  });

  const out = new Map();
  for (const a of result?.assignments ?? []) {
    const i = Number(a.i);
    const group = String(a.group ?? '').trim();
    if (!Number.isInteger(i) || i < 0 || i >= tabs.length) continue;
    if (!group) continue;
    // Keep group names short — tab groups only show a few characters anyway.
    out.set(i, group.slice(0, 28));
  }
  return out;
}

/** Requests the host permissions the provider needs. Requires a user gesture. */
export async function ensurePermissions(settings) {
  const provider = getProvider(settings.provider);
  if (!provider) return true;
  const origins = provider.hostPermissions(settings);
  if (!origins.length) return true;
  if (await chrome.permissions.contains({ origins })) return true;
  return chrome.permissions.request({ origins });
}

/** Helper: makes an origin pattern from an arbitrary base URL. */
export function originPattern(baseUrl) {
  try {
    const u = new URL(baseUrl);
    return `${u.protocol}//${u.host}/*`;
  } catch {
    return null;
  }
}

/** Helper: pulls a JSON object out of a reply that may be wrapped in text. */
export function parseJsonLoose(text) {
  if (typeof text !== 'string') return text;
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end <= start) {
      throw new Error(t('ai_not_json'));
    }
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

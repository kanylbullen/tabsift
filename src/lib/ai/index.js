// AI-lagret. Varje backend implementerar samma lilla gränssnitt:
//
//   id, label
//   hostPermissions(settings) -> string[]   patterns som måste beviljas
//   isConfigured(settings)    -> boolean
//   complete({system, user, schema, settings}) -> Promise<object>
//
// Ingenting utanför den här mappen vet vilken leverantör som används.

import * as ollama from './ollama.js';
import * as openai from './openai.js';
import * as anthropic from './anthropic.js';
import * as edge from './edge.js';

export const PROVIDERS = { ollama, openai, anthropic, edge };

export function getProvider(id) {
  return PROVIDERS[id] ?? null;
}

// Svarsformatet. Modellen får det som JSON-schema där leverantören stödjer
// det, så vi slipper parsa fritext.
export const ASSIGNMENT_SCHEMA = {
  type: 'object',
  properties: {
    assignments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          i: { type: 'integer', description: 'Flikens nummer från listan.' },
          group: { type: 'string', description: 'Gruppnamnet fliken hör hemma i.' },
        },
        required: ['i', 'group'],
        additionalProperties: false,
      },
    },
  },
  required: ['assignments'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = [
  'Du sorterar webbläsarflikar i grupper efter vad användaren håller på med.',
  'Ge varje flik exakt en grupp. Använd ett befintligt gruppnamn när det passar,',
  'annars hitta på ett nytt: ett eller två ord, substantiv, på samma språk som',
  'flikarnas titlar. Sikte på 3–8 grupper totalt — hellre några få meningsfulla',
  'grupper än en grupp per flik. Gruppera efter uppgift och ämne, inte efter domän:',
  'en GitHub-flik och en Stack Overflow-flik om samma bugg hör ihop.',
  'Svara bara med JSON enligt schemat.',
].join(' ');

/**
 * @param {{title: string, host: string}[]} tabs
 * @param {string[]} existingGroups
 * @param {string[]} knownCategories
 */
export function buildPrompt(tabs, existingGroups, knownCategories) {
  const lines = tabs.map((t, i) => `${i}. ${t.title || '(utan titel)'} — ${t.host}`);

  const parts = [];
  if (existingGroups.length) {
    parts.push(`Befintliga grupper i fönstret: ${existingGroups.join(', ')}`);
  }
  if (knownCategories.length) {
    parts.push(`Kategorinamn som redan används i tillägget: ${knownCategories.join(', ')}`);
  }
  parts.push('Flikar:', lines.join('\n'));

  return { system: SYSTEM_PROMPT, user: parts.join('\n\n') };
}

/**
 * Kör en klassificering med vald leverantör.
 * @returns {Promise<Map<number, string>>} flikindex -> gruppnamn
 */
export async function classify(settings, tabs, existingGroups, knownCategories) {
  const provider = getProvider(settings.provider);
  if (!provider) throw new Error('Ingen AI-backend vald.');
  if (!provider.isConfigured(settings)) {
    throw new Error(`${provider.label} är inte färdigkonfigurerad — se inställningarna.`);
  }

  const { system, user } = buildPrompt(tabs, existingGroups, knownCategories);
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
    // Håll gruppnamn korta — flikgrupper visar bara några tecken ändå.
    out.set(i, group.slice(0, 28));
  }
  return out;
}

/** Ber om de host-behörigheter leverantören behöver. Kräver användargest. */
export async function ensurePermissions(settings) {
  const provider = getProvider(settings.provider);
  if (!provider) return true;
  const origins = provider.hostPermissions(settings);
  if (!origins.length) return true;
  if (await chrome.permissions.contains({ origins })) return true;
  return chrome.permissions.request({ origins });
}

/** Hjälpare: gör en origin-pattern av en godtycklig bas-URL. */
export function originPattern(baseUrl) {
  try {
    const u = new URL(baseUrl);
    return `${u.protocol}//${u.host}/*`;
  } catch {
    return null;
  }
}

/** Hjälpare: plockar ut ett JSON-objekt ur ett svar som kan vara omgärdat av text. */
export function parseJsonLoose(text) {
  if (typeof text !== 'string') return text;
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end <= start) {
      throw new Error('Modellen svarade inte med JSON.');
    }
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

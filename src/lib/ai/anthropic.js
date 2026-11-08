// Anthropic Messages API, anropad direkt från tillägget.
//
// Två saker som skiljer det här från ett vanligt serveranrop:
//   1. Webbläsaranrop kräver headern anthropic-dangerous-direct-browser-access,
//      annars blockerar CORS förfrågan.
//   2. Nyckeln ligger i klienten. Det är rimligt för ett personligt tillägg,
//      men använd en nyckel du kan återkalla separat — inte din huvudnyckel.
//
// Vi använder structured outputs (output_config.format) i stället för att be om
// JSON i prompten, så svaret alltid matchar schemat.

import { parseJsonLoose } from './index.js';

export const id = 'anthropic';
export const label = 'Anthropic (egen nyckel)';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

export const MODELS = [
  { id: 'claude-opus-5', label: 'Claude Opus 5 — bäst kvalitet' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — billigast' },
];

// effort stöds inte på Haiku 4.5 (returnerar fel om det skickas).
const SUPPORTS_EFFORT = new Set(['claude-opus-5', 'claude-sonnet-5']);

export function hostPermissions() {
  return ['https://api.anthropic.com/*'];
}

export function isConfigured(settings) {
  return !!(settings.anthropic.apiKey && settings.anthropic.model);
}

export async function complete({ system, user, schema, settings }) {
  const model = settings.anthropic.model;

  const outputConfig = { format: { type: 'json_schema', schema } };
  // Flikklassificering är en enkel uppgift — låg ansträngning räcker och
  // håller nere både latens och kostnad.
  if (SUPPORTS_EFFORT.has(model)) outputConfig.effort = 'low';

  const body = {
    model,
    max_tokens: 16000,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: outputConfig,
  };

  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': settings.anthropic.apiKey,
        'anthropic-version': API_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`Nådde inte Anthropic API: ${err.message}`);
  }

  if (!res.ok) {
    const detail = await res.text();
    if (res.status === 401) throw new Error('Anthropic avvisade nyckeln (401).');
    if (res.status === 429) throw new Error('Anthropic: rate limit (429). Försök igen om en stund.');
    throw new Error(`Anthropic svarade ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = await res.json();

  // Ett avslag kommer som HTTP 200 med tomt/partiellt innehåll — kolla
  // stop_reason innan content läses.
  if (data.stop_reason === 'refusal') {
    throw new Error('Anthropic avböjde förfrågan (stop_reason: refusal).');
  }

  const textBlock = (data.content ?? []).find((b) => b.type === 'text');
  if (!textBlock) throw new Error('Anthropic returnerade inget textsvar.');

  return parseJsonLoose(textBlock.text);
}

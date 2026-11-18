// Anthropic Messages API, called directly from the extension.
//
// Two things that differ from a normal server-side call:
//   1. Browser requests need the anthropic-dangerous-direct-browser-access
//      header, otherwise CORS blocks the request.
//   2. The key lives in the client. That's reasonable for a personal extension,
//      but use a key you can revoke separately — not your main key.
//
// We use structured outputs (output_config.format) rather than asking for JSON
// in the prompt, so the reply always matches the schema.

import { parseJsonLoose } from './index.js';
import { t } from '../i18n.js';

export const id = 'anthropic';
export const labelKey = 'provider_anthropic';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

export const MODELS = [
  { id: 'claude-opus-5-5', labelKey: 'model_opus' },
  { id: 'claude-sonnet-5-5', labelKey: 'model_sonnet' },
  { id: 'claude-haiku-5-5', labelKey: 'model_haiku' },
];

/** Ids saved by earlier versions, mapped to the model that replaced them. */
export const LEGACY_MODELS = {
  'claude-opus-5': 'claude-opus-5-5',
  'claude-sonnet-5': 'claude-sonnet-5-5',
  'claude-haiku-4-5': 'claude-haiku-5-5',
};

// On a safety-classifier refusal the API can re-run the request on a fallback
// model in the same call. Haiku has no server-side fallback.
const SUPPORTS_FALLBACK = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

export function hostPermissions() {
  return ['https://api.anthropic.com/*'];
}

export function isConfigured(settings) {
  return !!(settings.anthropic.apiKey && settings.anthropic.model);
}

export async function complete({ system, user, schema, settings }) {
  const model = settings.anthropic.model;

  // Tab classification is a simple task — low effort is enough and keeps both
  // latency and cost down. All three current models take effort.
  const body = {
    model,
    max_tokens: 16000,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { format: { type: 'json_schema', schema }, effort: 'low' },
  };

  const headers = {
    'content-type': 'application/json',
    'x-api-key': settings.anthropic.apiKey,
    'anthropic-version': API_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  if (SUPPORTS_FALLBACK.has(model)) {
    body.fallbacks = 'default';
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
  }

  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(t('err_unreachable', 'Anthropic API', err.message));
  }

  if (!res.ok) {
    const detail = await res.text();
    if (res.status === 401) throw new Error(t('err_anthropic_401'));
    if (res.status === 429) throw new Error(t('err_anthropic_429'));
    throw new Error(t('err_status', 'Anthropic', res.status, detail.slice(0, 300)));
  }

  const data = await res.json();

  // A refusal arrives as HTTP 200 with empty/partial content — check
  // stop_reason before reading content.
  if (data.stop_reason === 'refusal') {
    throw new Error(t('err_anthropic_refusal'));
  }

  const textBlock = (data.content ?? []).find((b) => b.type === 'text');
  if (!textBlock) throw new Error(t('err_anthropic_no_text'));

  return parseJsonLoose(textBlock.text);
}

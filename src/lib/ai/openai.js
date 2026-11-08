// Alla OpenAI-kompatibla endpoints: OpenAI, LM Studio, llama.cpp --server,
// OpenRouter, vLLM. Nyckeln ligger i chrome.storage.local och skickas bara
// till den bas-URL du själv angett.

import { originPattern, parseJsonLoose } from './index.js';

export const id = 'openai';
export const label = 'OpenAI-kompatibel endpoint';

export function hostPermissions(settings) {
  const pattern = originPattern(settings.openai.baseUrl);
  return pattern ? [pattern] : [];
}

export function isConfigured(settings) {
  const { baseUrl, model, apiKey } = settings.openai;
  if (!baseUrl || !model) return false;
  // Lokala servrar (LM Studio m.fl.) kräver ingen nyckel.
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(baseUrl);
  return isLocal || !!apiKey;
}

function requestBody(settings, system, user, schema, useSchema) {
  const body = {
    model: settings.openai.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };
  body.response_format = useSchema
    ? {
        type: 'json_schema',
        json_schema: { name: 'tab_assignments', strict: true, schema },
      }
    : { type: 'json_object' };
  return body;
}

async function post(settings, body) {
  const base = settings.openai.baseUrl.replace(/\/+$/, '');
  const headers = { 'content-type': 'application/json' };
  if (settings.openai.apiKey) {
    headers.authorization = `Bearer ${settings.openai.apiKey}`;
  }
  return fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

export async function complete({ system, user, schema, settings }) {
  let res;
  try {
    res = await post(settings, requestBody(settings, system, user, schema, true));
  } catch (err) {
    throw new Error(`Nådde inte ${settings.openai.baseUrl}: ${err.message}`);
  }

  // Servrar som inte kan json_schema svarar 400. Försök igen med json_object,
  // som i praktiken alla kompatibla implementationer stödjer.
  if (res.status === 400) {
    const detail = await res.text();
    if (/response_format|json_schema/i.test(detail)) {
      res = await post(settings, requestBody(settings, system, user, schema, false));
    } else {
      throw new Error(`Endpointen svarade 400: ${detail.slice(0, 200)}`);
    }
  }

  if (!res.ok) {
    throw new Error(`Endpointen svarade ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const data = await res.json();
  return parseJsonLoose(data?.choices?.[0]?.message?.content ?? '');
}

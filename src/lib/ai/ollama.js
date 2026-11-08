// Ollama — lokal modell, ingen data lämnar maskinen.
//
// CORS-fälla: Ollama tillåter som standard inte anrop från chrome-extension://.
// Sätt OLLAMA_ORIGINS innan du startar servern, t.ex.
//   OLLAMA_ORIGINS='chrome-extension://*' ollama serve
// eller lägg till just det här tilläggets ID i stället för jokertecknet.

import { originPattern, parseJsonLoose } from './index.js';

export const id = 'ollama';
export const label = 'Ollama (lokal)';

export function hostPermissions(settings) {
  const pattern = originPattern(settings.ollama.baseUrl);
  return pattern ? [pattern] : [];
}

export function isConfigured(settings) {
  return !!(settings.ollama.baseUrl && settings.ollama.model);
}

export async function complete({ system, user, schema, settings }) {
  const base = settings.ollama.baseUrl.replace(/\/+$/, '');

  let res;
  try {
    res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: settings.ollama.model,
        stream: false,
        format: schema,
        options: { temperature: 0 },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
  } catch (err) {
    throw new Error(
      `Nådde inte Ollama på ${base}. Kör servern och tillåt tilläggets origin ` +
        `via OLLAMA_ORIGINS. (${err.message})`,
    );
  }

  if (!res.ok) {
    throw new Error(`Ollama svarade ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const data = await res.json();
  return parseJsonLoose(data?.message?.content ?? '');
}

/** Listar nedladdade modeller — används av inställningssidan. */
export async function listModels(settings) {
  const base = settings.ollama.baseUrl.replace(/\/+$/, '');
  const res = await fetch(`${base}/api/tags`);
  if (!res.ok) throw new Error(`Ollama svarade ${res.status}`);
  const data = await res.json();
  return (data?.models ?? []).map((m) => m.name).sort();
}

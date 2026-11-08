// Ollama — local model, no data leaves the machine.
//
// CORS trap: by default Ollama doesn't allow requests from chrome-extension://.
// Set OLLAMA_ORIGINS to this extension's ID (shown on the settings page) before
// starting the server:
//   OLLAMA_ORIGINS='chrome-extension://<id>' ollama serve
// Not 'chrome-extension://*' — that lets any installed extension talk to your
// local model.

import { originPattern, parseJsonLoose } from './index.js';
import { t } from '../i18n.js';

export const id = 'ollama';
export const labelKey = 'provider_ollama';

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
    throw new Error(t('err_ollama_unreachable', base, err.message));
  }

  if (!res.ok) {
    throw new Error(t('err_status', 'Ollama', res.status, (await res.text()).slice(0, 200)));
  }

  const data = await res.json();
  return parseJsonLoose(data?.message?.content ?? '');
}

/** Lists downloaded models — used by the settings page. */
export async function listModels(settings) {
  const base = settings.ollama.baseUrl.replace(/\/+$/, '');
  const res = await fetch(`${base}/api/tags`);
  if (!res.ok) throw new Error(t('err_status_short', 'Ollama', res.status));
  const data = await res.json();
  return (data?.models ?? []).map((m) => m.name).sort();
}

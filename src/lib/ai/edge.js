// Edge's built-in on-device model via the Prompt API (LanguageModel).
//
// Status in August 2026: developer preview. Requires Edge Canary or Dev, the
// "Prompt API for on-device language model" flag in edge://flags, and enough
// hardware (Phi-4-mini: ~5.5 GB VRAM + 20 GB disk; the smaller
// Aion-1.0-Instruct runs on CPU behind its own flag).
//
// No host permission needed — the model runs in the browser.

import { t } from '../i18n.js';

export const id = 'edge';
export const labelKey = 'provider_edge';

export function hostPermissions() {
  return [];
}

export function isConfigured() {
  return typeof LanguageModel !== 'undefined';
}

/** @returns {Promise<'unavailable'|'downloadable'|'downloading'|'available'|'missing'>} */
export async function availability() {
  if (typeof LanguageModel === 'undefined') return 'missing';
  try {
    return await LanguageModel.availability();
  } catch {
    return 'unavailable';
  }
}

export async function complete({ system, user, schema }) {
  if (typeof LanguageModel === 'undefined') {
    throw new Error(t('err_edge_missing'));
  }

  const state = await LanguageModel.availability();
  if (state === 'unavailable') {
    throw new Error(t('err_edge_hardware'));
  }

  let session;
  try {
    session = await LanguageModel.create({
      initialPrompts: [{ role: 'system', content: system }],
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          const pct = e.total ? Math.round((e.loaded / e.total) * 100) : 0;
          console.info(`[tabsift] downloading model: ${pct}%`);
        });
      },
    });

    const text = await session.prompt(user, { responseConstraint: schema });
    return JSON.parse(text);
  } finally {
    session?.destroy?.();
  }
}

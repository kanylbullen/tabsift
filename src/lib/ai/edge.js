// Edges inbyggda on-device-modell via Prompt API (LanguageModel).
//
// Status i augusti 2026: developer preview. Kräver Edge Canary eller Dev,
// flaggan "Prompt API for on-device language model" i edge://flags, och
// tillräcklig hårdvara (Phi-4-mini: ~5,5 GB VRAM + 20 GB disk; den mindre
// Aion-1.0-Instruct går på CPU bakom en egen flagga).
//
// Ingen host-behörighet behövs — modellen körs i webbläsaren.

export const id = 'edge';
export const label = 'Edge inbyggd AI (Prompt API)';

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
    throw new Error(
      'LanguageModel saknas. Kräver Edge Canary/Dev med flaggan ' +
        '"Prompt API for on-device language model" påslagen.',
    );
  }

  const state = await LanguageModel.availability();
  if (state === 'unavailable') {
    throw new Error('Enheten uppfyller inte hårdvarukraven för den inbyggda modellen.');
  }

  let session;
  try {
    session = await LanguageModel.create({
      initialPrompts: [{ role: 'system', content: system }],
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          const pct = e.total ? Math.round((e.loaded / e.total) * 100) : 0;
          console.info(`[tabsift] laddar ner modell: ${pct}%`);
        });
      },
    });

    const text = await session.prompt(user, { responseConstraint: schema });
    return JSON.parse(text);
  } finally {
    session?.destroy?.();
  }
}

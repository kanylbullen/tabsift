// Minimal fuzzy-matchning för flikpaletten. Delsekvensmatchning med bonus för
// sammanhängande träffar och ordgränser — samma idé som i de flesta
// kommandopaletter, men liten nog att läsa igenom.

const SEQUENTIAL_BONUS = 12;
const BOUNDARY_BONUS = 9;
const PREFIX_BONUS = 6;
const GAP_PENALTY = -1;

/**
 * @returns {{score: number, positions: number[]} | null} null = ingen träff
 */
export function match(query, text) {
  if (!query) return { score: 0, positions: [] };
  if (!text) return null;

  const q = query.toLowerCase();
  const t = text.toLowerCase();

  let score = 0;
  let ti = 0;
  let lastMatch = -2;
  const positions = [];

  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    if (ch === ' ') continue; // mellanslag delar upp söktermer, matchar inte

    let found = -1;
    for (let i = ti; i < t.length; i++) {
      if (t[i] === ch) {
        found = i;
        break;
      }
    }
    if (found === -1) return null;

    if (found === lastMatch + 1) score += SEQUENTIAL_BONUS;
    if (found === 0) score += PREFIX_BONUS;
    const prev = found > 0 ? text[found - 1] : '';
    if (/[\s\-_/.:|·—]/.test(prev)) score += BOUNDARY_BONUS;

    score += GAP_PENALTY * Math.min(found - ti, 10);
    positions.push(found);
    lastMatch = found;
    ti = found + 1;
  }

  // Kortare träffsträngar rankas högre vid lika poäng.
  score -= Math.min(text.length, 200) * 0.05;
  return { score, positions };
}

/**
 * Matchar mot flera fält och tar det bästa resultatet.
 * @param {string} query
 * @param {{text: string, weight?: number}[]} fields
 */
export function matchBest(query, fields) {
  let best = null;
  for (const field of fields) {
    const res = match(query, field.text);
    if (!res) continue;
    const weighted = { ...res, score: res.score * (field.weight ?? 1), field: field.text };
    if (!best || weighted.score > best.score) best = weighted;
  }
  return best;
}

// Polymarket resolution rules: Rank column, AutoEval excluded,
// ties -> higher Arena score -> alphabetical company name.

export function companyOf(org, map) {
  const key = String(org ?? '').toLowerCase();
  return map[key] ?? org;
}

// HF publishes the same model as "Claude Opus 4.6 (High)" on one date and "claude-opus-4-6-high" on another;
// compare models by this key, display the name from the latest publish.
export function modelKey(name) {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function eligible(rows, autoEval) {
  return rows.filter(r => !autoEval.has(r.model_name));
}

export function resolveWinner(rows, map) {
  const ordered = [...rows].sort((a, b) =>
    (a.rank - b.rank) ||
    (b.rating - a.rating) ||
    companyOf(a.organization, map).localeCompare(companyOf(b.organization, map)));
  const top = ordered[0];
  if (!top) return null;
  return { model: top.model_name, company: companyOf(top.organization, map), rating: top.rating };
}

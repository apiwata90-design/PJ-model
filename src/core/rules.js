// Polymarket resolution rules: Rank column, AutoEval excluded,
// ties -> higher Arena score -> alphabetical company name.

export function companyOf(org, map) {
  const key = String(org ?? '').toLowerCase();
  return map[key] ?? org;
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

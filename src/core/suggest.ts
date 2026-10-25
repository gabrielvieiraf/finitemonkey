const distance = (a: string, b: string): number => {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j] ?? 0;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(above + 1, (row[j - 1] ?? 0) + 1, diagonal + cost);
      diagonal = above;
    }
  }
  return row[b.length] ?? 0;
};

export const closest = (input: string, candidates: readonly string[]): string | undefined => {
  const group = candidates.find((name) => name.startsWith(`${input} `));
  if (group !== undefined) return group;
  const limit = Math.max(1, Math.floor(input.length / 3));
  let best: { readonly name: string; readonly score: number } | undefined;
  for (const name of candidates) {
    const score = distance(input, name.split(" ")[0] ?? name);
    if (score <= limit && (best === undefined || score < best.score)) best = { name, score };
  }
  return best?.name;
};

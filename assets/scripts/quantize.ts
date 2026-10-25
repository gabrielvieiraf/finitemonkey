export type Rgb = readonly [number, number, number];

interface Bucket {
  readonly colors: readonly number[];
  readonly weight: number;
}

const opaque = 128;

export function histogram(frames: readonly Uint8Array[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const pixels of frames) {
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if ((pixels[offset + 3] ?? 0) < opaque) continue;
      const key = pack(pixels[offset] ?? 0, pixels[offset + 1] ?? 0, pixels[offset + 2] ?? 0);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

export function medianCut(counts: ReadonlyMap<number, number>, size: number): readonly Rgb[] {
  let buckets: Bucket[] = [bucket([...counts.keys()], counts)];
  while (buckets.length < size) {
    const target = widest(buckets);
    if (target === undefined) break;
    const [low, high] = split(target, counts);
    buckets = buckets.filter((candidate) => candidate !== target).concat(low, high);
  }
  return buckets.map((entry) => average(entry, counts));
}

export class Indexer {
  readonly #palette: readonly Rgb[];
  readonly #offset: number;
  readonly #cache = new Map<number, number>();

  constructor(palette: readonly Rgb[], offset: number) {
    this.#palette = palette;
    this.#offset = offset;
  }

  index(r: number, g: number, b: number): number {
    const key = pack(r, g, b);
    const cached = this.#cache.get(key);
    if (cached !== undefined) return cached;
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    this.#palette.forEach(([pr, pg, pb], position) => {
      const distance = 2 * (pr - r) ** 2 + 4 * (pg - g) ** 2 + 3 * (pb - b) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = position;
      }
    });
    const found = best + this.#offset;
    this.#cache.set(key, found);
    return found;
  }
}

function bucket(colors: readonly number[], counts: ReadonlyMap<number, number>): Bucket {
  return { colors, weight: colors.reduce((sum, color) => sum + (counts.get(color) ?? 0), 0) };
}

function widest(buckets: readonly Bucket[]): Bucket | undefined {
  let best: Bucket | undefined;
  let bestScore = 0;
  for (const entry of buckets) {
    if (entry.colors.length < 2) continue;
    const score = channelRange(entry).range * Math.sqrt(entry.weight);
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return best;
}

function split(entry: Bucket, counts: ReadonlyMap<number, number>): readonly [Bucket, Bucket] {
  const { channel } = channelRange(entry);
  const sorted = [...entry.colors].sort((a, b) => unpack(a)[channel] - unpack(b)[channel]);
  let running = 0;
  let cut = 1;
  for (let position = 0; position < sorted.length - 1; position += 1) {
    running += counts.get(sorted[position] ?? 0) ?? 0;
    cut = position + 1;
    if (running >= entry.weight / 2) break;
  }
  return [bucket(sorted.slice(0, cut), counts), bucket(sorted.slice(cut), counts)];
}

function channelRange(entry: Bucket): { readonly channel: 0 | 1 | 2; readonly range: number } {
  const low = [255, 255, 255];
  const high = [0, 0, 0];
  for (const color of entry.colors) {
    unpack(color).forEach((value, channel) => {
      low[channel] = Math.min(low[channel] ?? 255, value);
      high[channel] = Math.max(high[channel] ?? 0, value);
    });
  }
  const ranges = [0, 1, 2].map((channel) => (high[channel] ?? 0) - (low[channel] ?? 0));
  const r = ranges[0] ?? 0;
  const g = ranges[1] ?? 0;
  const b = ranges[2] ?? 0;
  if (g >= r && g >= b) return { channel: 1, range: g };
  if (r >= b) return { channel: 0, range: r };
  return { channel: 2, range: b };
}

function average(entry: Bucket, counts: ReadonlyMap<number, number>): Rgb {
  const sum = [0, 0, 0];
  let total = 0;
  for (const color of entry.colors) {
    const weight = counts.get(color) ?? 0;
    unpack(color).forEach((value, channel) => {
      sum[channel] = (sum[channel] ?? 0) + value * weight;
    });
    total += weight;
  }
  const mean = (channel: number): number => Math.round((sum[channel] ?? 0) / Math.max(total, 1));
  return [mean(0), mean(1), mean(2)];
}

function pack(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b;
}

function unpack(color: number): Rgb {
  return [(color >> 16) & 255, (color >> 8) & 255, color & 255];
}

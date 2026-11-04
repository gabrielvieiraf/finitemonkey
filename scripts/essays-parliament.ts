import { type Placed } from "./essays-plan.js";
import { makeItem, num, type SvgItem } from "./essays-svg.js";

const SEATS = 91;
const ROWS = 5;
const OUTER = 112;
const INNER = 46;
const SEAT_R = 5.6;
const FILL_SECONDS = 1.1;
const INK: Readonly<Record<string, string>> = {
  "#eff1f4": "#8a929c",
  "#e3e6eb": "#8a929c",
  "url(#hatch)": "#a8372b",
  "url(#dots)": "#7a5d2c",
  "#d9c6e8": "#6b4a8c",
  "#e5ecf8": "#2c5597",
  "#cddbf2": "#2c5597",
  "#e4f2ea": "#2a7552",
  "#cfe7da": "#2a7552",
};

export interface Bench {
  readonly first: number;
  readonly bands: number;
  readonly drop: number;
}

interface Seat {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

export function apportion(sizes: readonly number[], seats: number): number[] {
  const total = sizes.reduce((a, b) => a + b, 0);
  const exact = sizes.map((s) => (s * seats) / total);
  const counts = exact.map(Math.floor);
  const order = exact.map((e, i) => ({ i, rest: e - Math.floor(e) })).sort((a, b) => b.rest - a.rest);
  for (let k = 0; counts.reduce((a, b) => a + b, 0) < seats; k++) {
    const i = order[k % order.length]?.i ?? 0;
    counts[i] = (counts[i] ?? 0) + 1;
  }
  return counts;
}

function rowSeats(): number[] {
  const radii = Array.from({ length: ROWS }, (_, i) => INNER + (i * (OUTER - INNER)) / (ROWS - 1));
  return apportion(radii, SEATS);
}

export function hemicycle(cx: number, cy: number): Seat[] {
  const seats: Seat[] = [];
  rowSeats().forEach((count, row) => {
    const r = INNER + (row * (OUTER - INNER)) / (ROWS - 1);
    for (let j = 0; j < count; j++) {
      const angle = Math.PI - (j * Math.PI) / Math.max(count - 1, 1);
      seats.push({ x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle), angle });
    }
  });
  return seats.sort((a, b) => b.angle - a.angle || a.y - b.y);
}

function seatItems(panel: SvgItem, bands: readonly SvgItem[], start: number): Placed[] {
  const cx = num(panel, "x") + num(panel, "width") / 2;
  const cy = num(panel, "y") + num(panel, "height") - 16;
  const counts = apportion(
    bands.map((b) => num(b, "height")),
    SEATS,
  );
  const fills = counts.flatMap((n, i) => Array<string>(n).fill(bands[i]?.attrs["fill"] ?? "#e3e6eb"));
  return hemicycle(cx, cy).map((seat, k) => {
    const fill = fills[k] ?? "#e3e6eb";
    const ink = INK[fill] ?? "#8a929c";
    return {
      item: makeItem(
        `<circle cx="${seat.x.toFixed(1)}" cy="${seat.y.toFixed(1)}" r="${String(SEAT_R)}" fill="${fill}" stroke="${ink}" stroke-width="0.9" stroke-opacity="0.75"/>`,
      ),
      motion: { a: "seat", t: start + (k * FILL_SECONDS) / SEATS },
    };
  });
}

function shiftText(placed: Placed, panel: SvgItem): Placed {
  const from = /\sx="([\d.]+)"/.exec(placed.item.raw)?.[1] ?? "0";
  const to = (num(panel, "x") + 20).toFixed(1);
  return { ...placed, item: makeItem(placed.item.raw.replaceAll(`x="${from}"`, `x="${to}"`)) };
}

export function parliament(benches: readonly Bench[]): (placed: readonly Placed[]) => Placed[] {
  return (placed) => {
    const out: Placed[] = [];
    let i = 0;
    while (i < placed.length) {
      const bench = benches.find((b) => b.first === i);
      const current = placed[i];
      if (!bench || !current) {
        if (current) out.push(current);
        i++;
        continue;
      }
      const bands = placed.slice(i + 1, i + 1 + bench.bands).map((p) => p.item);
      const text = placed[i + 1 + bench.drop];
      out.push(current, ...seatItems(current.item, bands, (current.motion?.t ?? 0) + 0.2));
      if (text) out.push(shiftText(text, current.item));
      i += bench.drop + 2;
    }
    return out;
  };
}

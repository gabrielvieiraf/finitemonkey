export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

const HEX = /^#([0-9a-f]{3,8})$/i;
const FUNC = /^(rgba?|hsla?)\(([^)]+)\)$/i;

const channel = (raw: string, scale: number): number => {
  const value = raw.trim();
  return value.endsWith("%") ? (Number.parseFloat(value) / 100) * scale : Number.parseFloat(value);
};

const fromHex = (digits: string): Rgba | undefined => {
  const full =
    digits.length === 3 || digits.length === 4
      ? digits
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : digits;
  if (full.length !== 6 && full.length !== 8) return undefined;
  const part = (at: number): number => Number.parseInt(full.slice(at, at + 2), 16);
  return { r: part(0), g: part(2), b: part(4), a: full.length === 8 ? part(6) / 255 : 1 };
};

const hue = (p: number, q: number, t: number): number => {
  const wrapped = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
  if (wrapped < 1 / 6) return p + (q - p) * 6 * wrapped;
  if (wrapped < 1 / 2) return q;
  if (wrapped < 2 / 3) return p + (q - p) * (2 / 3 - wrapped) * 6;
  return p;
};

const fromHsl = (h: number, s: number, l: number, a: number): Rgba => {
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255, a };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const turn = (((h % 360) + 360) % 360) / 360;
  return { r: hue(p, q, turn + 1 / 3) * 255, g: hue(p, q, turn) * 255, b: hue(p, q, turn - 1 / 3) * 255, a };
};

export const parseColor = (raw: string): Rgba | undefined => {
  const value = raw.trim().toLowerCase();
  if (value === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  if (value === "white") return WHITE;
  if (value === "black") return { r: 0, g: 0, b: 0, a: 1 };
  const hex = HEX.exec(value);
  if (hex?.[1] !== undefined) return fromHex(hex[1]);
  const func = FUNC.exec(value);
  if (func?.[1] === undefined || func[2] === undefined) return undefined;
  const parts = func[2].split(/[\s,/]+/).filter((part) => part !== "");
  if (parts.length < 3) return undefined;
  const [first = "", second = "", third = "", fourth] = parts;
  const alpha = fourth === undefined ? 1 : channel(fourth, 1);
  if (func[1].startsWith("rgb"))
    return { r: channel(first, 255), g: channel(second, 255), b: channel(third, 255), a: alpha };
  return fromHsl(Number.parseFloat(first), channel(second, 1), channel(third, 1), alpha);
};

export const over = (top: Rgba, bottom: Rgba): Rgba => {
  const a = top.a + bottom.a * (1 - top.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (front: number, back: number): number => (front * top.a + back * bottom.a * (1 - top.a)) / a;
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
};

const linear = (value: number): number => {
  const unit = value / 255;
  return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
};

export const luminance = (color: Rgba): number =>
  0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);

export const contrastRatio = (first: Rgba, second: Rgba): number => {
  const [light, dark] = [luminance(first), luminance(second)].sort((left, right) => right - left);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
};

export const colorDistance = (first: Rgba, second: Rgba): number =>
  Math.sqrt((first.r - second.r) ** 2 + (first.g - second.g) ** 2 + (first.b - second.b) ** 2) +
  Math.abs(first.a - second.a) * 255;

export const hueOf = (color: Rgba): { readonly hue: number; readonly saturation: number; readonly light: number } => {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { hue: 0, saturation: 0, light };
  const saturation = delta / (1 - Math.abs(2 * light - 1));
  const raw = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { hue: (raw * 60 + 360) % 360, saturation, light };
};

export const toHex = (color: Rgba): string =>
  `#${[color.r, color.g, color.b].map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;

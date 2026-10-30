import type { Band } from "./trajectory-bands.js";

export type Theme = "light" | "dark";
export type ThemeChoice = Theme | "auto";

export const TOKENS = [
  "bg",
  "ink",
  "muted",
  "faint",
  "rule",
  "grid",
  "i1",
  "iInk",
  "p1",
  "pInk",
  "u",
  "uInk",
  "b1",
  "bInk",
  "bCov",
  "bCovInk",
  "bNone",
  "h2",
  "hInk",
  "you",
  "youHalo",
] as const;

export type Token = (typeof TOKENS)[number];

export const SVG_TOKENS: Readonly<Record<Theme, Readonly<Record<Token, string>>>> = {
  light: {
    bg: "#fcfcfd",
    ink: "#121519",
    muted: "#5d6570",
    faint: "#8a929c",
    rule: "#e2e5e9",
    grid: "#eceef1",
    i1: "#cfe7da",
    iInk: "#2a7552",
    p1: "#cddbf2",
    pInk: "#2c5597",
    u: "#d9c6e8",
    uInk: "#6b4a8c",
    b1: "#f3dedb",
    bInk: "#a8372b",
    bCov: "#e9e1d3",
    bCovInk: "#7a5d2c",
    bNone: "#f6ebe9",
    h2: "#eff1f4",
    hInk: "#6b7480",
    you: "#b97d00",
    youHalo: "#fbecc6",
  },
  dark: {
    bg: "#0d1014",
    ink: "#e6e9ee",
    muted: "#9aa3ae",
    faint: "#6f7884",
    rule: "#232a33",
    grid: "#1a2028",
    i1: "#173a2a",
    iInk: "#5fd09d",
    p1: "#1b2f52",
    pInk: "#86aef0",
    u: "#3a2b4f",
    uInk: "#c4a3ea",
    b1: "#43211f",
    bInk: "#f08a7e",
    bCov: "#3a3020",
    bCovInk: "#e0bb72",
    bNone: "#2c1c1b",
    h2: "#151a21",
    hInk: "#8994a2",
    you: "#ffc24d",
    youHalo: "#3b2e10",
  },
};

export type Ink = "line" | "ricochet" | "held" | "faint";

export interface TermPalette {
  readonly band: Readonly<Record<Band, number>>;
  readonly ink: Readonly<Record<Ink, number>>;
  readonly gap: number;
  readonly select: number;
}

export const TERM_PALETTE: Readonly<Record<Theme, TermPalette>> = {
  dark: {
    band: {
      alone: 0x1b4a35,
      proximal: 0x203a66,
      unstable: 0x3d2d55,
      blindCovered: 0x4a3a1c,
      blindBare: 0x5a2420,
      blind: 0x3b2723,
      beyond: 0x191e25,
    },
    ink: { line: 0xffc24d, ricochet: 0xff8a7c, held: 0x6fe0ac, faint: 0x6f7884 },
    gap: 0x252c36,
    select: 0xe6e9ee,
  },
  light: {
    band: {
      alone: 0xcfe7da,
      proximal: 0xcddbf2,
      unstable: 0xd9c6e8,
      blindCovered: 0xe9e1d3,
      blindBare: 0xf3dedb,
      blind: 0xf6ebe9,
      beyond: 0xeff1f4,
    },
    ink: { line: 0xb97d00, ricochet: 0xa8372b, held: 0x2a7552, faint: 0x8a929c },
    gap: 0xe3e6eb,
    select: 0x121519,
  },
};

export const BAND_FILL: Readonly<Record<Band, Token>> = {
  alone: "i1",
  proximal: "p1",
  unstable: "u",
  blindCovered: "bCov",
  blindBare: "b1",
  blind: "bNone",
  beyond: "h2",
};

export const themeOf = (value: unknown): ThemeChoice => {
  if (typeof value !== "string") return "auto";
  if (value.startsWith("dark")) return "dark";
  if (value.startsWith("light")) return "light";
  return "auto";
};

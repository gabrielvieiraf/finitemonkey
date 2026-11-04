import { type Plan, span, type Step } from "./essays-plan.js";

const TITLE = [0, 1];

const slide = (els: readonly number[], at: number): Step[] => [
  { at, a: "slide", els: [els[0] ?? 0] },
  { at: at + 0.12, a: "fade", els: els.slice(1), gap: 0.05 },
];

const fig1: Plan = {
  count: 24,
  still: TITLE,
  steps: [
    ...slide([2, 3, 4], 0),
    { at: 0.3, a: "fade", els: [5] },
    ...slide([6, 7, 8], 0.2),
    { at: 0.5, a: "fade", els: [9] },
    { at: 0.5, a: "draw", els: [19], d: 0.3 },
    { at: 0.65, a: "fade", els: [20] },
    ...slide([10, 11, 12], 0.6),
    ...slide([13, 14, 15], 0.72),
    { at: 0.95, a: "draw", els: [16, 17], gap: 0.08, d: 0.3 },
    { at: 1.1, a: "fade", els: [18] },
    { at: 1.25, a: "draw", els: [21], d: 0.5 },
    { at: 1.5, a: "fade", els: [22, 23], gap: 0.1 },
  ],
};

const row = (cards: readonly number[], arrows: readonly number[], note: number, at: number): Step[] => [
  ...cards.flatMap((first, k) => slide([first, first + 1, first + 2], at + k * 0.32)),
  ...arrows.map((el, k): Step => ({ at: at + 0.22 + k * 0.32, a: "draw", els: [el], d: 0.22 })),
  { at: at + 0.85, a: "fade", els: [note] },
];

const fig2: Plan = {
  count: 34,
  still: TITLE,
  steps: [
    { at: 0, a: "fade", els: [2, 4, 6], gap: 0.08 },
    { at: 0, a: "draw", els: [3, 5, 7], gap: 0.08, d: 0.6 },
    { at: 0.15, a: "fade", els: [8, 9], gap: 0.1 },
    ...row([10, 13, 16], [19, 20], 21, 0.3),
    ...row([22, 25, 28], [31, 32], 33, 0.55),
  ],
};

const fig3: Plan = {
  count: 52,
  still: TITLE,
  steps: [
    { at: 0, a: "fade", els: [2] },
    ...[3, 6, 9, 12, 15].flatMap((first, k) => slide([first, first + 1], 0.05 + k * 0.07)),
    { at: 0.4, a: "draw", els: [5, 8, 11, 14, 17], gap: 0.05, d: 0.3 },
    { at: 0.6, a: "pop", els: [26, 27, 28] },
    { at: 0.85, a: "draw", els: [32], d: 0.2 },
    ...slide([29, 30, 31], 0.9),
    { at: 1.1, a: "draw", els: [36], d: 0.2 },
    ...slide([33, 34, 35], 1.15),
    ...slide([18, 19], 0.95),
    { at: 1.05, a: "draw", els: [23], d: 0.2 },
    ...slide([20, 21, 22], 1.1),
    { at: 1.3, a: "draw", els: [24], d: 0.35 },
    { at: 1.4, a: "fade", els: [25] },
    { at: 1.4, a: "draw", els: [42], d: 0.35 },
    { at: 1.5, a: "fade", els: [43] },
    ...slide([37, 38, 39], 1.6),
    { at: 1.8, a: "draw", els: [40], d: 0.25 },
    { at: 1.9, a: "fade", els: [41] },
    ...slide([44, 45, 46], 1.75),
    { at: 1.75, a: "draw", els: [47], d: 0.15 },
    { at: 1.95, a: "fade", els: [48], d: 0.5 },
    { at: 2.2, a: "draw", els: [49, 50], gap: 0.08, d: 0.15 },
    { at: 2.3, a: "fade", els: [51] },
  ],
};

const step = (rect: number, texts: readonly number[], at: number): Step[] => [
  { at, a: "up", els: [rect], d: 0.45 },
  { at: at + 0.3, a: "fade", els: texts, gap: 0.06 },
];

const fig4: Plan = {
  count: 19,
  still: TITLE,
  steps: [
    { at: 0, a: "draw", els: [15], d: 0.5 },
    ...step(2, [3, 4], 0.1),
    ...step(5, [6, 7], 0.25),
    ...step(8, [9, 10], 0.4),
    ...step(11, [12, 13, 14], 0.55),
    { at: 0.6, a: "draw", els: [16], d: 0.9 },
    { at: 1.1, a: "fade", els: [17, 18], gap: 0.1 },
  ],
};

const bar = (label: number, segments: readonly number[], at: number): Step[] => [
  { at, a: "fade", els: [label] },
  { at: at + 0.05, a: "right", els: segments, chain: 0.75 },
];

const fig5: Plan = {
  count: 49,
  still: [0, 1, 2],
  steps: [
    { at: 0, a: "fade", els: span(3, 12), gap: 0.03 },
    ...bar(13, [14, 15, 16], 0.15),
    ...bar(17, [18, 19, 20, 21], 0.25),
    ...bar(22, [23, 24, 25], 0.35),
    ...bar(26, [27, 28, 29, 30], 0.45),
    ...bar(31, [32, 33, 34], 0.55),
    ...bar(35, [36, 37, 38, 39], 0.65),
    { at: 1.3, a: "fade", els: span(40, 47), gap: 0.04 },
    { at: 1.6, a: "fade", els: [48] },
  ],
};

export const SECOND_BRAIN_PLANS: Readonly<Record<string, Plan>> = { fig1, fig2, fig3, fig4, fig5 };

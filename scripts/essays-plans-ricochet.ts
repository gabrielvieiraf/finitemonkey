import { parliament } from "./essays-parliament.js";
import { type Plan, span, type Step } from "./essays-plan.js";

const TITLE = [0, 1, 2];

const card = (first: number, at: number): Step[] => [
  { at, a: "slide", els: [first] },
  { at: at + 0.1, a: "right", els: [first + 1], d: 0.4 },
  { at: at + 0.15, a: "fade", els: [first + 2, first + 3, first + 4], gap: 0.05 },
];

const box = (rect: number, at: number): Step => ({ at, a: "pop", els: [rect, rect + 1] });

const cycle = (boxes: readonly number[], arrows: readonly number[], at: number): Step[] =>
  boxes.flatMap((rect, k) => [
    box(rect, at + k * 0.26),
    { at: at + k * 0.26 + 0.16, a: "draw", els: [arrows[k] ?? 0], d: 0.22 },
  ]);

const callout = (bracket: number, rest: readonly number[], at: number): Step[] => [
  { at, a: "draw", els: [bracket, rest[0] ?? 0], gap: 0.12, d: 0.3 },
  { at: at + 0.2, a: "fade", els: rest.slice(1), gap: 0.04 },
];

const fig1: Plan = {
  count: 53,
  still: TITLE,
  steps: [
    { at: 0, a: "draw", els: [40], d: 0.5 },
    { at: 0, a: "fade", els: [12, 29, 18, 19, 35, 36], gap: 0.04 },
    { at: 0.15, a: "up", els: span(3, 7), chain: 0.95 },
    { at: 0.3, a: "up", els: span(20, 24), chain: 0.95 },
    { at: 0.75, a: "fade", els: [...span(8, 11), ...span(25, 28)], gap: 0.02 },
    { at: 0.85, a: "draw", els: [38], d: 0.5 },
    { at: 1.0, a: "fade", els: [39, 15, 16, 13, 14, 32, 33, 30, 31], gap: 0.06 },
    { at: 1.25, a: "draw", els: [17, 34], gap: 0.1, d: 0.5 },
    { at: 1.5, a: "fade", els: [37] },
    { at: 1.1, a: "fade", els: span(41, 52), gap: 0.03 },
  ],
};

const fig2: Plan = {
  count: 61,
  still: TITLE,
  steps: [
    { at: 0, a: "fade", els: [19] },
    { at: 0.05, a: "up", els: span(3, 11), chain: 1.3 },
    { at: 1.1, a: "fade", els: span(12, 18), gap: 0.02 },
    { at: 0.3, a: "fade", els: [26, 27] },
    { at: 0.6, a: "fade", els: [24, 25] },
    { at: 0.95, a: "fade", els: [22, 23] },
    { at: 1.25, a: "fade", els: [20, 21] },
    ...callout(54, span(55, 60), 0.35),
    ...callout(47, span(48, 53), 0.65),
    { at: 0.85, a: "draw", els: [44], d: 0.25 },
    { at: 0.95, a: "fade", els: [45, 46], gap: 0.05 },
    ...callout(37, span(38, 43), 1.0),
    ...callout(30, span(31, 36), 1.3),
    { at: 1.45, a: "draw", els: [28], d: 0.4 },
    { at: 1.65, a: "fade", els: [29] },
  ],
};

const benchAt = (first: number, at: number): Step[] => [
  { at, a: "fade", els: [first] },
  { at: at + 0.1, a: "fade", els: [first + 18] },
  { at, a: "fade", els: span(first + 1, first + 17) },
];

const fig3: Plan = {
  count: 105,
  still: TITLE,
  steps: [
    { at: 0, a: "draw", els: [79, 80], d: 0.5 },
    { at: 0.35, a: "fade", els: [81, 82], gap: 0.1 },
    ...benchAt(41, 0.1),
    ...benchAt(60, 0.3),
    ...benchAt(3, 0.5),
    ...benchAt(22, 0.7),
    { at: 0.6, a: "fade", els: span(83, 104), gap: 0.03 },
  ],
  redraw: parliament([3, 22, 41, 60].map((first) => ({ first, bands: 9, drop: 17 }))),
};

const fig4: Plan = {
  count: 87,
  still: TITLE,
  steps: [
    { at: 0, a: "fade", els: [3, 33, 16, 46] },
    { at: 0, a: "draw", els: [31, 61], d: 0.4 },
    { at: 0.05, a: "up", els: span(4, 10), chain: 0.7 },
    { at: 0.15, a: "up", els: span(34, 40), chain: 0.7 },
    { at: 0.6, a: "fade", els: [...span(11, 15), ...span(41, 45)], gap: 0.02 },
    { at: 0.35, a: "fade", els: [19, 20, 21, 22, 49, 50, 51, 52], gap: 0.03 },
    { at: 0.75, a: "fade", els: [17, 18, 47, 48], gap: 0.04 },
    { at: 0.85, a: "draw", els: [23], d: 1.0 },
    { at: 0.95, a: "draw", els: [53], d: 1.0 },
    { at: 1.15, a: "pop", els: [24] },
    { at: 1.2, a: "fade", els: [27] },
    { at: 1.2, a: "count", els: [28], d: 0.45 },
    { at: 1.25, a: "pop", els: [54] },
    { at: 1.3, a: "fade", els: [57] },
    { at: 1.3, a: "count", els: [58], d: 0.45 },
    { at: 1.75, a: "fade", els: [29] },
    { at: 1.75, a: "count", els: [30], from: 80, d: 0.5 },
    { at: 1.85, a: "pop", els: [25, 26] },
    { at: 1.85, a: "fade", els: [59] },
    { at: 1.85, a: "count", els: [60], from: 80, d: 0.3 },
    { at: 1.95, a: "pop", els: [55, 56] },
    { at: 2.1, a: "fade", els: [32, 62], gap: 0.1 },
    { at: 0.5, a: "fade", els: span(63, 86), gap: 0.03 },
  ],
};

const fig5: Plan = {
  count: 41,
  still: TITLE,
  steps: [
    { at: 0, a: "fade", els: [3, 22], gap: 0.1 },
    ...cycle([10, 12, 14, 16, 18, 20], [4, 5, 6, 7, 8, 9], 0.1),
    ...cycle([29, 31, 33, 35, 37, 39], [23, 24, 25, 26, 27, 28], 0.2),
  ],
};

const fig6: Plan = {
  count: 78,
  still: TITLE,
  steps: [
    { at: 0, a: "draw", els: [55], d: 0.5 },
    { at: 0, a: "fade", els: [17, 33, 52, 18, 34, 53], gap: 0.03 },
    { at: 0.1, a: "up", els: span(3, 10), chain: 0.9 },
    { at: 0.3, a: "up", els: span(19, 26), chain: 0.9 },
    { at: 0.5, a: "up", els: span(36, 44), chain: 0.9 },
    { at: 1.2, a: "fade", els: [...span(11, 16), ...span(27, 32), ...span(45, 51)], gap: 0.01 },
    { at: 1.3, a: "fade", els: [35, 54], gap: 0.15 },
    { at: 0.9, a: "fade", els: span(56, 77), gap: 0.03 },
  ],
};

const fig7: Plan = {
  count: 44,
  still: TITLE,
  steps: [
    ...card(3, 0),
    { at: 0.3, a: "draw", els: [8], d: 0.2 },
    ...card(9, 0.35),
    { at: 0.65, a: "draw", els: [14], d: 0.2 },
    ...card(15, 0.7),
    { at: 1.0, a: "draw", els: [20], d: 0.2 },
    ...card(21, 1.05),
    { at: 1.35, a: "fade", els: [26] },
    { at: 1.3, a: "draw", els: [27], d: 0.5 },
    { at: 1.45, a: "fade", els: [28] },
    { at: 1.55, a: "fade", els: span(29, 43), gap: 0.035 },
  ],
};

const fig8: Plan = {
  count: 41,
  still: TITLE,
  steps: [
    ...card(3, 0),
    { at: 0.28, a: "draw", els: [33], d: 0.22 },
    ...card(8, 0.33),
    { at: 0.61, a: "draw", els: [34], d: 0.22 },
    ...card(13, 0.66),
    { at: 0.94, a: "draw", els: [35], d: 0.22 },
    ...card(18, 0.99),
    { at: 1.27, a: "draw", els: [36], d: 0.22 },
    ...card(23, 1.32),
    { at: 1.6, a: "draw", els: [37], d: 0.22 },
    ...card(28, 1.65),
    { at: 1.93, a: "draw", els: [38], d: 0.22 },
    { at: 2.1, a: "pop", els: [39, 40] },
  ],
};

export const RICOCHET_PLANS: Readonly<Record<string, Plan>> = { fig1, fig2, fig3, fig4, fig5, fig6, fig7, fig8 };

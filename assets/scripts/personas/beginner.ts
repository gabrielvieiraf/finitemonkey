import { classicLook, cuff, type Look, raisedHand, sleeve } from "../monkey.ts";
import { palette } from "../palette.ts";
import { type Ctx, lerp, type Persona, typingKeys } from "../persona.ts";
import { banana, laptop, mouseInHand, mouseOnDesk, mug } from "../props.ts";
import { svg } from "../svg.ts";
import { text, textWidth } from "../text.ts";
import { chatWindow, greyLines, ink, note } from "./kit.ts";

const gagFrames = 18;
const loopLength = 6;
const ai1 = { x: 8, y: 30 } as const;
const ai2 = { x: 262, y: 30 } as const;
const corners = [
  { x: ai1.x + 35, y: ai1.y + 30 },
  { x: 175, y: 262 },
  { x: ai2.x + 35, y: ai2.y + 30 },
] as const;
const catchFrames = 4;
const holding = { x: 100, y: 238 } as const;
const held = { x: 93, y: 213 } as const;

const look: Look = { ...classicLook, bodyScale: 1.1, longSleeves: true, onHead: cap(1) };

export const beginner: Persona = {
  id: "beginner",
  script: {
    checks: [
      { label: "loops", fail: "same error 3x", pass: "new plan", passesAtRun: 2 },
      { label: "api", fail: "not in v4", pass: "real api", passesAtRun: 2 },
      { label: "webhook", fail: "pays twice", pass: "idempotent", passesAtRun: 3 },
      { label: "tests", fail: "4 failing", pass: "12 passed", passesAtRun: 4 },
      { label: "goal", fail: "not yet", pass: "booking works", passesAtRun: 5 },
    ],
    prompt: "$ finitemonkey gate",
    verdict: "✓ milestone 1 real",
    gagFrames,
    celebrateFrames: 16,
    keys: typingKeys,
    gagKeys: typingKeys,
    hands: "both",
  },
  confetti: true,
  mood: (ctx) => ctx.frame.mood,
  look: (ctx, pose) => ({
    ...look,
    onHead: cap(pose.mood === "celebrate" ? Math.cos((ctx.frame.step / 8) * Math.PI) : 1),
    leftArm: caught(ctx) >= 0 && pose.mood !== "celebrate" ? holdingArm(ctx) : undefined,
  }),
  back: () => aiWindow(ai1.x, ai1.y, "ai 1") + aiWindow(ai2.x, ai2.y, "ai 2"),
  props: (ctx, pose) => {
    const hand = raisedHand(pose);
    const done = pose.mood === "celebrate" || ctx.frame.phase === "fade";
    return (
      laptop(
        banana(146, 292, -18, 0.8) +
          note(196, 262, 7, done ? ["1/24"] : ["saas!!"], done ? 1.4 : 1.1) +
          note(140, 252, -9, ["$$$"], 1.2),
      ) +
      mug(ctx.frame.beat) +
      (pose.mood === "celebrate" ? mouseInHand(hand.x, hand.y) : mouseOnDesk())
    );
  },
  front: (ctx) => ricochet(ctx) + counter(ctx),
};

function cap(turn: number): string {
  const brim = turn >= 0 ? 1 : -1;
  const width = Math.max(0.15, Math.abs(turn));
  return (
    svg`<path d="M124 112Q126 72 175 70Q224 72 226 112Q175 100 124 112Z" fill="${ink.teal}" stroke="${ink.tealDark}" stroke-width="3"/>` +
    svg`<g transform="translate(175 104) scale(${(brim * width).toFixed(2)} 1)">` +
    svg`<path d="M44 0Q74 -4 82 6Q60 12 40 8Z" fill="${ink.tealDark}"/>` +
    svg`</g>` +
    svg`<circle cx="175" cy="72" r="5" fill="${ink.tealDark}"/>` +
    svg`<path d="M163 111a12 10 0 0 1 24 0z" fill="${palette.fur}"/>` +
    svg`<path d="M163 108h24" stroke="${ink.tealDark}" stroke-width="2.5" stroke-linecap="round"/>`
  );
}

function aiWindow(x: number, y: number, label: string): string {
  const body = greyLines(x + 8, y + 20, [40, 54, 30]) + text(label, x + 70 - textWidth(label, 1.2) - 8, y + 4, 1.2, palette.dim);
  return chatWindow(x, y, 70, 50, body);
}

function runStart(ctx: Ctx): number {
  return ctx.frames.findIndex((frame) => frame.run === 2);
}

function caught(ctx: Ctx): number {
  const start = runStart(ctx);
  return start < 0 || ctx.index < start ? -1 : ctx.index - start;
}

function ballAt(index: number): { readonly x: number; readonly y: number } {
  const leg = Math.floor(index / (loopLength / 3)) % 3;
  const from = corners[leg] ?? corners[0];
  const to = corners[(leg + 1) % 3] ?? corners[0];
  const t = (index % (loopLength / 3)) / (loopLength / 3);
  return { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) - Math.round(Math.sin(t * Math.PI) * 18) };
}

function ricochet(ctx: Ctx): string {
  if (ctx.frame.mood === "celebrate" || ctx.frame.phase === "fade") return "";
  const elapsed = caught(ctx);
  if (elapsed < 0) {
    const at = ballAt(ctx.index);
    const trail = ballAt(Math.max(0, ctx.index - 1));
    return ball(trail.x, trail.y, 0.35) + ball(at.x, at.y, 1);
  }
  const start = runStart(ctx);
  const from = ballAt(start);
  const t = Math.min(1, elapsed / catchFrames);
  return ball(lerp(from.x, held.x, t), lerp(from.y, held.y, t), 1);
}

function ball(x: number, y: number, opacity: number): string {
  return svg`<circle cx="${x}" cy="${y}" r="8" fill="${palette.amber}" stroke="${palette.hoodieDark}" stroke-width="2" opacity="${opacity}"/>`;
}

function counter(ctx: Ctx): string {
  if (caught(ctx) >= 0 || ctx.frame.mood === "celebrate" || ctx.frame.phase === "fade") return "";
  const label = `loop ${String(Math.floor(ctx.index / loopLength) + 1)}`;
  const x = 175 - textWidth(label, 1.5) / 2;
  return (
    svg`<rect x="${x - 6}" y="44" width="${textWidth(label, 1.5) + 12}" height="20" rx="6" fill="${palette.terminal}" stroke="${palette.amber}" stroke-width="2"/>` +
    text(label, x, 49, 1.5, palette.amber)
  );
}

function holdingArm(ctx: Ctx): string {
  const t = Math.min(1, caught(ctx) / catchFrames);
  const y = lerp(296, holding.y, t);
  return sleeve(svg`M122 234Q86 262 ${holding.x} ${y}`) + cuff(holding.x, y + 4);
}

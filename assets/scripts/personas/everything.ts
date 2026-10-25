import { classicLook, type Look, paw, raisedHand, sleeve } from "../monkey.ts";
import { palette } from "../palette.ts";
import { type Ctx, isRow, lerp, type Persona, progress, since, typingKeys } from "../persona.ts";
import { banana, deskY, laptop, mouseOnDesk, stickyNote } from "../props.ts";
import { svg } from "../svg.ts";
import { text } from "../text.ts";
import { bubble, chatWindow, greyLines, ink } from "./kit.ts";

const phoneHand = { x: 92, y: 250 } as const;
const dropFrames = 6;

const prodRed = (ctx: Ctx): number => since(ctx, (frame) => isRow(frame, 3, "fail"));
const scrolling = (ctx: Ctx): boolean => prodRed(ctx) < 0;

export const everything: Persona = {
  id: "everything",
  script: {
    checks: [
      { label: "login", fail: "fixed?", pass: "8 passed", passesAtRun: 2 },
      { label: "csv", fail: "fixed?", pass: "5 passed", passesAtRun: 3 },
      { label: "tests", fail: "1 skipped", pass: "0 skipped", passesAtRun: 3 },
      { label: "prod", fail: "ssh blocked", pass: "via pipeline", passesAtRun: 4 },
      { label: "secrets", fail: ".env in diff", pass: "none", passesAtRun: 2 },
    ],
    prompt: "$ fm gate",
    verdict: "✓ done, no shortcut",
    gagFrames: 24,
    celebrateFrames: 24,
    keys: typingKeys,
    gagKeys: typingKeys,
    hands: "right",
  },
  confetti: true,
  mood: (ctx) => (ctx.frame.phase === "result" && ctx.frame.run === 1 ? "worried" : ctx.frame.mood),
  look: (ctx): Look =>
    scrolling(ctx) ? { ...classicLook, gaze: { x: -6, y: 4 }, leftArm: phoneArm(ctx) } : classicLook,
  back: () => tabs(),
  props: (ctx, pose) => {
    const hand = raisedHand(pose);
    return (
      laptop(banana(152, 284, -18, 0.9) + stickyNote(198, 256, 7, shipItAll())) +
      (pose.mood === "celebrate" ? "" : energyCan(266, ctx.frame.beat)) +
      mouseOnDesk() +
      fallingPhone(ctx) +
      (pose.mood === "celebrate" ? canInHand(hand.x, hand.y) : "")
    );
  },
  front: (ctx) =>
    ctx.frame.phase === "gag" || ctx.frame.phase === "intro" ? bubble(226, 136, "ship it all", 1.5, "left") : "",
};

function shipItAll(): string {
  return text("ship", -14, -6, 1.2, palette.noteInk) + text("it all", -17, 5, 1.2, palette.noteInk);
}

function tabs(): string {
  return [
    { x: 250, y: 30, label: "csv" },
    { x: 258, y: 46, label: "login" },
    { x: 266, y: 62, label: "prod" },
  ]
    .map(({ x, y, label }) => chatWindow(x, y, 72, 52, text(label, x + 26, y + 4, 1.2, palette.dim) + greyLines(x + 8, y + 22, [50, 36, 44])))
    .join("");
}

function phoneArm(ctx: Ctx): string {
  const wiggle = ctx.frame.beat % 4 < 2 ? 0 : -2;
  return (
    sleeve(svg`M122 234Q96 256 ${phoneHand.x + 8} ${phoneHand.y + 6}`) +
    phone(phoneHand.x - 4, phoneHand.y - 28 + wiggle, -12, ctx.frame.beat) +
    paw(phoneHand.x + 4, phoneHand.y + wiggle)
  );
}

function phone(x: number, y: number, angle: number, beat: number): string {
  const scroll = (beat * 4) % 12;
  return (
    svg`<g transform="translate(${x} ${y}) rotate(${angle}) scale(1.3)">` +
    svg`<rect x="-12" y="-20" width="24" height="40" rx="5" fill="${palette.headphone}"/>` +
    svg`<rect x="-9" y="-16" width="18" height="30" rx="2" fill="${ink.teal}"/>` +
    svg`<path d="M-6 ${-12 + scroll}h12M-6 ${-6 + scroll}h8M-6 ${scroll}h12" stroke="${palette.terminal}" stroke-width="2" opacity="0.6"/>` +
    svg`</g>`
  );
}

function fallingPhone(ctx: Ctx): string {
  const elapsed = prodRed(ctx);
  if (elapsed < 0) return "";
  const t = progress(elapsed, dropFrames);
  if (t < 1) return phone(lerp(phoneHand.x - 4, 56, t), lerp(phoneHand.y - 28, deskY - 9, t * t), lerp(-12, -95, t), 0);
  return phone(56, deskY - 9, -90, 0);
}

function energyCan(x: number, beat: number): string {
  const flicker = beat % 4;
  const bolt = (dx: number, shown: boolean): string =>
    shown
      ? svg`<path d="M${x + dx} ${270}l-5 9h5l-4 9l9 -12h-5l4 -6z" fill="${palette.amber}"/>`
      : "";
  return (
    bolt(4, flicker !== 1) +
    bolt(13, flicker !== 2) +
    bolt(22, flicker !== 3) +
    svg`<rect x="${x}" y="288" width="26" height="${deskY - 288}" rx="4" fill="${palette.headphone}"/>` +
    svg`<rect x="${x}" y="288" width="26" height="5" rx="2" fill="${ink.paperEdge}"/>` +
    svg`<path d="M${x + 15} 297l-6 9h5l-4 9l9 -12h-5l4 -6z" fill="${palette.green}"/>`
  );
}

function canInHand(x: number, y: number): string {
  return (
    svg`<g transform="translate(${x - 16} ${y - 38}) rotate(-12 13 17) scale(1.25)">` +
    svg`<rect x="0" y="0" width="26" height="34" rx="4" fill="${palette.headphone}"/>` +
    svg`<rect x="0" y="0" width="26" height="5" rx="2" fill="${ink.paperEdge}"/>` +
    svg`<path d="M15 9l-6 9h5l-4 9l9 -12h-5l4 -6z" fill="${palette.green}"/>` +
    svg`</g>` +
    paw(x, y + 8)
  );
}

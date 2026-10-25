import { classicLook, type Look, neckY, raisedHand } from "../monkey.ts";
import { palette } from "../palette.ts";
import { type Ctx, isRow, lerp, type Persona, progress, since, typingKeys } from "../persona.ts";
import { laptop, mouseInHand, mouseOnDesk } from "../props.ts";
import { svg } from "../svg.ts";
import { text } from "../text.ts";
import { centered, chatWindow, greyLines, ink, popScale } from "./kit.ts";

const look: Look = { ...classicLook, headScale: 1.22, bodyScale: 0.8, headphones: false, behindHead: hoodUp() };
const chat = { x: 6, y: 28, w: 84, h: 72 } as const;
const page = { x: 244, y: 30 } as const;
const dragStart = 3;
const dragLength = 10;
const landed = dragStart + dragLength;

const labelRed = (ctx: Ctx): number => since(ctx, (frame) => isRow(frame, 4, "fail"));

export const baby: Persona = {
  id: "baby",
  script: {
    checks: [
      { label: "page", fail: "ok", pass: "ok", passesAtRun: 1 },
      { label: "saves", fail: "lost on f5", pass: "persists", passesAtRun: 2 },
      { label: "2 guests", fail: "same gift", pass: "one wins", passesAtRun: 3 },
      { label: "secrets", fail: "key pasted", pass: "moved to env", passesAtRun: 2 },
      { label: "label", fail: "saas? no", pass: "prototype", passesAtRun: 4 },
    ],
    prompt: "$ finitemonkey gate",
    verdict: "✓ really works",
    gagFrames: 24,
    celebrateFrames: 20,
    keys: typingKeys,
    gagKeys: [],
    hands: "both",
  },
  confetti: true,
  mood: (ctx) => (ctx.frame.phase === "result" && ctx.frame.run === 1 ? "worried" : ctx.frame.mood),
  look: (ctx, pose) => ({ ...look, mouth: labelRed(ctx) < 0 && pose.mood !== "celebrate" ? pacifier() : undefined }),
  back: (ctx) => chatPanel(ctx) + prettyPage(ctx),
  props: (ctx, pose) => {
    const hand = raisedHand(pose);
    return (
      laptop() +
      bottle() +
      (pose.mood === "celebrate" ? mouseInHand(hand.x, hand.y) : mouseOnDesk()) +
      droppedPacifier(ctx)
    );
  },
  front: (ctx) => draggedBlock(ctx) + pasteBurst(ctx),
};

function hoodUp(): string {
  const ear = (x: number): string =>
    svg`<circle cx="${x}" cy="84" r="16" fill="${palette.hoodie}" stroke="${palette.hoodieDark}" stroke-width="3"/>` +
    svg`<circle cx="${x}" cy="84" r="7" fill="${palette.hoodieDark}"/>`;
  return (
    ear(126) +
    ear(224) +
    svg`<path d="M112 200Q104 74 175 72Q246 74 238 200Q175 216 112 200Z" fill="${palette.hoodie}" stroke="${palette.hoodieDark}" stroke-width="3"/>`
  );
}

function pacifier(): string {
  return (
    svg`<circle cx="175" cy="178" r="7" fill="none" stroke="${ink.orangeDark}" stroke-width="3"/>` +
    svg`<ellipse cx="175" cy="168" rx="15" ry="8" fill="${ink.orange}" stroke="${ink.orangeDark}" stroke-width="2"/>` +
    svg`<circle cx="175" cy="168" r="3" fill="${ink.orangeDark}"/>`
  );
}

function droppedPacifier(ctx: Ctx): string {
  const elapsed = labelRed(ctx);
  if (elapsed < 0) return "";
  const t = progress(elapsed, 6);
  const mouthY = neckY(look) + look.headScale * (168 - 210);
  const x = lerp(175, 72, t);
  const y = lerp(mouthY, 314, t * t);
  const spin = Math.round(t * 200);
  return svg`<g transform="translate(${x} ${y}) rotate(${spin})"><circle cx="0" cy="10" r="7" fill="none" stroke="${ink.orangeDark}" stroke-width="3"/><ellipse cx="0" cy="0" rx="15" ry="8" fill="${ink.orange}" stroke="${ink.orangeDark}" stroke-width="2"/></g>`;
}

function chatPanel(ctx: Ctx): string {
  const fading = ctx.frame.phase === "celebrate" ? 1 - progress(ctx.frame.step - 4, 5) : 1;
  if (fading <= 0 || ctx.frame.phase === "fade") return "";
  const grabbed = ctx.frame.phase === "gag" && ctx.frame.step >= dragStart && ctx.frame.step < landed;
  const body =
    greyLines(chat.x + 8, chat.y + 20, [60, 44]) +
    (grabbed
      ? svg`<rect x="${chat.x + 7}" y="${chat.y + 37}" width="50" height="16" rx="3" fill="none" stroke="${ink.line}" stroke-width="1.5" stroke-dasharray="3 3"/>`
      : greyLines(chat.x + 8, chat.y + 40, [48, 36])) +
    svg`<rect x="${chat.x + 46}" y="${chat.y + 54}" width="32" height="14" rx="6" fill="${palette.green}"/>` +
    text("ok!", chat.x + 51, chat.y + 57, 1.2, palette.terminal);
  return chatWindow(chat.x, chat.y, chat.w, chat.h, body, Math.round(fading * 100) / 100);
}

function draggedBlock(ctx: Ctx): string {
  if (ctx.frame.phase !== "gag") return "";
  const step = ctx.frame.step;
  if (step < dragStart || step >= landed) return "";
  const t = (step - dragStart) / dragLength;
  const x = lerp(chat.x + 36, 150, t);
  const y = lerp(chat.y + 47, 236, t);
  return (
    svg`<g transform="translate(${x} ${y}) rotate(${lerp(0, -8, t)})">` +
    svg`<rect x="-30" y="-15" width="60" height="30" rx="4" fill="${ink.paper}" stroke="${ink.paperEdge}" stroke-width="2"/>` +
    greyLines(-24, -9, [44, 32, 40]) +
    svg`</g>`
  );
}

function pasteBurst(ctx: Ctx): string {
  if (ctx.frame.phase !== "gag" || ctx.frame.step < landed) return "";
  const age = ctx.frame.step - landed;
  return [0, 3, 6]
    .map((offset, n) => {
      const life = age - offset;
      if (life < 0 || life > 6) return "";
      const x = n === 1 ? 244 : 34 + n * 4;
      return text("ctrl+v", x, 262 - life * 8, 1.5, palette.text, Math.round((1 - life / 7) * 100) / 100);
    })
    .join("");
}

function prettyPage(ctx: Ctx): string {
  const elapsed = ctx.frame.phase === "gag" ? ctx.frame.step - landed - 1 : 99;
  const scale = popScale(elapsed);
  if (scale === 0) return "";
  const card =
    svg`<rect x="-46" y="-34" width="92" height="68" rx="9" fill="${ink.paper}" stroke="${ink.paperEdge}" stroke-width="2"/>` +
    svg`<rect x="-40" y="-22" width="80" height="50" rx="5" fill="${palette.note}"/>` +
    svg`<path d="M0 -2c-4 -9 -16 -5 -12 3c2 5 12 11 12 11c0 0 10 -6 12 -11c4 -8 -8 -12 -12 -3z" fill="${ink.pink}"/>` +
    svg`<circle cx="-36" cy="-28" r="2.5" fill="${palette.red}"/><circle cx="-28" cy="-28" r="2.5" fill="${palette.amber}"/>` +
    text("my app", -17, 14, 1.2, palette.noteInk);
  return centered(card, page.x + 46, page.y + 34, scale);
}

function bottle(): string {
  return (
    svg`<rect x="272" y="270" width="8" height="8" rx="3" fill="${ink.orange}"/>` +
    svg`<rect x="266" y="276" width="20" height="8" rx="2" fill="${ink.teal}"/>` +
    svg`<rect x="264" y="283" width="24" height="39" rx="7" fill="${ink.paper}" stroke="${ink.paperEdge}" stroke-width="2"/>` +
    svg`<rect x="266" y="298" width="20" height="22" rx="5" fill="#fff6e0"/>` +
    svg`<path d="M270 292h6M270 302h6M270 312h6" stroke="${ink.line}" stroke-width="2"/>`
  );
}

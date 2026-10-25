import { classicLook, type Look, type Pose, paw, sleeve } from "../monkey.ts";
import { palette } from "../palette.ts";
import { type Ctx, lerp, type Persona, progress, since, typingKeys } from "../persona.ts";
import { laptop, mouseOnDesk, mug } from "../props.ts";
import { svg } from "../svg.ts";
import { text } from "../text.ts";
import { bubble, greyLines, ink } from "./kit.ts";
import { agent, type Agent, agentScale } from "./reins.ts";

const reinHand = { x: 98, y: 300 } as const;
const loop = 8;
const runners = [
  { center: 52, amp: 34, phase: 0 },
  { center: 172, amp: 56, phase: 5 },
  { center: 262, amp: 30, phase: 9 },
] as const;
const edge = 334;
const dash = 4;
const tighten = 3;
const seats = [20, 52, 84] as const;
const greyCoat = { fur: "#8e8a86", furDark: "#6b6763" } as const;
const srMug = text("sr", 270, 303, 1.4, "#ffffff", 0.9);

const escaped = (ctx: Ctx): number => since(ctx, (frame) => frame.phase === "intro");
const seated = (ctx: Ctx): boolean => ctx.frame.phase === "celebrate" || ctx.frame.phase === "fade";

export const senior: Persona = {
  id: "senior",
  script: {
    checks: [
      { label: "front a", fail: "ready", pass: "merged", passesAtRun: 2 },
      { label: "front b", fail: "conflict", pass: "merged c5", passesAtRun: 3 },
      { label: "front c", fail: "dirty wt", pass: "saved, kept", passesAtRun: 2 },
      { label: "lines", fail: "1 } lost", pass: "0 lost", passesAtRun: 4 },
      { label: "report", fail: "1 mismatch", pass: "matches", passesAtRun: 5 },
    ],
    prompt: "$ fm merge verify",
    verdict: "✓ 3 fronts, 0 lost",
    gagFrames: 20,
    celebrateFrames: 16,
    keys: typingKeys,
    gagKeys: typingKeys,
    hands: "right",
  },
  confetti: false,
  mood: (ctx) => (ctx.frame.mood === "worried" ? "typing" : ctx.frame.mood),
  look: (ctx, pose) => seniorLook(ctx, pose),
  back: (ctx) => worktrees(seated(ctx)),
  props: (ctx, pose) =>
    laptop() + (pose.mood === "celebrate" ? "" : mug(ctx.frame.beat, srMug)) + mouseOnDesk(),
  front: (ctx) => team(ctx),
};

function seniorLook(ctx: Ctx, pose: Pose): Look {
  const sipping = pose.mood === "celebrate";
  return {
    ...classicLook,
    ...greyCoat,
    bounce: false,
    headShift: sipping && ctx.frame.step % 8 < 4 ? 3 : 0,
    onHead: greyFur() + readingGlasses(),
    leftArm: sleeve(svg`M122 234Q100 268 ${reinHand.x} ${reinHand.y - 4}`) + paw(reinHand.x, reinHand.y),
    rightArm: sipping ? sip() : undefined,
    mouth: sipping ? calmSmile : undefined,
  };
}

const calmSmile = svg`<path d="M161 164Q175 176 189 164" fill="none" stroke="${palette.eye}" stroke-width="3" stroke-linecap="round"/>`;

function greyFur(): string {
  return (
    svg`<path d="M162 90Q168 74 177 87Q184 72 192 90Z" fill="${ink.grey}"/>` +
    svg`<path d="M124 112Q120 128 126 146Q132 128 140 116Z" fill="${ink.grey}"/>` +
    svg`<path d="M226 112Q230 128 224 146Q218 128 210 116Z" fill="${ink.grey}"/>` +
    svg`<path d="M146 176Q175 214 204 176Q192 196 175 197Q158 196 146 176Z" fill="${ink.grey}"/>` +
    svg`<path d="M150 112L166 109M200 112L184 109" stroke="${ink.grey}" stroke-width="4" stroke-linecap="round"/>`
  );
}

function readingGlasses(): string {
  return (
    svg`<circle cx="160" cy="100" r="10" fill="#ffffff" fill-opacity="0.2" stroke="${palette.eye}" stroke-width="2.5"/>` +
    svg`<circle cx="190" cy="100" r="10" fill="#ffffff" fill-opacity="0.2" stroke="${palette.eye}" stroke-width="2.5"/>` +
    svg`<path d="M170 99Q175 95 180 99" fill="none" stroke="${palette.eye}" stroke-width="2.5"/>`
  );
}

function sip(): string {
  return (
    sleeve(svg`M228 234Q262 226 240 196`) +
    svg`<rect x="228" y="168" width="26" height="28" rx="5" fill="${palette.mug}"/>` +
    svg`<circle cx="255" cy="181" r="7" fill="none" stroke="${palette.mugDark}" stroke-width="4"/>` +
    text("sr", 234, 176, 1.4, "#ffffff", 0.9) +
    paw(238, 196)
  );
}

function worktrees(done: boolean): string {
  return [30, 120, 210]
    .map((x) => {
      const box =
        svg`<rect x="${x}" y="30" width="40" height="28" rx="5" fill="${palette.terminal}" stroke="${palette.terminalEdge}" stroke-width="2"/>` +
        greyLines(x + 6, 38, [18, 26]).replaceAll(ink.line, palette.faint);
      return box + (done ? text("✓", x + 26, 36, 1.2, palette.green) : "");
    })
    .join("");
}

function team(ctx: Ctx): string {
  const agents = runners.map((runner, index) => place(ctx, runner, index));
  const reins = agents.map((one) => rein(one)).join("");
  const shout = escaped(ctx);
  const shouting = shout >= 0 && shout < dash + tighten + 12 && !seated(ctx);
  return (
    reins +
    agents.map((one) => agent(one)).join("") +
    (shouting ? bubble(edge - 118, 252, "reset --hard", 1.4, "right") : "")
  );
}

function place(ctx: Ctx, runner: (typeof runners)[number], index: number): Agent {
  if (seated(ctx)) {
    return { x: seats[index] ?? 26, facing: 1, stride: 0, sitting: true, taut: 0, check: true };
  }
  const step = Math.floor(ctx.index / 2);
  const t = ((step + runner.phase) % loop) / loop;
  const x = Math.round(runner.center + runner.amp * Math.sin(t * Math.PI * 2));
  const facing = Math.cos(t * Math.PI * 2) >= 0 ? 1 : -1;
  const running = { x, facing, stride: step % 2, sitting: false, taut: 0, check: false } as const;
  if (index !== 2) return running;
  const out = escaped(ctx);
  if (out < 0) return running;
  const start = Math.round(runner.center + runner.amp * Math.sin((((Math.floor((ctx.index - out) / 2) + runner.phase) % loop) / loop) * Math.PI * 2));
  const run = progress(out, dash);
  return {
    x: lerp(start, edge, run),
    facing: 1,
    stride: run < 1 ? ctx.index % 2 : 0,
    sitting: false,
    taut: progress(out - dash, tighten),
    check: false,
  };
}

function rein(one: Agent): string {
  const handX = one.x + 11 * agentScale * one.facing;
  const handY = Math.round(334 - (one.sitting ? 8 : 14) * agentScale);
  const sag = lerp(26, 0, one.taut);
  const midX = (reinHand.x + handX) / 2;
  const midY = Math.max(reinHand.y, handY) + sag;
  return svg`<path d="M${reinHand.x + 6} ${reinHand.y}Q${midX} ${midY} ${handX} ${handY}" fill="none" stroke="${palette.text}" stroke-width="2.2" stroke-linecap="round" opacity="0.85"/>`;
}

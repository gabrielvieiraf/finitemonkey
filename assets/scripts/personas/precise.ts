import { classicLook, type Look, paw, raisedHand, sleeve } from "../monkey.ts";
import { palette } from "../palette.ts";
import { type Ctx, isRow, lerp, type Persona, progress, since, typingKeys } from "../persona.ts";
import { laptop, mouseInHand, mouseOnDesk, mug } from "../props.ts";
import { svg } from "../svg.ts";
import { text } from "../text.ts";
import { bubble, ink } from "./kit.ts";

const tickEvery = 4;
const claimAt = 10;
const board = { x: 58, y: 246 } as const;

const reportRed = (ctx: Ctx): number => since(ctx, (frame) => isRow(frame, 4, "fail"));
const settled = (ctx: Ctx): number => since(ctx, (frame) => frame.phase === "verdict");

export const precise: Persona = {
  id: "precise",
  script: {
    checks: [
      { label: "c1-c2", fail: "proof ok", pass: "proof ok", passesAtRun: 1 },
      { label: "c3", fail: "no evidence", pass: "test 14 ok", passesAtRun: 3 },
      { label: "c5", fail: "test edited", pass: "test intact", passesAtRun: 4 },
      { label: "c6-c7", fail: "proof ok", pass: "proof ok", passesAtRun: 1 },
      { label: "report", fail: "2 false", pass: "matches", passesAtRun: 5 },
    ],
    prompt: "$ finitemonkey gate",
    verdict: "✓ 7/7 with proof",
    gagFrames: 18,
    celebrateFrames: 16,
    keys: typingKeys,
    gagKeys: typingKeys,
    hands: "right",
  },
  confetti: true,
  mood: (ctx) => {
    if (ctx.frame.phase === "gag" && ctx.frame.step >= claimAt) return "pleased";
    if (ctx.frame.phase === "result" && ctx.frame.run === 1) return "worried";
    return ctx.frame.mood;
  },
  look: (ctx): Look => ({ ...classicLook, onHead: pencil() + glasses(slide(ctx)), leftArm: clipboardArm(ctx) }),
  back: () => "",
  props: (ctx, pose) => {
    const hand = raisedHand(pose);
    return laptop() + mug(ctx.frame.beat) + (pose.mood === "celebrate" ? mouseInHand(hand.x, hand.y) : mouseOnDesk());
  },
  front: (ctx) =>
    (ctx.frame.phase === "gag" && ctx.frame.step >= claimAt) || ctx.frame.phase === "intro"
      ? bubble(232, 190, "all 7 met ✓", 1.5, "left")
      : "",
};

function slide(ctx: Ctx): number {
  const down = progress(reportRed(ctx), 4);
  const up = progress(settled(ctx), 4);
  return lerp(0, 11, down * (1 - up));
}

function glasses(drop: number): string {
  const y = 133 + drop;
  return (
    svg`<path d="M145 ${y - 2}L124 ${y - 6}M205 ${y - 2}L226 ${y - 6}" stroke="${palette.eye}" stroke-width="2.5" stroke-linecap="round"/>` +
    svg`<circle cx="158" cy="${y}" r="14" fill="#ffffff" fill-opacity="0.18" stroke="${palette.eye}" stroke-width="3"/>` +
    svg`<circle cx="192" cy="${y}" r="14" fill="#ffffff" fill-opacity="0.18" stroke="${palette.eye}" stroke-width="3"/>` +
    svg`<path d="M172 ${y - 2}Q175 ${y - 6} 178 ${y - 2}" fill="none" stroke="${palette.eye}" stroke-width="3"/>`
  );
}

function pencil(): string {
  return (
    svg`<g transform="translate(232 112) rotate(-38)">` +
    svg`<rect x="-20" y="-4" width="34" height="8" fill="${palette.amber}"/>` +
    svg`<rect x="-26" y="-4" width="7" height="8" rx="2" fill="${palette.note}"/>` +
    svg`<path d="M14 -4l9 4l-9 4z" fill="${palette.face}"/><path d="M20 -1.5l3 1.5l-3 1.5z" fill="${palette.eye}"/>` +
    svg`</g>`
  );
}

function clipboardArm(ctx: Ctx): string {
  return sleeve(svg`M122 234Q96 256 ${board.x + 38} ${board.y + 14}`) + clipboard(ctx) + paw(board.x + 38, board.y + 16);
}

function clipboard(ctx: Ctx): string {
  const ticked = ctx.frame.phase === "gag" ? Math.min(5, Math.floor(ctx.frame.step / tickEvery)) : 5;
  const crossed = reportRed(ctx) >= 0 && settled(ctx) < 0;
  const stamped = ctx.frame.phase === "celebrate" || ctx.frame.phase === "fade";
  const rows = Array.from({ length: 5 }, (_, row) => {
    const y = -22 + row * 11;
    const mark =
      row === 4 && crossed
        ? text("✗", -21, y - 1, 1.2, palette.red)
        : row < ticked
          ? text("✓", -21, y - 1, 1.2, palette.green)
          : "";
    return (
      svg`<rect x="-22" y="${y - 2}" width="9" height="9" rx="1.5" fill="none" stroke="${palette.dim}" stroke-width="1.5"/>` +
      mark +
      svg`<rect x="-8" y="${y + 1}" width="${row % 2 === 0 ? 26 : 20}" height="3" rx="1.5" fill="${ink.line}"/>`
    );
  }).join("");
  return (
    svg`<g transform="translate(${board.x} ${board.y}) rotate(-8) scale(1.25)">` +
    svg`<rect x="-30" y="-38" width="60" height="78" rx="5" fill="${palette.deskFront}"/>` +
    svg`<rect x="-26" y="-31" width="52" height="66" rx="2" fill="${ink.paper}"/>` +
    svg`<rect x="-11" y="-42" width="22" height="9" rx="3" fill="${palette.laptopDeck}"/>` +
    rows +
    (stamped
      ? svg`<g transform="rotate(-14)" opacity="0.85"><circle cx="8" cy="8" r="15" fill="none" stroke="${palette.green}" stroke-width="3"/>${text("ok", 2, 5, 1.4, palette.green)}</g>`
      : "") +
    svg`</g>`
  );
}

import type { Look, Pose } from "./monkey.ts";
import type { Frame, Mood, Script } from "./timeline.ts";

export interface Ctx {
  readonly frames: readonly Frame[];
  readonly index: number;
  readonly frame: Frame;
}

export interface Persona {
  readonly id: string;
  readonly script: Script;
  readonly confetti: boolean;
  readonly mood: (ctx: Ctx) => Mood;
  readonly look: (ctx: Ctx, pose: Pose) => Look;
  readonly back: (ctx: Ctx, pose: Pose) => string;
  readonly props: (ctx: Ctx, pose: Pose) => string;
  readonly front: (ctx: Ctx, pose: Pose) => string;
}

export const typingKeys: readonly string[] = Array.from("asdfjklqwe!?#$*");

export function since(ctx: Ctx, test: (frame: Frame) => boolean): number {
  const first = ctx.frames.findIndex(test);
  return first < 0 || first > ctx.index ? -1 : ctx.index - first;
}

export function isRow(frame: Frame, row: number, kind: "fail" | "pass"): boolean {
  return frame.rows[row]?.kind === kind;
}

export function progress(elapsed: number, length: number): number {
  if (elapsed < 0) return 0;
  return Math.min(1, elapsed / length);
}

export function lerp(from: number, to: number, t: number): number {
  return Math.round((from + (to - from) * t) * 10) / 10;
}

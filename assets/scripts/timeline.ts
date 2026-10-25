import { checks, prompt, verdict } from "./checks.ts";
import { pick, seeded, type Random } from "./random.ts";
import { scramble } from "./glyphs.ts";

export type Mood = "typing" | "worried" | "pleased" | "celebrate";

export type Row =
  | { readonly kind: "hidden" }
  | { readonly kind: "rolling"; readonly noise: string; readonly spinner: string }
  | { readonly kind: "fail" }
  | { readonly kind: "pass"; readonly fresh: boolean };

export interface Particle {
  readonly char: string;
  readonly x: number;
  readonly y: number;
  readonly opacity: number;
}

export interface Frame {
  readonly prompt: string;
  readonly cursor: boolean;
  readonly run: number;
  readonly rows: readonly Row[];
  readonly locked: number;
  readonly verdict: string;
  readonly badge: number;
  readonly mood: Mood;
  readonly beat: number;
  readonly particles: readonly Particle[];
  readonly fade: number;
}

const rollingFrames = 5;
const resultFrames = 8;
const celebrateFrames = 26;
const fadeFrames = 5;
const spinner = ["|", "/", "-", "\\"] as const;
const particleLife = 7;

interface Spawn {
  readonly char: string;
  readonly x: number;
  readonly born: number;
  readonly drift: number;
}

export function buildTimeline(seed: number): readonly Frame[] {
  const random = seeded(seed);
  const frames: Omit<Frame, "particles" | "beat">[] = [];
  const runs = Math.max(...checks.map((check) => check.passesAtRun));
  const hiddenRows: readonly Row[] = checks.map(() => ({ kind: "hidden" }));

  const base = { cursor: false, run: 0, rows: hiddenRows, locked: 0, verdict: "", badge: 0, mood: "typing" as Mood, fade: 1 };

  for (let typed = 0; typed <= prompt.length; typed += 3) {
    frames.push({ ...base, prompt: prompt.slice(0, typed), cursor: true });
  }
  frames.push({ ...base, prompt, cursor: true });

  for (let run = 1; run <= runs; run += 1) {
    const lockedBefore = checks.filter((check) => check.passesAtRun < run).length;
    for (let step = 0; step < rollingFrames; step += 1) {
      const rows = checks.map((check): Row =>
        check.passesAtRun < run
          ? { kind: "pass", fresh: false }
          : { kind: "rolling", noise: noise(random, check.fail.length), spinner: spinner[(step + run) % spinner.length] ?? "|" },
      );
      frames.push({ ...base, prompt, run, rows, locked: lockedBefore });
    }
    const passedNow = checks.filter((check) => check.passesAtRun === run).length;
    for (let step = 0; step < resultFrames; step += 1) {
      const rows = checks.map((check): Row => {
        if (check.passesAtRun < run) return { kind: "pass", fresh: false };
        if (check.passesAtRun === run) return { kind: "pass", fresh: step < 3 };
        return { kind: "fail" };
      });
      const mood: Mood = passedNow > 0 ? "pleased" : "worried";
      frames.push({ ...base, prompt, run, rows, locked: lockedBefore + passedNow, mood });
    }
  }

  const allPassed: readonly Row[] = checks.map(() => ({ kind: "pass", fresh: false }));
  const finale = { ...base, prompt, run: runs, rows: allPassed, locked: checks.length };
  const revealSteps = Math.ceil(verdict.length / 3);
  for (let step = 1; step <= revealSteps; step += 1) {
    frames.push({ ...finale, verdict: verdict.slice(0, step * 3), mood: "pleased" });
  }
  const pop = [0.4, 0.85, 1.15, 1.05, 1];
  for (let step = 0; step < celebrateFrames; step += 1) {
    frames.push({ ...finale, verdict, badge: pop[step] ?? 1, mood: "celebrate" });
  }
  for (let step = 1; step <= fadeFrames; step += 1) {
    frames.push({ ...finale, verdict, badge: 1, fade: 1 - step / fadeFrames, mood: "typing" });
  }

  const spawns = spawnParticles(random, frames);
  return frames.map((frame, index) => ({
    ...frame,
    beat: index,
    particles: particlesAt(spawns, index),
  }));
}

function noise(random: Random, length: number): string {
  return Array.from({ length }, () => pick(random, [...scramble])).join("");
}

function spawnParticles(random: Random, frames: readonly Omit<Frame, "particles" | "beat">[]): readonly Spawn[] {
  const spawns: Spawn[] = [];
  frames.forEach((frame, index) => {
    const mashing = frame.mood === "typing" && frame.fade === 1;
    if (!mashing) return;
    const count = random() < 0.5 ? 1 : 2;
    for (let n = 0; n < count; n += 1) {
      const left = random() < 0.5;
      spawns.push({
        char: pick(random, [..."asdfjklqwe!?#$*"]),
        x: left ? 96 + random() * 26 : 228 + random() * 26,
        born: index,
        drift: (left ? -1 : 1) * (0.6 + random() * 1.4),
      });
    }
  });
  return spawns;
}

function particlesAt(spawns: readonly Spawn[], index: number): readonly Particle[] {
  return spawns
    .filter((spawn) => index >= spawn.born && index < spawn.born + particleLife)
    .map((spawn) => {
      const age = index - spawn.born;
      return {
        char: spawn.char,
        x: spawn.x + spawn.drift * age * 3,
        y: 262 - age * 7,
        opacity: 1 - age / particleLife,
      };
    });
}

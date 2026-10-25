import type { Check } from "./checks.ts";
import { scramble } from "./glyphs.ts";
import { pick, type Random, seeded } from "./random.ts";

export type Mood = "typing" | "worried" | "pleased" | "celebrate";

export type Phase = "gag" | "intro" | "rolling" | "result" | "verdict" | "celebrate" | "fade";

export interface Script {
  readonly checks: readonly Check[];
  readonly prompt: string;
  readonly verdict: string;
  readonly gagFrames: number;
  readonly celebrateFrames: number;
  readonly keys: readonly string[];
  readonly gagKeys: readonly string[];
  readonly hands: "both" | "right";
}

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
  readonly phase: Phase;
  readonly step: number;
}

const rollingFrames = 5;
const resultFrames = 8;
const fadeFrames = 5;
const spinner = ["|", "/", "-", "\\"] as const;
const particleLife = 7;

interface Spawn {
  readonly char: string;
  readonly x: number;
  readonly born: number;
  readonly drift: number;
}

type Still = Omit<Frame, "particles" | "beat">;

export function buildTimeline(seed: number, script: Script): readonly Frame[] {
  const random = seeded(seed);
  const runs = Math.max(...script.checks.map((check) => check.passesAtRun));
  const base: Still = {
    prompt: "",
    cursor: false,
    run: 0,
    rows: script.checks.map((): Row => ({ kind: "hidden" })),
    locked: 0,
    verdict: "",
    badge: 0,
    mood: "typing",
    fade: 1,
    phase: "intro",
    step: 0,
  };
  const frames: Still[] = [...gag(base, script), ...intro(base, script.prompt)];
  for (let run = 1; run <= runs; run += 1) {
    frames.push(...rolling(base, script, random, run), ...results(base, script, run));
  }
  frames.push(...finale(base, script, runs));
  const spawns = spawnParticles(random, frames, script);
  return frames.map((frame, index) => ({
    ...frame,
    beat: index,
    particles: particlesAt(spawns, index),
  }));
}

function gag(base: Still, script: Script): readonly Still[] {
  return Array.from({ length: script.gagFrames }, (_, step): Still => ({ ...base, cursor: true, phase: "gag", step }));
}

function intro(base: Still, prompt: string): readonly Still[] {
  const frames: Still[] = [];
  for (let typed = 0; typed <= prompt.length; typed += 3) {
    frames.push({ ...base, prompt: prompt.slice(0, typed), cursor: true, step: frames.length });
  }
  frames.push({ ...base, prompt, cursor: true, step: frames.length });
  return frames;
}

function rolling(base: Still, script: Script, random: Random, run: number): readonly Still[] {
  const { checks, prompt } = script;
  const locked = checks.filter((check) => check.passesAtRun < run).length;
  const frames: Still[] = [];
  for (let step = 0; step < rollingFrames; step += 1) {
    const rows = checks.map((check): Row =>
      check.passesAtRun < run
        ? { kind: "pass", fresh: false }
        : {
            kind: "rolling",
            noise: noise(random, check.fail.length),
            spinner: spinner[(step + run) % spinner.length] ?? "|",
          },
    );
    frames.push({ ...base, prompt, run, rows, locked, phase: "rolling", step });
  }
  return frames;
}

function results(base: Still, script: Script, run: number): readonly Still[] {
  const { checks, prompt } = script;
  const lockedBefore = checks.filter((check) => check.passesAtRun < run).length;
  const passedNow = checks.filter((check) => check.passesAtRun === run).length;
  const mood: Mood = passedNow > 0 ? "pleased" : "worried";
  const frames: Still[] = [];
  for (let step = 0; step < resultFrames; step += 1) {
    const rows = checks.map((check): Row => {
      if (check.passesAtRun < run) return { kind: "pass", fresh: false };
      if (check.passesAtRun === run) return { kind: "pass", fresh: step < 3 };
      return { kind: "fail" };
    });
    frames.push({ ...base, prompt, run, rows, locked: lockedBefore + passedNow, mood, phase: "result", step });
  }
  return frames;
}

function finale(base: Still, script: Script, runs: number): readonly Still[] {
  const { checks, prompt, verdict } = script;
  const done: Still = {
    ...base,
    prompt,
    run: runs,
    rows: checks.map((): Row => ({ kind: "pass", fresh: false })),
    locked: checks.length,
  };
  const frames: Still[] = [];
  const revealSteps = Math.ceil(verdict.length / 3);
  for (let step = 1; step <= revealSteps; step += 1) {
    frames.push({ ...done, verdict: verdict.slice(0, step * 3), mood: "pleased", phase: "verdict", step });
  }
  const pop = [0.4, 0.85, 1.15, 1.05, 1];
  for (let step = 0; step < script.celebrateFrames; step += 1) {
    frames.push({ ...done, verdict, badge: pop[step] ?? 1, mood: "celebrate", phase: "celebrate", step });
  }
  for (let step = 1; step <= fadeFrames; step += 1) {
    frames.push({ ...done, verdict, badge: 1, fade: 1 - step / fadeFrames, mood: "typing", phase: "fade", step });
  }
  return frames;
}

function noise(random: Random, length: number): string {
  return Array.from({ length }, () => pick(random, Array.from(scramble))).join("");
}

function spawnParticles(random: Random, frames: readonly Still[], script: Script): readonly Spawn[] {
  const spawns: Spawn[] = [];
  frames.forEach((frame, index) => {
    const keys = frame.phase === "gag" ? script.gagKeys : script.keys;
    const mashing = frame.mood === "typing" && frame.fade === 1 && keys.length > 0;
    if (!mashing) return;
    const count = random() < 0.5 ? 1 : 2;
    for (let n = 0; n < count; n += 1) {
      const left = random() < 0.5 && script.hands === "both";
      spawns.push({
        char: pick(random, keys),
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

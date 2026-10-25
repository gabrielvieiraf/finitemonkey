import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Persona } from "./persona.ts";
import { classic } from "./personas/classic.ts";
import { personas } from "./personas/index.ts";

export interface Target {
  readonly persona: Persona;
  readonly output: string;
}

const assets = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const main: Target = { persona: classic, output: resolve(assets, "finitemonkey.gif") };

export const personaTargets: readonly Target[] = personas.map((persona) => ({
  persona,
  output: resolve(assets, "personas", `${persona.id}.gif`),
}));

export function selectTargets(args: readonly string[]): readonly Target[] {
  if (args.includes("--all")) return [main, ...personaTargets];
  const flag = args.indexOf("--persona");
  if (flag < 0) return [main];
  const id = args[flag + 1];
  const target = personaTargets.find((candidate) => candidate.persona.id === id);
  if (target === undefined) {
    const known = personaTargets.map((candidate) => candidate.persona.id).join(", ");
    throw new Error(`unknown persona ${id ?? ""}; known: ${known}`);
  }
  return [target];
}

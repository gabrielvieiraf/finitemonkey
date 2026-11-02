import { createHash } from "node:crypto";
import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { isRecord, type JsonObject, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";

export const MCP_PINS_FILE = "mcp-pins.json";

export interface ToolDescription {
  readonly name: string;
  readonly description: string;
}

export interface Pin {
  readonly hash: string;
  readonly pinnedAt: string;
  readonly changed?: { readonly hash: string; readonly at: string };
}

export type Pins = Readonly<Record<string, Pin>>;

export interface PinReport {
  readonly added: readonly string[];
  readonly changed: readonly string[];
  readonly pending: readonly string[];
}

const pinsPath = (paths: FmPaths) => toAbsolutePath(join(paths.dir, MCP_PINS_FILE));

export const descriptionHash = (description: string): string =>
  createHash("sha256").update(description, "utf8").digest("hex").slice(0, 16);

const pinOf = (value: unknown): Pin | undefined => {
  if (!isRecord(value) || typeof value["hash"] !== "string" || typeof value["pinnedAt"] !== "string") return undefined;
  const changed = value["changed"];
  const base = { hash: value["hash"], pinnedAt: value["pinnedAt"] };
  return isRecord(changed) && typeof changed["hash"] === "string" && typeof changed["at"] === "string"
    ? { ...base, changed: { hash: changed["hash"], at: changed["at"] } }
    : base;
};

export const readPins = (runtime: Pick<Runtime, "readText">, paths: FmPaths): Pins => {
  const text = runtime.readText(pinsPath(paths));
  const parsed = text.ok ? parseJsonObject(text.value) : undefined;
  const tools: JsonObject = parsed?.ok === true && isRecord(parsed.value["tools"]) ? parsed.value["tools"] : {};
  return Object.fromEntries(
    Object.entries(tools).flatMap(([name, value]) => {
      const pin = pinOf(value);
      return pin === undefined ? [] : [[name, pin]];
    }),
  );
};

const writePins = (runtime: Pick<Runtime, "writeText" | "mkdir">, paths: FmPaths, pins: Pins): void => {
  runtime.mkdir(paths.dir);
  runtime.writeText(pinsPath(paths), `${JSON.stringify({ tools: pins }, null, 2)}\n`);
};

const nextPin = (pin: Pin | undefined, hash: string, now: string): Pin => {
  if (pin === undefined) return { hash, pinnedAt: now };
  if (pin.hash === hash) return { hash: pin.hash, pinnedAt: pin.pinnedAt };
  return pin.changed?.hash === hash ? pin : { ...pin, changed: { hash, at: now } };
};

export const pinTools = (
  runtime: Pick<Runtime, "readText" | "writeText" | "mkdir" | "now">,
  paths: FmPaths,
  tools: readonly ToolDescription[],
): PinReport => {
  const before = readPins(runtime, paths);
  const now = runtime.now();
  const after: Record<string, Pin> = { ...before };
  for (const tool of tools) after[tool.name] = nextPin(before[tool.name], descriptionHash(tool.description), now);
  writePins(runtime, paths, after);
  const names = tools.map((tool) => tool.name);
  return {
    added: names.filter((name) => before[name] === undefined),
    changed: names.filter((name) => {
      const hash = after[name]?.changed?.hash;
      return hash !== undefined && hash !== before[name]?.changed?.hash;
    }),
    pending: Object.keys(after)
      .filter((name) => after[name]?.changed !== undefined)
      .sort(),
  };
};

export const changedSince = (runtime: Pick<Runtime, "readText">, paths: FmPaths, tool: string): Pin | undefined => {
  const pin = readPins(runtime, paths)[tool];
  return pin?.changed === undefined ? undefined : pin;
};

export const confirmTool = (
  runtime: Pick<Runtime, "readText" | "writeText" | "mkdir" | "now">,
  paths: FmPaths,
  tool: string,
): boolean => {
  const pins = readPins(runtime, paths);
  const pin = pins[tool];
  if (pin?.changed === undefined) return false;
  writePins(runtime, paths, { ...pins, [tool]: { hash: pin.changed.hash, pinnedAt: runtime.now() } });
  return true;
};

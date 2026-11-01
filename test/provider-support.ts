import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../src/core/brand.js";
import type { ExecRequest, ExecResult, Runtime } from "../src/core/runtime.js";
import type { ProviderDeps } from "../src/provider/call.js";
import type { ProviderKind } from "../src/provider/kinds.js";
import { PROVIDER_SCHEMA } from "../src/provider/store.js";
import { type FmPaths, fmPaths } from "../src/task/paths.js";
import { type MemoryFs, memoryFs } from "./memory-fs.js";
import { execResult, fakeRuntime } from "./support.js";

export const PROJECT = toAbsolutePath("/home/ana/project");
export const NOW = "2026-11-01T12:00:00.000Z";

export const envelope = (result: string, usd = 0.01): string =>
  JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 1200,
    num_turns: 1,
    result,
    total_cost_usd: usd,
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 0 },
    modelUsage: { "claude-sonnet-4-5": {} },
  });

export const providerJson = (kinds: readonly ProviderKind[]): string =>
  `${JSON.stringify({
    schemaVersion: 1,
    schema: PROVIDER_SCHEMA,
    kinds: Object.fromEntries(kinds.map((kind) => [kind, { at: NOW, by: "Ana" }])),
  })}\n`;

export interface FakeClaude {
  readonly answer: (request: ExecRequest) => string;
  readonly usd?: number;
}

export const claudeExec =
  (calls: ExecRequest[], fake: FakeClaude | undefined) =>
  (request: ExecRequest): ExecResult | undefined => {
    if (request.command !== "claude") return undefined;
    calls.push(request);
    return fake === undefined
      ? execResult(1, "", "no fake claude")
      : execResult(0, envelope(fake.answer(request), fake.usd));
  };

export interface WorldOptions {
  readonly kinds?: readonly ProviderKind[];
  readonly fake?: FakeClaude;
  readonly mode?: "active" | "shadow" | "off";
  readonly cap?: string;
  readonly files?: Readonly<Record<string, string>>;
  readonly env?: Readonly<Record<string, string>>;
}

export interface World {
  readonly fs: MemoryFs;
  readonly runtime: Runtime;
  readonly paths: FmPaths;
  readonly calls: ExecRequest[];
  readonly spawned: string[][];
  readonly deps: ProviderDeps;
}

const at = (relative: string): AbsolutePath => toAbsolutePath(join(PROJECT, relative));

const policyOf = (options: WorldOptions): string =>
  [
    ...(options.mode === undefined ? [] : ["guards:", `  model-provider: ${options.mode}`]),
    ...(options.cap === undefined ? [] : ["providers:", `  maxUsdPerDay: ${options.cap}`]),
    "",
  ].join("\n");

export const world = (options: WorldOptions = {}): World => {
  const files: Record<string, string> = { [at(".finitemonkey/policy.yml")]: policyOf(options) };
  if (options.kinds !== undefined) files[at(".finitemonkey/provider.json")] = providerJson(options.kinds);
  for (const [path, text] of Object.entries(options.files ?? {})) files[at(path)] = text;
  const fs = memoryFs(files, [at(".git"), at(".finitemonkey"), at(".finitemonkey/cache")], NOW);
  const calls: ExecRequest[] = [];
  const spawned: string[][] = [];
  const runtime = fakeRuntime({ fs, spawned, exec: claudeExec(calls, options.fake) });
  const paths = fmPaths(PROJECT);
  return { fs, runtime, paths, calls, spawned, deps: { runtime, paths, env: options.env ?? {} } };
};

export const answer =
  (value: unknown): FakeClaude["answer"] =>
  () =>
    JSON.stringify(value);

export const MALFORMED: FakeClaude = { answer: () => "Sure! Here is what I found: {not json" };

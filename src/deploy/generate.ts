import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import type { WantedFile } from "../infra/plan-files.js";
import type { Inventory } from "../infra/types.js";
import { detectChecks, type ProjectFiles } from "../task/implicit.js";
import {
  COMPOSE_PATH,
  composeFile,
  deployWorkflow,
  DRIFT_PATH,
  driftWorkflow,
  REMOTE_PATH,
  remoteScript,
  WORKFLOW_PATH,
} from "./templates.js";

export interface GenerateOptions {
  readonly branch: string;
  readonly port: number;
  readonly health: string;
  readonly check: string | undefined;
  readonly version: string;
}

export type GenerateBlock = "level" | "no_dockerfile" | "no_check";

export type GeneratePlan =
  | { readonly ok: true; readonly files: readonly WantedFile[]; readonly checks: readonly string[] }
  | { readonly ok: false; readonly block: GenerateBlock };

const INSTALL: readonly (readonly [string, string])[] = [
  ["pnpm-lock.yaml", "corepack enable && pnpm install --frozen-lockfile"],
  ["yarn.lock", "corepack enable && yarn install --immutable"],
  ["package-lock.json", "npm ci"],
  ["package.json", "npm install"],
];

export const projectFiles = (runtime: Pick<Runtime, "readText" | "stat">, root: AbsolutePath): ProjectFiles => ({
  read: (relative) => {
    const text = runtime.readText(toAbsolutePath(join(root, relative)));
    return text.ok ? text.value : undefined;
  },
  exists: (relative) => runtime.stat(toAbsolutePath(join(root, relative))) !== undefined,
});

export const planGenerate = (
  files: ProjectFiles,
  level: number,
  inventory: Inventory,
  options: GenerateOptions,
): GeneratePlan => {
  if (level !== 1) return { ok: false, block: "level" };
  if (!inventory.hits.some((hit) => hit.pattern === "dockerfile")) return { ok: false, block: "no_dockerfile" };
  const checks =
    options.check === undefined ? detectChecks(files).flatMap((check) => check.run ?? []) : [options.check];
  if (checks.length === 0) return { ok: false, block: "no_check" };
  const node = files.exists("package.json");
  const install = node ? INSTALL.find(([file]) => files.exists(file))?.[1] : undefined;
  const input = { branch: options.branch, checks, node, install, port: options.port, health: options.health };
  return {
    ok: true,
    checks,
    files: [
      { path: WORKFLOW_PATH, text: deployWorkflow(input) },
      { path: REMOTE_PATH, text: remoteScript() },
      { path: COMPOSE_PATH, text: composeFile(options.port) },
      { path: DRIFT_PATH, text: driftWorkflow(options.branch, options.version) },
    ],
  };
};

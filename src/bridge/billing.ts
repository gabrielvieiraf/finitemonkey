import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Env } from "../core/context.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { configAt, loadProjectConfig } from "../git/project-config.js";

export const BILLING_MODES = ["api", "subscription"] as const;

export type BillingMode = (typeof BILLING_MODES)[number];

export const API_BILLING_ENV = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
] as const;

type Reader = Pick<Runtime, "readText" | "homeDir">;

const isBilling = (value: unknown): value is BillingMode =>
  typeof value === "string" && (BILLING_MODES as readonly string[]).includes(value);

const settingsFiles = (runtime: Reader, root: AbsolutePath, env: Env): readonly string[] => [
  join(root, ".claude", "settings.local.json"),
  join(root, ".claude", "settings.json"),
  join(env["CLAUDE_CONFIG_DIR"] ?? join(runtime.homeDir(), ".claude"), "settings.json"),
];

const hasKeyHelper = (runtime: Reader, path: string): boolean => {
  const text = runtime.readText(toAbsolutePath(path));
  if (!text.ok) return false;
  const parsed = parseJsonObject(text.value);
  const helper = parsed.ok && isRecord(parsed.value) ? parsed.value["apiKeyHelper"] : undefined;
  return typeof helper === "string" && helper.trim() !== "";
};

export const billingOf = (runtime: Runtime, root: AbsolutePath, env: Env): BillingMode => {
  const chosen = configAt(loadProjectConfig(runtime, root), "billing");
  if (isBilling(chosen)) return chosen;
  if (API_BILLING_ENV.some((name) => (env[name] ?? "").trim() !== "")) return "api";
  return settingsFiles(runtime, root, env).some((path) => hasKeyHelper(runtime, path)) ? "api" : "subscription";
};

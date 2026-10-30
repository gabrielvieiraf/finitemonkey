import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { withEvolved } from "./evolved.js";
import { DEFAULT_POLICY, parsePolicy, parseUserPolicy, type Policy, POLICY_FILE } from "./policy.js";

export const policyPath = (root: AbsolutePath): AbsolutePath => toAbsolutePath(join(root, POLICY_FILE));

export const userPolicyPath = (home: string): AbsolutePath => toAbsolutePath(join(home, ".finitemonkey", "policy.yml"));

export type PolicyRuntime = Pick<Runtime, "readText" | "homeDir">;

export const loadBasePolicy = (runtime: PolicyRuntime, root: AbsolutePath): Policy => {
  const text = runtime.readText(policyPath(root));
  const project = text.ok ? parsePolicy(text.value) : DEFAULT_POLICY;
  const userText = runtime.readText(userPolicyPath(runtime.homeDir()));
  if (!userText.ok) return project;
  const user = parseUserPolicy(userText.value);
  return { ...project, userGuards: user.userGuards, issues: [...project.issues, ...user.issues] };
};

export const loadPolicy = (runtime: PolicyRuntime, root: AbsolutePath): Policy =>
  withEvolved(runtime, root, loadBasePolicy(runtime, root));

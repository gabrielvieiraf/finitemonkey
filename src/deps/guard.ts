import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { nowMs } from "../core/clock.js";
import { isRecord, optionalString, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { guardRoot, SHELL_TOOLS } from "../guards/context.js";
import type { HookDecision, HookHandler, HookInput } from "../hooks/handlers.js";
import type { Translate } from "../i18n/translate.js";
import { toolInput, toolName } from "../secrets/guards/tool-input.js";
import { dialectOf } from "../shell/normalize.js";
import { assessPackage, type DepsFinding, MIN_VERSION_AGE_DAYS } from "./assess.js";
import { packagesInCommand, type RequestedPackage } from "./install-command.js";
import { type Lookup, lookupOf, REGISTRY_HOSTS, registryRequest } from "./registry.js";

export const NETWORK_BUDGET_MS = 2000;
export const MAX_PACKAGES = 5;
const MIN_REQUEST_MS = 500;

const ALLOW: HookDecision = { kind: "allow" };
const NPM_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;
const PYTHON_MANIFESTS = ["pyproject.toml", "requirements.txt", "requirements-dev.txt", "Pipfile"] as const;

const npmDeclared = (runtime: Runtime, root: AbsolutePath): ReadonlySet<string> => {
  const text = runtime.readText(toAbsolutePath("package.json", root));
  const parsed = text.ok ? parseJsonObject(text.value) : undefined;
  if (parsed?.ok !== true) return new Set();
  return new Set(
    NPM_SECTIONS.flatMap((section) => {
      const value = parsed.value[section];
      return isRecord(value) ? Object.keys(value) : [];
    }),
  );
};

const pythonText = (runtime: Runtime, root: AbsolutePath): string =>
  PYTHON_MANIFESTS.map((file) => {
    const text = runtime.readText(toAbsolutePath(file, root));
    return text.ok ? text.value.toLowerCase() : "";
  }).join("\n");

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const newPackages = (input: HookInput, packages: readonly RequestedPackage[]): readonly RequestedPackage[] => {
  const root = guardRoot(input);
  const npm = npmDeclared(input.runtime, root);
  const python = packages.some((pkg) => pkg.ecosystem === "pypi") ? pythonText(input.runtime, root) : "";
  return packages.filter((pkg) =>
    pkg.ecosystem === "npm"
      ? !npm.has(pkg.name)
      : !new RegExp(`(^|[\\s"'\\[])${escape(pkg.name).replace(/-/g, "[-_.]")}($|[\\s"'=<>~!\\[;,])`, "m").test(python),
  );
};

const lookup = (input: HookInput, pkg: RequestedPackage, deadline: number, offline: boolean): Lookup => {
  const remaining = deadline - Date.now();
  if (offline || remaining < MIN_REQUEST_MS) return { kind: "unreachable" };
  return lookupOf(pkg, input.runtime.exec(registryRequest(pkg, input.cwd, remaining)));
};

const describe = (t: Translate, finding: DepsFinding): string => {
  switch (finding.kind) {
    case "missing":
      return t("deps.finding.missing", { name: finding.name, registry: REGISTRY_HOSTS[finding.ecosystem] });
    case "typo":
      return t("deps.finding.typo", { name: finding.name, popular: finding.popular });
    case "young":
      return t("deps.finding.young", { name: finding.name, days: finding.days, count: finding.count });
    case "fresh":
      return t("deps.finding.fresh", {
        name: finding.name,
        version: finding.version,
        hours: finding.hours,
        days: MIN_VERSION_AGE_DAYS,
      });
    case "script":
      return t("deps.finding.script", { name: finding.name, version: finding.version });
    case "unchecked":
      return t("deps.finding.unchecked", { name: finding.name, registry: REGISTRY_HOSTS[finding.ecosystem] });
  }
};

export const isOffline = (env: HookInput["env"]): boolean => {
  const value = env["FINITEMONKEY_OFFLINE"];
  return value !== undefined && value !== "" && value !== "0";
};

export const depsGuard: HookHandler = (input) => {
  const tool = toolName(input.payload);
  if (!SHELL_TOOLS.has(tool)) return ALLOW;
  const command = optionalString(toolInput(input.payload), "command") ?? "";
  const packages = newPackages(input, packagesInCommand(command, dialectOf(tool))).slice(0, MAX_PACKAGES);
  if (packages.length === 0) return ALLOW;
  const deadline = Date.now() + NETWORK_BUDGET_MS;
  const offline = isOffline(input.env);
  const now = nowMs(input.runtime);
  const findings = packages.flatMap((pkg) => assessPackage(pkg, lookup(input, pkg, deadline, offline), now));
  if (findings.length === 0) return ALLOW;
  const lines = findings.map((finding) => `- ${describe(input.t, finding)}`);
  const additionalContext = `finitemonkey: ${input.t("deps.warn.header")}\n${lines.join("\n")}`;
  return {
    kind: "allow",
    output: {
      hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext },
      systemMessage: `finitemonkey: ${input.t("deps.warn.human", { count: findings.length })}`,
    },
  };
};

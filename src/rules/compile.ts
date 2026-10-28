import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { accept, type Parsed, reject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { DEFAULT_STYLE, parseSettings, renderJson, styleOf } from "../install/json-text.js";
import { AGENTS_FILE, SETTINGS_FILE } from "../install/layout.js";
import { type Manifest, MANIFEST_FILE, readManifest, writeManifest } from "./manifest.js";
import {
  withCompiledSettings,
  withoutCompiledSettings,
  withoutRulesBlock,
  withRulesBlock,
  WORKFLOW_FILE,
  workflowText,
} from "./outputs.js";
import { compiledRule } from "./plan.js";
import type { ProjectRule } from "./types.js";

type FsRuntime = Pick<Runtime, "readText" | "writeText" | "mkdir" | "remove">;

export interface CompileOptions {
  readonly ci: boolean;
  readonly version: string;
}

const read = (runtime: FsRuntime, root: AbsolutePath, file: string): string | undefined => {
  const text = runtime.readText(toAbsolutePath(file, root));
  return text.ok ? text.value : undefined;
};

const write = (runtime: FsRuntime, root: AbsolutePath, file: string, text: string): Parsed<string> => {
  const slash = file.lastIndexOf("/");
  if (slash > 0) runtime.mkdir(toAbsolutePath(file.slice(0, slash), root));
  const done = runtime.writeText(toAbsolutePath(file, root), text);
  return done.ok ? accept(file) : reject(`${file}: ${done.error}`);
};

const settingsText = (
  runtime: FsRuntime,
  root: AbsolutePath,
  change: (settings: Parameters<typeof withCompiledSettings>[0]) => Parameters<typeof withCompiledSettings>[0],
): Parsed<string> => {
  const current = read(runtime, root, SETTINGS_FILE);
  const parsed = parseSettings(current);
  if (!parsed.ok) return reject(`${SETTINGS_FILE}: ${parsed.error}`);
  return accept(renderJson(change(parsed.value), current === undefined ? DEFAULT_STYLE : styleOf(current)));
};

export const compileRules = (
  runtime: FsRuntime,
  root: AbsolutePath,
  rules: readonly ProjectRule[],
  options: CompileOptions,
): Parsed<{ readonly manifest: Manifest; readonly written: readonly string[] }> => {
  const previous = readManifest(runtime, root);
  const ci = options.ci || previous.workflow !== undefined;
  const manifest: Manifest = {
    schemaVersion: 1,
    rules: Object.fromEntries(rules.map((rule) => [rule.id, compiledRule(rule, ci)])),
    presenceHook: true,
    workflow: ci ? WORKFLOW_FILE : undefined,
  };
  const settings = settingsText(runtime, root, (value) => withCompiledSettings(value, previous, manifest));
  if (!settings.ok) return settings;
  const steps = [
    write(runtime, root, SETTINGS_FILE, settings.value),
    write(runtime, root, AGENTS_FILE, withRulesBlock(read(runtime, root, AGENTS_FILE), rules)),
    ...(ci ? [write(runtime, root, WORKFLOW_FILE, workflowText(rules, options.version))] : []),
  ];
  for (const step of steps) if (!step.ok) return step;
  const saved = writeManifest(runtime, root, manifest);
  if (!saved.ok) return reject(`${MANIFEST_FILE}: ${saved.error}`);
  return accept({ manifest, written: [...steps.flatMap((step) => (step.ok ? [step.value] : [])), MANIFEST_FILE] });
};

export const removeCompiled = (runtime: FsRuntime, root: AbsolutePath): Parsed<readonly string[]> => {
  const manifest = readManifest(runtime, root);
  if (read(runtime, root, MANIFEST_FILE) === undefined) return accept([]);
  const touched: string[] = [];
  const settings = read(runtime, root, SETTINGS_FILE);
  if (settings !== undefined) {
    const text = settingsText(runtime, root, (value) => withoutCompiledSettings(value, manifest));
    if (!text.ok) return text;
    if (text.value !== settings) touched.push(SETTINGS_FILE);
    write(runtime, root, SETTINGS_FILE, text.value);
  }
  const agents = read(runtime, root, AGENTS_FILE);
  if (agents !== undefined) {
    const text = withoutRulesBlock(agents);
    if (text !== agents) {
      touched.push(AGENTS_FILE);
      if (text.trim() === "") runtime.remove(toAbsolutePath(AGENTS_FILE, root));
      else write(runtime, root, AGENTS_FILE, text);
    }
  }
  if (manifest.workflow !== undefined && read(runtime, root, manifest.workflow) !== undefined) {
    runtime.remove(toAbsolutePath(manifest.workflow, root));
    touched.push(manifest.workflow);
  }
  runtime.remove(toAbsolutePath(MANIFEST_FILE, root));
  return accept([...touched, MANIFEST_FILE]);
};

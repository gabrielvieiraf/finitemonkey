import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { accept, type Parsed, reject } from "../core/parsed.js";
import { DEFAULT_STYLE, parseSettings, renderJson, styleOf } from "../install/json-text.js";
import { AGENTS_FILE, SETTINGS_FILE } from "../install/layout.js";
import { withManagedBlock } from "../install/managed-block.js";
import { type Manifest, MANIFEST_FILE, readManifest, writeManifest } from "./manifest.js";
import {
  AGENTS_MARKERS,
  withCompiledSettings,
  withoutCompiledSettings,
  withoutRulesBlock,
  withRulesBlock,
  WORKFLOW_FILE,
  workflowText,
} from "./outputs.js";
import { compiledRule } from "./plan.js";
import { type DocRuntime, RULES_DOC, RULES_DOC_MARK, RULES_INCLUDE, rulesAsDoc, writeRulesDoc } from "./rules-doc.js";
import type { ProjectRule } from "./types.js";

type FsRuntime = DocRuntime;

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

interface AgentsText {
  readonly steps: readonly Parsed<string>[];
  readonly edited: readonly string[];
}

const agentsText = (runtime: FsRuntime, root: AbsolutePath, rules: readonly ProjectRule[]): AgentsText => {
  const current = read(runtime, root, AGENTS_FILE);
  if (!rulesAsDoc(runtime, root))
    return { steps: [write(runtime, root, AGENTS_FILE, withRulesBlock(current, rules))], edited: [] };
  const doc = writeRulesDoc(runtime, root, rules);
  const agents = withManagedBlock(current, AGENTS_MARKERS, [RULES_INCLUDE]);
  return {
    steps: [
      ...(agents === current ? [] : [write(runtime, root, AGENTS_FILE, agents)]),
      ...(doc.built ? [accept(RULES_DOC)] : []),
    ],
    edited: doc.edited,
  };
};

export interface Compiled {
  readonly manifest: Manifest;
  readonly written: readonly string[];
  readonly edited: readonly string[];
}

export const compileRules = (
  runtime: FsRuntime,
  root: AbsolutePath,
  rules: readonly ProjectRule[],
  options: CompileOptions,
): Parsed<Compiled> => {
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
  const agents = agentsText(runtime, root, rules);
  const steps = [
    write(runtime, root, SETTINGS_FILE, settings.value),
    ...agents.steps,
    ...(ci ? [write(runtime, root, WORKFLOW_FILE, workflowText(rules, options.version))] : []),
  ];
  for (const step of steps) if (!step.ok) return step;
  const saved = writeManifest(runtime, root, manifest);
  if (!saved.ok) return reject(`${MANIFEST_FILE}: ${saved.error}`);
  return accept({
    manifest,
    written: [...steps.flatMap((step) => (step.ok ? [step.value] : [])), MANIFEST_FILE],
    edited: agents.edited,
  });
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
  if (read(runtime, root, RULES_DOC)?.startsWith(RULES_DOC_MARK) === true) {
    runtime.remove(toAbsolutePath(RULES_DOC, root));
    touched.push(RULES_DOC);
  }
  if (manifest.workflow !== undefined && read(runtime, root, manifest.workflow) !== undefined) {
    runtime.remove(toAbsolutePath(manifest.workflow, root));
    touched.push(manifest.workflow);
  }
  runtime.remove(toAbsolutePath(MANIFEST_FILE, root));
  return accept([...touched, MANIFEST_FILE]);
};

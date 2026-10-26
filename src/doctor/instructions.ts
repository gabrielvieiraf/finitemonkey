import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { globToRegExp } from "../core/glob.js";
import { withoutCarriageReturn } from "../core/posix-path.js";
import { CLAUDEIGNORE_FILES, claudeignoreRules } from "../install/claudeignore.js";
import { denyRules, readSettings } from "./settings.js";
import { type Check, type CheckFinding, type DoctorEnv, finding } from "./types.js";

export const INSTRUCTION_LINE_CEILING = 200;

const TOP_INSTRUCTIONS = ["AGENTS.md", "CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"] as const;
const RULES_DIR = ".claude/rules";
const SHOWN = 3;

export const readProjectFile = (env: DoctorEnv, relative: string): string | undefined => {
  const text = env.runtime.readText(toAbsolutePath(join(env.root, ...relative.split("/"))));
  return text.ok ? text.value : undefined;
};

export const instructionFiles = (env: DoctorEnv): readonly { path: string; text: string }[] => {
  const listed = env.runtime.listDir(toAbsolutePath(join(env.root, ...RULES_DIR.split("/"))));
  const rules = listed.ok
    ? listed.value.filter((name) => name.endsWith(".md")).map((name) => `${RULES_DIR}/${name}`)
    : [];
  return [...TOP_INSTRUCTIONS, ...rules].flatMap((path) => {
    const text = readProjectFile(env, path);
    return text === undefined ? [] : [{ path, text }];
  });
};

const shortList = (items: readonly string[]): string =>
  items.length <= SHOWN ? items.join(", ") : `${items.slice(0, SHOWN).join(", ")} (+${String(items.length - SHOWN)})`;

const claudeignore = (env: DoctorEnv, deny: readonly string[]): readonly CheckFinding[] => {
  const present = CLAUDEIGNORE_FILES.filter((path) => readProjectFile(env, path) !== undefined);
  if (present.length === 0) return [];
  const missing = claudeignoreRules(present.map((path) => readProjectFile(env, path))).filter(
    (rule) => !deny.includes(rule),
  );
  if (missing.length === 0) return [];
  return [
    finding(
      "instructions.claudeignore",
      "warn",
      "doctor.instructions.claudeignore",
      { file: present.join(", "), rules: shortList(missing) },
      "doctor.instructions.fix_claudeignore",
    ),
  ];
};

const READ_RULE = /^Read(?:\((.*)\))?$/;

const readGlob = (rule: string): string | undefined => {
  const match = READ_RULE.exec(rule.trim());
  if (match === null) return undefined;
  const glob = match[1] ?? "**";
  if (glob.startsWith("//") || glob.startsWith("~")) return undefined;
  return glob.replace(/^\.?\//, "");
};

export const hides = (glob: string, path: string): boolean => {
  if (globToRegExp(glob).test(path)) return true;
  return !glob.includes("/") && globToRegExp(glob).test(path.split("/").pop() ?? path);
};

const hiddenInstructions = (env: DoctorEnv, deny: readonly string[]): readonly CheckFinding[] => {
  const globs = deny.map(readGlob).filter((glob) => glob !== undefined);
  const hidden = instructionFiles(env)
    .map(({ path }) => path)
    .filter((path) => globs.some((glob) => hides(glob, path)));
  if (hidden.length === 0) return [];
  return [
    finding(
      "instructions.denied",
      "fail",
      "doctor.instructions.denied",
      { files: shortList(hidden) },
      "doctor.instructions.fix_denied",
    ),
  ];
};

const localFile = (env: DoctorEnv): readonly CheckFinding[] =>
  readProjectFile(env, "CLAUDE.local.md") === undefined
    ? []
    : [finding("instructions.local", "warn", "doctor.instructions.local", {}, "doctor.instructions.fix_local")];

const lineCount = (text: string): number => text.split("\n").length - (text.endsWith("\n") ? 1 : 0);

const oversized = (env: DoctorEnv): readonly CheckFinding[] =>
  ["AGENTS.md", "CLAUDE.md"].flatMap((file) => {
    const text = readProjectFile(env, file);
    const lines = text === undefined ? 0 : lineCount(text);
    if (lines <= INSTRUCTION_LINE_CEILING) return [];
    return [
      finding(
        "instructions.size",
        "warn",
        "doctor.instructions.size",
        { file, lines, max: INSTRUCTION_LINE_CEILING },
        "doctor.instructions.fix_size",
      ),
    ];
  });

const MIN_RULE_WORDS = 6;

export const ruleLines = (text: string): readonly string[] =>
  text
    .split("\n")
    .map((raw) => withoutCarriageReturn(raw).trim())
    .filter((line) => !/^(#|\||```|@|>)/.test(line))
    .map((line) =>
      line
        .replace(/^([-*+]|\d+[.)])\s+/, "")
        .replace(/\s+/g, " ")
        .toLowerCase(),
    )
    .filter((line) => line.split(" ").length >= MIN_RULE_WORDS);

export const duplicatedRules = (files: readonly { path: string; text: string }[]): readonly string[] => {
  const seen = new Map<string, Set<string>>();
  for (const { path, text } of files) {
    for (const line of ruleLines(text)) seen.set(line, (seen.get(line) ?? new Set()).add(path));
  }
  return [...seen].filter(([, paths]) => paths.size > 1).map(([line]) => line);
};

const duplicates = (env: DoctorEnv): readonly CheckFinding[] => {
  const files = instructionFiles(env).filter(({ path }) => path !== "CLAUDE.local.md");
  const lines = duplicatedRules(files);
  const first = lines[0];
  if (first === undefined) return [];
  return [
    finding(
      "instructions.duplicated",
      "warn",
      "doctor.instructions.duplicated",
      { count: lines.length, example: first.length > 60 ? `${first.slice(0, 57)}...` : first },
      "doctor.instructions.fix_duplicated",
    ),
  ];
};

export const checkInstructions: Check = (env) => {
  const deny = denyRules(readSettings(env));
  return [
    ...claudeignore(env, deny),
    ...hiddenInstructions(env, deny),
    ...localFile(env),
    ...oversized(env),
    ...duplicates(env),
  ];
};

import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { gitAt } from "../gate/git.js";
import { readViolations, violationCounts } from "../rules/violations.js";
import { packageManager, type ProjectFiles } from "../task/implicit.js";
import { FM_DIR } from "../task/paths.js";
import { proseLines } from "./parse.js";

export const INSTRUCTION_DRIFT_FEATURE = "instruction-drift";
export const DEFAULT_VIOLATION_LIMIT = 3;

export const INSTRUCTION_SOURCES = ["AGENTS.md", "CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"] as const;
const RULES_DIR = ".claude/rules";
const RULES_FILE = `${FM_DIR}/rules.yml`;

export interface DriftAt {
  readonly file: string;
  readonly line: number;
  readonly commit: string | null;
}

export type DriftFinding =
  | { readonly kind: "missing_path"; readonly at: DriftAt; readonly ref: string }
  | { readonly kind: "missing_script"; readonly at: DriftAt; readonly ref: string }
  | { readonly kind: "missing_symbol"; readonly at: DriftAt; readonly ref: string }
  | { readonly kind: "wrong_manager"; readonly at: DriftAt; readonly ref: string; readonly lockfile: string }
  | { readonly kind: "forbidden_dependency"; readonly at: DriftAt; readonly ref: string }
  | { readonly kind: "contradiction"; readonly at: DriftAt; readonly other: DriftAt; readonly proposal: boolean }
  | { readonly kind: "violated_rule"; readonly at: DriftAt; readonly ref: string; readonly count: number };

export interface InstructionText {
  readonly path: string;
  readonly text: string;
}

export interface ProposedContradiction {
  readonly first: { readonly file: string; readonly line: number };
  readonly second: { readonly file: string; readonly line: number };
}

export type ContradictionProposer = (files: readonly InstructionText[]) => readonly ProposedContradiction[];

export const NO_PROPOSER: ContradictionProposer = () => [];

export interface DriftInput {
  readonly files: readonly InstructionText[];
  readonly project: ProjectFiles;
  readonly tree: readonly string[] | undefined;
  readonly hasSymbol: (names: readonly string[]) => ReadonlySet<string>;
  readonly blame: (file: string, line: number) => string | null;
  readonly conflicts: readonly ProposedContradiction[];
  readonly violations: ReadonlyMap<string, number>;
  readonly violationLimit: number;
  readonly proposer: ContradictionProposer;
}

const CODE_SPAN = /`([^`\n]+)`/g;
const EXTENSIONS =
  /\.(?:ts|tsx|js|jsx|mjs|cjs|json|ya?ml|toml|md|py|go|rs|rb|sh|css|scss|html|sql|lock|txt|env|ini|cfg|xml|vue|svelte)$/i;
const TECH_NAMES = /^(?:node|next|nuxt|vue|react|express|three|chart|socket|backbone|ember|angular|d3|alpine)\.js$/i;
const NOT_A_PATH = /[\s*?[\]{}<>$|,;()'"=]|:\/\/|^~|^-|^\/|^\.\.|^@/;
const SCRIPT_RUN = /^(npm|pnpm|yarn|bun)\s+run\s+([\w:.-]+)/;
const MAKE_RUN = /^make\s+([\w.-]+)$/;
const SYMBOL = /^(?:[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+|[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+)(?:\(\))?$/;
const MANAGER =
  /\b(?:use|uses|using|always use|only use|with|via)\s+(npm|pnpm|yarn|bun)\b|^(npm|pnpm|yarn|bun)\s+(?:install|add|run|i)\b/i;
const FORBID =
  /\b(?:never|do not|don't|dont|avoid|no longer)\s+(?:use|import|add|install)\s+`?(@?[a-z0-9][\w.-]*(?:\/[\w.-]+)?)`?/i;
const LOCKS: Readonly<Record<string, string>> = {
  npm: "package-lock.json",
  pnpm: "pnpm-lock.yaml",
  yarn: "yarn.lock",
  bun: "bun.lock",
};

interface Ref {
  readonly file: string;
  readonly line: number;
  readonly span: string;
  readonly text: string;
}

const spansOf = (files: readonly InstructionText[]): readonly Ref[] =>
  files.flatMap((file) =>
    proseLines(file.text).flatMap(({ line, text }) =>
      [...text.matchAll(CODE_SPAN)].map((match) => ({ file: file.path, line, span: (match[1] ?? "").trim(), text })),
    ),
  );

const syntactic = (span: string): string | undefined => {
  if (NOT_A_PATH.test(span) || TECH_NAMES.test(span)) return undefined;
  const clean = span.replace(/^\.\//, "");
  return /^[\w.-]+(?:\/[\w.-]+)*\/?$/.test(clean) && !/^\d/.test(clean) && /[A-Za-z]/.test(clean) ? clean : undefined;
};

export const pathShaped = (span: string): boolean => {
  const clean = syntactic(span);
  if (clean === undefined) return false;
  const last = clean.replace(/\/$/, "").split("/").pop() ?? "";
  return (clean.includes("/") && clean.endsWith("/")) || (EXTENSIONS.test(last) && !last.startsWith("."));
};

const dirShaped = (span: string, tree: readonly string[]): boolean => {
  const clean = syntactic(span);
  if (!clean?.includes("/")) return false;
  const first = clean.split("/")[0] ?? "";
  return tree.some((file) => file.startsWith(`${first}/`));
};

export const symbolShaped = (span: string): boolean => span.length >= 4 && SYMBOL.test(span);

const pathExists = (tree: readonly string[], span: string): boolean => {
  const clean = span.replace(/^\.\//, "").replace(/\/$/, "");
  return tree.some(
    (file) =>
      file === clean || file.startsWith(`${clean}/`) || file.endsWith(`/${clean}`) || file.includes(`/${clean}/`),
  );
};

const scriptsOf = (project: ProjectFiles): ReadonlySet<string> | undefined => {
  const text = project.read("package.json");
  const parsed = text === undefined ? undefined : parseJsonObject(text);
  if (parsed?.ok !== true) return undefined;
  const scripts = parsed.value["scripts"];
  return new Set(isRecord(scripts) ? Object.keys(scripts) : []);
};

const dependenciesOf = (project: ProjectFiles): ReadonlySet<string> => {
  const text = project.read("package.json");
  const parsed = text === undefined ? undefined : parseJsonObject(text);
  if (parsed?.ok !== true) return new Set();
  return new Set(
    ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].flatMap((key) => {
      const value = parsed.value[key];
      return isRecord(value) ? Object.keys(value) : [];
    }),
  );
};

const at = (input: DriftInput, file: string, line: number): DriftAt => ({
  file,
  line,
  commit: input.blame(file, line),
});

const missingReferences = (input: DriftInput, refs: readonly Ref[]): readonly DriftFinding[] => {
  const scripts = scriptsOf(input.project);
  const makefile = input.project.read("Makefile");
  const tree = input.tree;
  const symbols = tree === undefined ? [] : refs.filter((ref) => symbolShaped(ref.span));
  const found = input.hasSymbol([...new Set(symbols.map((ref) => ref.span.replace(/\(\)$/, "")))]);
  return refs.flatMap((ref): readonly DriftFinding[] => {
    const script = SCRIPT_RUN.exec(ref.span);
    if (script !== null) {
      const name = script[2] ?? "";
      return scripts === undefined || scripts.has(name)
        ? []
        : [{ kind: "missing_script", at: at(input, ref.file, ref.line), ref: ref.span }];
    }
    const target = MAKE_RUN.exec(ref.span)?.[1];
    if (target !== undefined) {
      return makefile === undefined || new RegExp(`^${target.replace(/[.]/g, "\\.")}\\s*:`, "m").test(makefile)
        ? []
        : [{ kind: "missing_script", at: at(input, ref.file, ref.line), ref: ref.span }];
    }
    if (tree === undefined) return [];
    if (pathShaped(ref.span) || dirShaped(ref.span, tree))
      return pathExists(tree, ref.span)
        ? []
        : [{ kind: "missing_path", at: at(input, ref.file, ref.line), ref: ref.span }];
    if (symbolShaped(ref.span) && !found.has(ref.span.replace(/\(\)$/, "")))
      return [{ kind: "missing_symbol", at: at(input, ref.file, ref.line), ref: ref.span }];
    return [];
  });
};

const lockfileManager = (project: ProjectFiles): string | undefined => {
  const manager = packageManager(project);
  return project.exists(LOCKS[manager] ?? "") ? manager : undefined;
};

const repoContradictions = (input: DriftInput): readonly DriftFinding[] => {
  const locked = lockfileManager(input.project);
  const dependencies = dependenciesOf(input.project);
  return input.files.flatMap((file) =>
    proseLines(file.text).flatMap(({ line, text }): readonly DriftFinding[] => {
      const lines: DriftFinding[] = [];
      const spans = [...text.matchAll(CODE_SPAN)].map((match) => match[1] ?? "");
      const named = [text.replace(CODE_SPAN, " "), ...spans]
        .map((part) => MANAGER.exec(part.trim()))
        .flatMap((match) => (match === null ? [] : [(match[1] ?? match[2] ?? "").toLowerCase()]));
      const wrong = named.find((manager) => locked !== undefined && manager !== locked);
      if (wrong !== undefined && locked !== undefined)
        lines.push({
          kind: "wrong_manager",
          at: at(input, file.path, line),
          ref: wrong,
          lockfile: LOCKS[locked] ?? "",
        });
      const forbidden = FORBID.exec(text)?.[1];
      if (forbidden !== undefined && dependencies.has(forbidden))
        lines.push({ kind: "forbidden_dependency", at: at(input, file.path, line), ref: forbidden });
      return lines;
    }),
  );
};

const contradictions = (input: DriftInput): readonly DriftFinding[] => [
  ...input.conflicts.map((pair): DriftFinding => ({
    kind: "contradiction",
    at: at(input, pair.first.file, pair.first.line),
    other: at(input, pair.second.file, pair.second.line),
    proposal: false,
  })),
  ...input.proposer(input.files).map((pair): DriftFinding => ({
    kind: "contradiction",
    at: at(input, pair.first.file, pair.first.line),
    other: at(input, pair.second.file, pair.second.line),
    proposal: true,
  })),
];

const violated = (input: DriftInput): readonly DriftFinding[] => {
  const rules = input.project.read(RULES_FILE) ?? "";
  const lines = rules.split("\n");
  return [...input.violations]
    .filter(([, count]) => count >= input.violationLimit)
    .map(([rule, count]): DriftFinding => {
      const index = lines.findIndex((text) =>
        new RegExp(`\\bid:\\s*["']?${rule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']?\\s*$`).test(text),
      );
      return {
        kind: "violated_rule",
        at: index < 0 ? { file: RULES_FILE, line: 0, commit: null } : at(input, RULES_FILE, index + 1),
        ref: rule,
        count,
      };
    });
};

export const instructionDrift = (input: DriftInput): readonly DriftFinding[] => [
  ...missingReferences(input, spansOf(input.files)),
  ...repoContradictions(input),
  ...contradictions(input),
  ...violated(input),
];

export const instructionTexts = (
  runtime: Pick<Runtime, "readText" | "listDir">,
  root: AbsolutePath,
): readonly InstructionText[] => {
  const listed = runtime.listDir(toAbsolutePath(join(root, ...RULES_DIR.split("/"))));
  const rules = listed.ok
    ? listed.value.filter((name) => name.endsWith(".md")).map((name) => `${RULES_DIR}/${name}`)
    : [];
  return [...INSTRUCTION_SOURCES, ...rules].flatMap((path) => {
    const text = runtime.readText(toAbsolutePath(join(root, ...path.split("/"))));
    return text.ok ? [{ path, text: text.value }] : [];
  });
};

export const projectFilesAt = (runtime: Pick<Runtime, "readText" | "stat">, root: AbsolutePath): ProjectFiles => ({
  read: (relative) => {
    const text = runtime.readText(toAbsolutePath(join(root, ...relative.split("/"))));
    return text.ok ? text.value : undefined;
  },
  exists: (relative) => runtime.stat(toAbsolutePath(join(root, ...relative.split("/")))) !== undefined,
});

export const gitDriftInput = (
  runtime: Pick<Runtime, "readText" | "listDir" | "stat" | "exec">,
  root: AbsolutePath,
  options: {
    readonly conflicts: readonly ProposedContradiction[];
    readonly violationLimit: number;
    readonly proposer?: ContradictionProposer;
  },
): DriftInput => {
  const git = gitAt(runtime, root);
  const files = instructionTexts(runtime, root);
  const listed = git.out(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  const own = files.map((file) => `:(exclude)${file.path}`);
  return {
    files,
    project: projectFilesAt(runtime, root),
    tree: listed === undefined ? undefined : listed.split("\0").filter((file) => file !== ""),
    hasSymbol: (names) => {
      if (names.length === 0) return new Set();
      const out =
        git.out([
          "grep",
          "--untracked",
          "-I",
          "-h",
          "-o",
          "-w",
          "-F",
          ...names.flatMap((name) => ["-e", name]),
          "--",
          ".",
          ...own,
        ]) ?? "";
      return new Set(out.split("\n").map((line) => line.trim()));
    },
    blame: (file, line) => {
      if (line <= 0) return null;
      const sha = git.out(["blame", "--porcelain", "-L", `${String(line)},${String(line)}`, "--", file])?.split(" ")[0];
      return sha === undefined || /^0+$/.test(sha) || sha === "" ? null : sha;
    },
    conflicts: options.conflicts,
    violations: violationCounts(readViolations(runtime, toAbsolutePath(join(root, FM_DIR)))),
    violationLimit: options.violationLimit,
    proposer: options.proposer ?? NO_PROPOSER,
  };
};

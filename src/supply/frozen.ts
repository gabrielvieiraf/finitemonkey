import type { AbsolutePath } from "../core/brand.js";
import { baseOf, projectFiles, readProjectFile, type SupplyRuntime } from "./files.js";

export interface LooseInstall {
  readonly file: string;
  readonly line: number;
  readonly command: string;
  readonly fix: string;
}

interface InstallRule {
  readonly pattern: RegExp;
  readonly frozen: RegExp;
  readonly fix: string;
}

const GLOBAL = /(?:^|\s)(?:-g|--global)(?:\s|$)/;

const RULES: readonly InstallRule[] = [
  { pattern: /\bnpm\s+(?:install|i)\b/, frozen: GLOBAL, fix: "npm ci" },
  {
    pattern: /\bpnpm\s+(?:install|i)\b/,
    frozen: /--frozen-lockfile\b|(?:^|\s)-g(?:\s|$)/,
    fix: "pnpm install --frozen-lockfile",
  },
  { pattern: /\byarn\s+install\b/, frozen: /--frozen-lockfile\b|--immutable\b/, fix: "yarn install --immutable" },
  {
    pattern: /\bbun\s+(?:install|i)\b/,
    frozen: /--frozen-lockfile\b|(?:^|\s)-g(?:\s|$)/,
    fix: "bun install --frozen-lockfile",
  },
  { pattern: /\buv\s+sync\b/, frozen: /--locked\b|--frozen\b/, fix: "uv sync --locked" },
];

const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/;
const DOCKERFILE = /^(?:Dockerfile(?:\..+)?|.+\.Dockerfile)$/;

export const isInstallSurface = (file: string): boolean =>
  WORKFLOW.test(file) || file === ".gitlab-ci.yml" || DOCKERFILE.test(baseOf(file));

const segment = (line: string, match: RegExpExecArray): string => {
  const rest = line.slice(match.index);
  const end = rest.search(/&&|\|\||;|\|/);
  return end === -1 ? rest : rest.slice(0, end);
};

export const looseInstallsIn = (file: string, text: string): readonly LooseInstall[] =>
  text.split(/\r?\n/).flatMap((line, index) => {
    if (/^\s*#/.test(line)) return [];
    return RULES.flatMap((rule) => {
      const match = rule.pattern.exec(line);
      if (match === null) return [];
      const command = segment(line, match).trim();
      return rule.frozen.test(command) ? [] : [{ file, line: index + 1, command, fix: rule.fix }];
    });
  });

export const looseInstalls = (runtime: SupplyRuntime, root: AbsolutePath): readonly LooseInstall[] =>
  projectFiles(runtime, root)
    .filter(isInstallSurface)
    .flatMap((file) => looseInstallsIn(file, readProjectFile(runtime, root, file) ?? ""));

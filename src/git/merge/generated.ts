import { join } from "node:path";

import { toAbsolutePath } from "../../core/brand.js";
import { accept, type Parsed, reject } from "../../core/parsed.js";
import type { Runtime } from "../../core/runtime.js";
import { normalizeCommand } from "../../shell/normalize.js";
import type { Repo } from "../repo.js";
import { commitTree } from "../tree.js";
import { blobText } from "./inputs.js";
import type { Finding, MergeInputs } from "./types.js";

const LOCKFILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "bun.lock",
  "Cargo.lock",
  "poetry.lock",
  "Pipfile.lock",
  "composer.lock",
  "Gemfile.lock",
  "go.sum",
  "uv.lock",
]);

const GENERATOR_TIMEOUT_MS = 300000;

const DOUBLE_STAR = "\u0001";

const globRegex = (pattern: string): RegExp =>
  new RegExp(
    `^${pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .split("**")
      .join(DOUBLE_STAR)
      .replace(/\*/g, "[^/]*")
      .split(DOUBLE_STAR)
      .join(".*")}$`,
  );

export const generatorFor = (path: string, generators: Readonly<Record<string, string>>): string | undefined =>
  Object.entries(generators).find(
    ([pattern]) => globRegex(pattern).test(path) || globRegex(pattern).test(path.split("/").pop() ?? ""),
  )?.[1];

export const generatedPaths = (
  runtime: Runtime,
  repo: Repo,
  paths: readonly string[],
  generators: Readonly<Record<string, string>>,
): ReadonlySet<string> => {
  const out = new Set(
    paths.filter((path) => LOCKFILES.has(path.split("/").pop() ?? "") || generatorFor(path, generators) !== undefined),
  );
  if (paths.length === 0) return out;
  const attrs = runtime.git(["check-attr", "linguist-generated", "--", ...paths], repo.root);
  if (!attrs.ok) return out;
  for (const line of attrs.stdout.split("\n")) {
    const match = /^(.*): linguist-generated: (set|true)$/.exec(line);
    if (match?.[1] !== undefined) out.add(match[1]);
  }
  return out;
};

const resultCommit = (runtime: Runtime, repo: Repo, inputs: MergeInputs): Parsed<string> => {
  if (inputs.resultLabel !== "working tree") return accept(inputs.result);
  return commitTree(runtime, repo, inputs.result, [inputs.ours, inputs.theirs], "finitemonkey merge verify", {
    timeoutMs: 30000,
    stamp: "verify",
  });
};

const runGenerator = (runtime: Runtime, dir: string, command: string): Parsed<undefined> => {
  if (normalizeCommand(command).commands.length === 0) return reject(`empty generator: ${command}`);
  const result = runtime.exec({
    command,
    args: [],
    cwd: toAbsolutePath(dir),
    timeoutMs: GENERATOR_TIMEOUT_MS,
    shell: true,
  });
  return result.exitCode === 0
    ? accept(undefined)
    : reject(`generator failed: ${command}: ${result.stderr.trim().slice(0, 200)}`);
};

export const verifyGenerated = (
  runtime: Runtime,
  repo: Repo,
  inputs: MergeInputs,
  paths: readonly string[],
  generators: Readonly<Record<string, string>>,
): Parsed<readonly Finding[]> => {
  const declared = paths.flatMap((path) => {
    const command = generatorFor(path, generators);
    return command === undefined ? [] : [{ path, command }];
  });
  if (declared.length === 0) return accept([]);
  const commit = resultCommit(runtime, repo, inputs);
  if (!commit.ok) return commit;
  const dir = join(repo.gitDir, `finitemonkey-generate-${runtime.now().replace(/[:.]/g, "-")}`);
  if (!runtime.git(["worktree", "add", "--detach", dir, commit.value], repo.root).ok)
    return reject("could not check out the merge result");
  try {
    for (const command of new Set(declared.map((item) => item.command))) {
      const ran = runGenerator(runtime, dir, command);
      if (!ran.ok) return ran;
    }
    return accept(
      declared.flatMap(({ path }): Finding[] => {
        const fresh = runtime.readText(toAbsolutePath(join(dir, path)));
        const merged = blobText(runtime, repo, commit.value, path);
        if (fresh.ok && fresh.value === merged) return [];
        return [{ kind: "generated-differs", file: path, side: undefined, line: undefined, text: path, weak: false }];
      }),
    );
  } finally {
    runtime.git(["worktree", "remove", "--force", dir], repo.root);
    runtime.git(["worktree", "prune"], repo.root);
  }
};

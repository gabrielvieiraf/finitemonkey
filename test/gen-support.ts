import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../src/core/brand.js";
import { nodeRuntime } from "../src/core/node-runtime.js";
import { cli, type CliRun, ROOT } from "./support.js";

export interface TempProject {
  readonly root: AbsolutePath;
  readonly write: (path: string, text: string) => void;
  readonly run: (argv: readonly string[]) => Promise<CliRun>;
  readonly cleanup: () => void;
}

export const tempProject = (files: Readonly<Record<string, string>>, linkModules = true): TempProject => {
  const root = toAbsolutePath(realpathSync.native(mkdtempSync(join(tmpdir(), "fm-gen-"))));
  const modules = join(root, "node_modules");
  const write = (path: string, text: string): void => {
    const target = join(root, ...path.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  };
  for (const [path, text] of Object.entries(files)) write(path, text);
  if (linkModules) symlinkSync(join(ROOT, "node_modules"), modules, "junction");
  return {
    root,
    write,
    run: (argv) => cli(argv, { runtime: nodeRuntime(), cwd: root }),
    cleanup: () => {
      if (linkModules) unlinkSync(modules);
      rmSync(root, { recursive: true, force: true });
    },
  };
};

export const python = (): string | undefined =>
  ["python3", "python"].find((command) => spawnSync(command, ["--version"], { encoding: "utf8" }).status === 0);

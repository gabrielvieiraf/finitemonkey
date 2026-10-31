import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { filesUnder, renderTree, type Vars } from "./bench-render.js";

export interface OracleResult {
  readonly green: boolean;
  readonly exitCode: number | null;
  readonly output: string;
}

export interface OracleInput {
  readonly oracleDir: string;
  readonly workdir: string;
  readonly baseDir: string;
  readonly vars: Vars;
  readonly select?: (file: string) => boolean;
}

const OUTPUT_TAIL = 4000;

export const runOracle = (input: OracleInput): OracleResult => {
  const copy = realpathSync.native(mkdtempSync(join(tmpdir(), "fm-oracle-")));
  try {
    renderTree(input.oracleDir, copy, input.vars);
    const tests = filesUnder(copy)
      .filter((file) => file.endsWith(".test.mjs"))
      .filter((file) => input.select?.(file) ?? true)
      .map((file) => join(copy, file));
    if (tests.length === 0)
      return { green: false, exitCode: null, output: "the oracle has no matching .test.mjs file" };
    const result = spawnSync(process.execPath, ["--test", "--test-reporter=dot", ...tests], {
      cwd: copy,
      encoding: "utf8",
      timeout: 120_000,
      env: {
        PATH: process.env["PATH"] ?? "",
        ...(process.env["SystemRoot"] === undefined ? {} : { SystemRoot: process.env["SystemRoot"] }),
        ORACLE_WORKDIR: input.workdir,
        ORACLE_BASE: input.baseDir,
        ORACLE_VARS: JSON.stringify(input.vars),
      },
    });
    const output = `${result.stdout}${result.stderr}`;
    return { green: result.status === 0, exitCode: result.status, output: output.slice(-OUTPUT_TAIL) };
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
};

export const isTrapFile = (file: string): boolean => /(?:^|\/)trap[^/]*\.test\.mjs$/.test(file);

export interface TestSummary {
  readonly total?: number;
  readonly failed?: number;
  readonly failures: readonly string[];
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

const COUNTERS: readonly { readonly total: RegExp; readonly failed?: RegExp }[] = [
  { total: /^# tests (\d+)$/m, failed: /^# fail (\d+)$/m },
  { total: /^ℹ tests (\d+)$/m, failed: /^ℹ fail (\d+)$/m },
  { total: /^\s*Tests\s+(?:.*?\()?(\d+)\)?\s*$/m, failed: /^\s*Tests\s+(\d+) failed/m },
  { total: /^Tests:\s+.*?(\d+) total/m, failed: /^Tests:\s+(\d+) failed/m },
];

const FAILURE_LINES: readonly RegExp[] = [
  /^not ok \d+ - (.+)$/gm,
  /^\s*✖ (.+?)(?: \(\d+(?:\.\d+)?m?s\))?$/gm,
  /^[ \t]*(?:FAIL|×|✗) +(.+?)(?: +\d+m?s)?$/gm,
  /^\s*● (.+? › .+)$/gm,
  /^FAILED (\S+)/gm,
  /^--- FAIL: (\S+)/gm,
];

const ZERO = [
  /\bno tests? (?:found|ran|to run)\b/i,
  /\bno test files\b/i,
  /^# tests 0$/m,
  /^ℹ tests 0$/m,
  /No tests found/,
];

const pyTotal = (text: string): number | undefined => {
  const line = /^=+ (.*) in [\d.]+s.*=+$/m.exec(text)?.[1];
  if (line === undefined) return undefined;
  return [...line.matchAll(/(\d+) (passed|failed|error|errors|skipped|xfailed|xpassed)/g)].reduce(
    (sum, match) => sum + Number(match[1] ?? "0"),
    0,
  );
};

const counted = (text: string): { readonly total?: number; readonly failed?: number } => {
  for (const counter of COUNTERS) {
    const total = counter.total.exec(text)?.[1];
    if (total === undefined) continue;
    const failed = counter.failed?.exec(text)?.[1];
    return { total: Number(total), ...(failed === undefined ? {} : { failed: Number(failed) }) };
  }
  const py = pyTotal(text);
  return py === undefined ? {} : { total: py };
};

export const parseTestSummary = (output: string): TestSummary => {
  const text = output.replace(ANSI, "");
  const failures = [
    ...new Set(FAILURE_LINES.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => (match[1] ?? "").trim()))),
  ].filter((name) => name !== "" && !/^failing tests:?$/i.test(name));
  if (ZERO.some((pattern) => pattern.test(text))) return { total: 0, failures };
  return { ...counted(text), failures };
};

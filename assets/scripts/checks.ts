export interface Check {
  readonly label: string;
  readonly fail: string;
  readonly pass: string;
  readonly passesAtRun: number;
}

export const checks: readonly Check[] = [
  { label: "tests", fail: "missing", pass: "42 passed", passesAtRun: 3 },
  { label: "lint", fail: "17 errors", pass: "clean", passesAtRun: 2 },
  { label: "secrets", fail: ".env in diff", pass: "none", passesAtRun: 2 },
  { label: "types", fail: "9 any", pass: "strict", passesAtRun: 4 },
  { label: "done?", fail: "nope", pass: "verified", passesAtRun: 5 },
];

export const prompt = "$ finitemonkey gate";
export const verdict = "✓ actually done";

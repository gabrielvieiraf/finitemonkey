import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { DECISION_FILE } from "../decide/check.js";
import { readRecord } from "../guardian/record.js";
import { roleOf } from "../guardian/roles.js";
import { PLAN_DIR, planFiles, planPath } from "../plan/folder.js";

export interface AcceptedChoice {
  readonly file: string;
  readonly packages: readonly string[];
}

export interface Contradiction {
  readonly file: string;
  readonly chose: string;
  readonly used: string;
}

const TOKEN = /[@\w][\w@./:-]*/g;

const packagesIn = (text: string): readonly string[] => [
  ...new Set(
    [...text.matchAll(TOKEN)]
      .map((match) => match[0].replace(/[.:]+$/, "").toLowerCase())
      .filter((token) => roleOf(token) !== undefined),
  ),
];

export const acceptedChoices = (
  runtime: Pick<Runtime, "readText" | "listDir">,
  root: AbsolutePath,
): readonly AcceptedChoice[] =>
  planFiles(runtime, root)
    .filter((name) => DECISION_FILE.test(name))
    .flatMap((name) => {
      const text = runtime.readText(planPath(root, name));
      if (!text.ok) return [];
      const record = readRecord(text.value);
      const packages = record.status === "accepted" ? packagesIn(record.recommendation) : [];
      return packages.length === 0 ? [] : [{ file: `${PLAN_DIR}/${name}`, packages }];
    });

export const contradictions = (used: readonly string[], choices: readonly AcceptedChoice[]): readonly Contradiction[] =>
  used.flatMap((name) => {
    const role = roleOf(name);
    if (role === undefined) return [];
    return choices.flatMap((choice) => {
      if (choice.packages.includes(name.toLowerCase())) return [];
      const chose = choice.packages.find((item) => roleOf(item) === role);
      return chose === undefined ? [] : [{ file: choice.file, chose, used: name }];
    });
  });

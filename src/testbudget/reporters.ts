import { isAbsolute, relative } from "node:path";

import { isRecord, parseJsonObject } from "../core/parsed.js";
import { toPosixPath } from "../core/posix-path.js";
import { parseShell } from "../guards/shell.js";
import { quoteArg } from "../runlog/shell.js";

export const RUNNERS = ["node", "vitest", "jest", "pytest"] as const;

export type Runner = (typeof RUNNERS)[number];

export interface TestTiming {
  readonly file: string;
  readonly name: string;
  readonly ms: number;
}

const PYTHON = /^python(?:3(?:\.\d+)?)?$/;
const NODE_PREFIX = /^(\s*node)(?=\s)/;

const isPytest = (argv: readonly string[]): boolean =>
  argv[0] === "pytest" ||
  (PYTHON.test(argv[0] ?? "") && argv[1] === "-m" && argv[2] === "pytest") ||
  (argv[0] === "uv" && argv[1] === "run" && argv[2] === "pytest");

const hasFlag = (argv: readonly string[], flags: readonly string[]): boolean =>
  argv.some((arg) => flags.some((flag) => arg === flag || arg.startsWith(`${flag}=`)));

const detect = (argv: readonly string[], run: string): Runner | undefined => {
  if (argv[0] === "node" && argv.includes("--test") && NODE_PREFIX.test(run)) {
    return hasFlag(argv, ["--test-reporter", "--test-reporter-destination"]) ? undefined : "node";
  }
  if (argv[0] === "vitest") return hasFlag(argv, ["--reporter", "--outputFile"]) ? undefined : "vitest";
  if (argv[0] === "jest") return hasFlag(argv, ["--json", "--outputFile"]) ? undefined : "jest";
  if (isPytest(argv)) return hasFlag(argv, ["--junitxml", "--junit-xml"]) ? undefined : "pytest";
  return undefined;
};

export const runnerOf = (run: string): Runner | undefined => {
  const commands = parseShell(run);
  const only = commands[0];
  return commands.length === 1 && only !== undefined ? detect(only.argv, run) : undefined;
};

export const withReporter = (run: string, runner: Runner, file: string): string => {
  const target = quoteArg(file);
  if (runner === "node")
    return run.replace(
      NODE_PREFIX,
      (node: string) =>
        `${node} --test-reporter=spec --test-reporter-destination=stdout --test-reporter=junit --test-reporter-destination=${target}`,
    );
  if (runner === "vitest") return `${run} --reporter=default --reporter=json --outputFile.json=${target}`;
  if (runner === "jest") return `${run} --json --outputFile=${target}`;
  return `${run} --junitxml=${target}`;
};

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

const decode = (text: string): string =>
  text.replace(/&(amp|lt|gt|quot|apos|#\d+);/g, (whole, name: string) =>
    name.startsWith("#") ? String.fromCodePoint(Number(name.slice(1))) : (ENTITIES[name] ?? whole),
  );

const attributes = (tag: string): Readonly<Record<string, string>> =>
  Object.fromEntries(
    [...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map((match): [string, string] => [
      match[1] ?? "",
      decode(match[2] ?? ""),
    ]),
  );

const relativeTo = (root: string, file: string): string => toPosixPath(isAbsolute(file) ? relative(root, file) : file);

const caseOf = (tag: string, suites: readonly string[], root: string): TestTiming | undefined => {
  const attrs = attributes(tag);
  const name = attrs["name"];
  const seconds = Number(attrs["time"]);
  if (name === undefined || !Number.isFinite(seconds)) return undefined;
  const ms = Math.round(seconds * 1000);
  const file = attrs["file"];
  if (file !== undefined) return { file: relativeTo(root, file), name: [...suites, name].join(" > "), ms };
  return { file: attrs["classname"] ?? "", name, ms };
};

export const parseJunit = (xml: string, root: string): readonly TestTiming[] => {
  const suites: string[] = [];
  const found: TestTiming[] = [];
  for (const match of xml.matchAll(/<(\/?)(testsuite|testcase)\b([^>]*)>/g)) {
    const [, closing, tag, body] = match;
    if (tag === "testsuite" && closing === "/") suites.pop();
    else if (tag === "testsuite" && !(body ?? "").endsWith("/")) suites.push(attributes(body ?? "")["name"] ?? "");
    else if (tag === "testcase" && closing !== "/") {
      const timing = caseOf(body ?? "", suites.slice(suites[0] === "pytest" ? 1 : 0), root);
      if (timing !== undefined) found.push(timing);
    }
  }
  return found;
};

const assertionTiming = (file: string, value: unknown): TestTiming[] => {
  if (!isRecord(value)) return [];
  const name = typeof value["fullName"] === "string" ? value["fullName"] : value["title"];
  const ms = value["duration"];
  return typeof name === "string" && typeof ms === "number" ? [{ file, name, ms: Math.round(ms) }] : [];
};

export const parseJestJson = (text: string, root: string): readonly TestTiming[] => {
  const parsed = parseJsonObject(text);
  const results = parsed.ok ? parsed.value["testResults"] : undefined;
  if (!Array.isArray(results)) return [];
  return results.flatMap((result): TestTiming[] => {
    if (!isRecord(result) || typeof result["name"] !== "string" || !Array.isArray(result["assertionResults"]))
      return [];
    const file = relativeTo(root, result["name"]);
    return result["assertionResults"].flatMap((item) => assertionTiming(file, item));
  });
};

export const parseReport = (runner: Runner, text: string, root: string): readonly TestTiming[] =>
  runner === "vitest" || runner === "jest" ? parseJestJson(text, root) : parseJunit(text, root);

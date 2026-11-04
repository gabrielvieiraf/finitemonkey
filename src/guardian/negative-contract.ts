import type { Runtime } from "../core/runtime.js";
import type { Translate } from "../i18n/translate.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import { parseContract } from "../task/load.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";
import type { TaskContract } from "../task/types.js";
import type { Assumption } from "./assumptions.js";
import { type NegativeTest, negativeTestFor } from "./negative-test.js";
import { activeTask } from "./tasks.js";

const SAFE_ID = /^[\w.-]+$/;

const contractOf = (runtime: Pick<Runtime, "readText">, paths: FmPaths, source: string): TaskContract | undefined => {
  if (SAFE_ID.test(source)) {
    const text = runtime.readText(paths.task(source));
    const parsed = text.ok ? parseContract(source, text.value) : undefined;
    if (parsed?.ok === true) return parsed.value;
  }
  return activeTask(runtime, paths)?.contract;
};

export const proposalsFor = (
  runtime: Pick<Runtime, "readText">,
  paths: FmPaths,
  list: readonly Assumption[],
): readonly NegativeTest[] =>
  list.flatMap((item) => negativeTestFor(item, contractOf(runtime, paths, item.source)) ?? []);

export const proposalLines = (t: Translate, proposal: NegativeTest): readonly string[] => [
  t("guardian.assumptions.negative", {
    id: proposal.assumption,
    criterion: proposal.criterion,
    file: proposal.file ?? "-",
    run: proposal.run === "" ? "-" : proposal.run,
  }),
  t("guardian.assumptions.write_hint", { id: proposal.assumption }),
];

export type NegativeWriter = (proposal: NegativeTest) => string | undefined;

export interface FullerTest {
  readonly hash: string;
  readonly content: string;
  readonly origin: "model-proposed";
}

const fullerPath = (paths: FmPaths, assumption: string): ReturnType<FmPaths["cache"]> =>
  paths.cache(`negative-test-${assumption.replace(/[^\w.-]/g, "_")}.json`);

const hashOf = (content: string): string => sha256Hex(content).slice(0, 12);

export const proposeFuller = (
  runtime: Pick<Runtime, "writeText">,
  paths: FmPaths,
  proposal: NegativeTest,
  writer: NegativeWriter | undefined,
): FullerTest | undefined => {
  if (writer === undefined || proposal.file === null) return undefined;
  let content: string | undefined;
  try {
    content = writer(proposal);
  } catch {
    return undefined;
  }
  if (content === undefined) return undefined;
  const hash = hashOf(content);
  writeJsonFile(runtime, fullerPath(paths, proposal.assumption), { assumption: proposal.assumption, hash, content });
  return { hash, content, origin: "model-proposed" };
};

export const approvedFuller = (
  runtime: Pick<Runtime, "readText">,
  paths: FmPaths,
  assumption: string,
  hash: string,
): string | undefined => {
  const saved = readJsonFile(runtime, fullerPath(paths, assumption));
  const content = saved?.["content"];
  if (saved?.["assumption"] !== assumption || typeof content !== "string") return undefined;
  return hashOf(content) === hash && saved["hash"] === hash ? content : undefined;
};

export const fullerLines = (t: Translate, assumption: string, fuller: FullerTest): readonly string[] => [
  t("guardian.assumptions.fuller", { id: assumption, hash: fuller.hash }),
  fuller.content,
  t("guardian.assumptions.fuller_hint", { id: assumption, hash: fuller.hash }),
];

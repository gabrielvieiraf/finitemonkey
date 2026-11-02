import type { Runtime } from "../core/runtime.js";
import type { Translate } from "../i18n/translate.js";
import { parseContract } from "../task/load.js";
import type { FmPaths } from "../task/paths.js";
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

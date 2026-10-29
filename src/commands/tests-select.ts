import { workingTree } from "../arch/scan.js";
import { success } from "../core/result.js";
import { failureFrom } from "../core/result.js";
import { gitAt } from "../gate/git.js";
import { linkedTests } from "../testbudget/budget.js";
import { notRepository, repoOf } from "./git-problems.js";
import type { CommandSpec } from "./types.js";

export const TESTS_SELECT_SCHEMA = "finitemonkey/tests-select@1";

const lines = (text: string | undefined): readonly string[] =>
  (text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

export const testsSelectCommand: CommandSpec = {
  path: ["tests", "select"],
  summaryKey: "command.tests_select.summary",
  usage: "finitemonkey tests select [<file>...]",
  status: "ready",
  maxPositionals: 200,
  run: (ctx, args) => {
    const repo = repoOf(ctx);
    if (repo === undefined) return Promise.resolve(failureFrom(ctx.t, notRepository(ctx.cwd)));
    const git = gitAt(ctx.runtime, repo.root);
    const touched =
      args.positionals.length > 0
        ? [...args.positionals]
        : [
            ...lines(git.out(["diff", "--name-only", "HEAD"])),
            ...lines(git.out(["ls-files", "--others", "--exclude-standard"])),
          ];
    const tests = linkedTests(workingTree(ctx.runtime, git, repo.root, []), touched);
    return Promise.resolve(
      success({ schema: TESTS_SELECT_SCHEMA, touched, tests }, [
        tests.length === 0 ? ctx.t("tests_select.none") : ctx.t("tests_select.head", { count: tests.length }),
        ...tests,
      ]),
    );
  },
};

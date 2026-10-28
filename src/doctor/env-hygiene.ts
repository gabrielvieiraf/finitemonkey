import { envInHistory } from "../creds/history.js";
import { envHygiene, type HygieneProblem } from "../creds/hygiene.js";
import { type Check, type CheckFinding, finding } from "./types.js";

const toFinding = (problem: HygieneProblem): CheckFinding => {
  switch (problem.kind) {
    case "unignored":
      return finding("env.ignored", "fail", "env.unignored", { file: problem.file }, "env.fix_unignored");
    case "public":
      return finding(
        "env.public",
        "fail",
        "env.public",
        { name: problem.name, where: problem.where },
        "env.fix_public",
      );
    case "undocumented":
      return finding(
        "env.parity",
        "warn",
        "env.undocumented",
        { name: problem.name, where: problem.where },
        "env.fix_parity",
      );
    case "unused":
      return finding("env.parity", "warn", "env.unused", { name: problem.name, file: problem.file }, "env.fix_parity");
  }
};

export const checkEnvHygiene: Check = ({ root, runtime }) => [
  ...envHygiene(runtime, root).map(toFinding),
  ...envInHistory(runtime, root).map((item) =>
    finding(
      "env.history",
      "fail",
      "env.history",
      { file: item.file, commit: item.commit.slice(0, 12) },
      "env.fix_history",
    ),
  ),
];

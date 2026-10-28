import { looseInstalls } from "../supply/frozen.js";
import { lockConflicts } from "../supply/lockfiles.js";
import { type Check, type CheckFinding, finding } from "./types.js";

export const checkSupplyChain: Check = ({ root, runtime }) => {
  const locks: readonly CheckFinding[] = lockConflicts(runtime, root).map((conflict) =>
    finding(
      "supply.lockfiles",
      "fail",
      "deps.check.lockfiles",
      {
        dir: conflict.dir === "" ? "." : conflict.dir,
        ecosystem: conflict.ecosystem,
        files: conflict.files.join(", "),
        count: conflict.files.length,
      },
      "deps.doctor.fix_lockfiles",
    ),
  );
  const installs: readonly CheckFinding[] = looseInstalls(runtime, root).map((install) =>
    finding("supply.frozen", "fail", "deps.check.loose", { ...install }, "deps.doctor.fix_frozen"),
  );
  return [...locks, ...installs];
};

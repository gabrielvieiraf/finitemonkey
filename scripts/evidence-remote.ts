import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { AbsolutePath } from "../src/core/brand.js";
import type { Runtime } from "../src/core/runtime.js";
import { remotePreToolUse } from "../src/guards/remote/hook.js";
import type { CorpusCase } from "./evidence-corpus.js";
import type { CaseResult } from "./evidence-rates.js";
import { blocksOrAsks, replayGuard } from "./evidence-replay.js";

export const REMOTE_CORPUS = "remote";

const POLICY = join(".fm", "policy.yml");
const ACTIVE = "guards:\n  remote-destructive: active\n";

export const replayRemote = async (
  runtime: Runtime,
  root: AbsolutePath,
  cases: readonly CorpusCase[],
): Promise<readonly CaseResult[]> => {
  const file = join(root, POLICY);
  const before = existsSync(file) ? readFileSync(file, "utf8") : undefined;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, ACTIVE);
  try {
    return await replayGuard(runtime, root, [remotePreToolUse], cases, blocksOrAsks);
  } finally {
    if (before === undefined) rmSync(file, { force: true });
    else writeFileSync(file, before);
  }
};

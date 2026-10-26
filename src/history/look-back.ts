import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import type { Env } from "../core/context.js";
import type { Runtime } from "../core/runtime.js";
import { maskText } from "../mask/mask.js";
import { hitsIn, type Pattern } from "./patterns.js";
import { parseTranscript } from "./transcript.js";

export interface LookBack {
  readonly estimate: true;
  readonly sessions: number;
  readonly turns: number;
  readonly counts: Readonly<Record<Pattern, number>>;
  readonly samples: Readonly<Record<Pattern, readonly string[]>>;
}

const SAMPLES = 3;

export const projectLogKey = (root: string): string => root.replace(/[^A-Za-z0-9-]/g, "-");

export const projectLogDir = (runtime: Pick<Runtime, "homeDir">, root: string, env: Env): string =>
  join(env["CLAUDE_CONFIG_DIR"] ?? join(runtime.homeDir(), ".claude"), "projects", projectLogKey(root));

export const lookBack = (
  runtime: Pick<Runtime, "homeDir" | "listDir" | "readText">,
  root: string,
  env: Env,
): LookBack => {
  const dir = projectLogDir(runtime, root, env);
  const listed = runtime.listDir(toAbsolutePath(dir));
  const files = listed.ok ? listed.value.filter((name) => name.endsWith(".jsonl")).sort() : [];
  const counts: Record<Pattern, number> = {
    done_after_failing_tests: 0,
    env_read: 0,
    no_verify: 0,
    force_push: 0,
    test_skip: 0,
  };
  const samples: Record<Pattern, string[]> = {
    done_after_failing_tests: [],
    env_read: [],
    no_verify: [],
    force_push: [],
    test_skip: [],
  };
  let turns = 0;
  for (const name of files) {
    const text = runtime.readText(toAbsolutePath(join(dir, name)));
    if (!text.ok) continue;
    for (const turn of parseTranscript(text.value)) {
      turns += 1;
      for (const hit of hitsIn(turn)) {
        counts[hit.pattern] += 1;
        const list = samples[hit.pattern];
        if (list.length < SAMPLES) list.push(maskText(hit.sample));
      }
    }
  }
  return { estimate: true, sessions: files.length, turns, counts, samples };
};

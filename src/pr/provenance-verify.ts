import type { Env } from "../core/context.js";
import type { Runtime } from "../core/runtime.js";
import type { HookCheck } from "../githooks/checks.js";
import { pullRequestOf } from "../githooks/pull-request.js";
import { type BlockCheck, extractBlock, PROVENANCE_START, textHash } from "./provenance.js";

const HEADER = /^<!-- finitemonkey:provenance sha256=[0-9a-f]+ tree=\S+ text=([0-9a-f]{32}) -->$/;

export const PROVENANCE_CHECK_FIX = "regenerate the block with finitemonkey pr provenance and paste it unchanged";

export const verifyBlockText = (body: string): BlockCheck => {
  const text = body.replace(/\r\n/g, "\n");
  const block = extractBlock(text);
  if (block === undefined) return text.includes(PROVENANCE_START) ? "edited" : "missing";
  const lines = block.split("\n");
  const hash = HEADER.exec(lines[0] ?? "")?.[1];
  if (hash === undefined) return "edited";
  return textHash(lines.slice(1, -1)) === hash ? "match" : "edited";
};

export const provenanceCheck = (runtime: Pick<Runtime, "readText">, env: Env): HookCheck => {
  const pr = pullRequestOf(runtime, env);
  const result = pr === undefined ? "missing" : verifyBlockText(pr.body);
  const failures =
    result === "edited"
      ? [`the ${PROVENANCE_START.replace("<!-- ", "")} block in the pull request body was edited by hand`]
      : [];
  return { id: "provenance", failures, fix: PROVENANCE_CHECK_FIX };
};

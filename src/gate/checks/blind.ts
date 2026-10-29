import {
  BLIND_FEATURE,
  blindConfig,
  type BlindPacket,
  type BlindTest,
  buildPacket,
  commandWriter,
  hasCriteria,
  runBlindTest,
} from "../../blind/blind.js";
import { type AbsolutePath } from "../../core/brand.js";
import { isRecord } from "../../core/parsed.js";
import { logEvent } from "../../evidence/log.js";
import type { Note } from "../../evidence/types.js";
import { loadProjectConfig } from "../../git/project-config.js";
import { copyWorking } from "../../mutation/run.js";
import { featureMode, recordFeatureShadow } from "../../policy/feature.js";
import { sha256Hex as sha256 } from "../../secrets/fingerprint.js";
import { readJsonFile, writeJsonFile } from "../../task/state.js";
import type { AcceptanceCheck } from "../../task/types.js";
import { installFrozen, removeScratch, scratchDir } from "../isolated.js";
import { type CheckOutcome, failed, type GateContext, note, passed, unverified } from "../types.js";

const SHOWN = 160;

interface Kept extends BlindTest {
  readonly baseOutput: string;
}

interface Written {
  readonly key: string;
  readonly kept: readonly Kept[];
  readonly discarded: readonly string[];
}

const clip = (text: string): string => (text.length > SHOWN ? `${text.slice(0, SHOWN)}…` : text);

const cacheName = (task: string): string => `blind-${task}.json`;

const readWritten = (ctx: GateContext, key: string): Written | undefined => {
  const raw = readJsonFile(ctx.runtime, ctx.paths.cache(cacheName(ctx.contract.id)));
  if (raw?.["key"] !== key || !Array.isArray(raw["kept"])) return undefined;
  const kept = raw["kept"].flatMap((item: unknown): Kept[] =>
    isRecord(item) &&
    typeof item["name"] === "string" &&
    typeof item["file"] === "string" &&
    typeof item["content"] === "string" &&
    typeof item["run"] === "string" &&
    typeof item["baseOutput"] === "string"
      ? [
          {
            name: item["name"],
            file: item["file"],
            content: item["content"],
            run: item["run"],
            baseOutput: item["baseOutput"],
          },
        ]
      : [],
  );
  const discarded = Array.isArray(raw["discarded"])
    ? raw["discarded"].filter((item): item is string => typeof item === "string")
    : [];
  return { key, kept, discarded };
};

const inScratch = <T>(ctx: GateContext, at: string, work: (dir: AbsolutePath) => T): T | string => {
  const root = ctx.paths.root;
  const dir = scratchDir(ctx.runtime, root, "blind");
  const added = ctx.runtime.gitWith(["worktree", "add", "--detach", "--force", dir, at], root, {});
  try {
    return added.ok ? work(dir) : added.stderr.trim();
  } finally {
    removeScratch(ctx.runtime, root, dir);
  }
};

const write = (ctx: GateContext, packet: BlindPacket, writer: string, max: number, key: string): Written | string =>
  inScratch(ctx, ctx.base, (dir): Written | string => {
    const installed = installFrozen(ctx.runtime, dir, ctx.deadline);
    if (!installed.ok) return installed.error.detail;
    const tests = commandWriter(ctx.runtime, writer, max)(packet, dir);
    if (tests === undefined) return "writer";
    const runs = tests.map((test) => ({ test, run: runBlindTest(ctx.runtime, dir, test) }));
    const written: Written = {
      key,
      kept: runs.filter((item) => !item.run.passed).map((item) => ({ ...item.test, baseOutput: item.run.output })),
      discarded: runs.filter((item) => item.run.passed).map((item) => item.test.name),
    };
    writeJsonFile(ctx.runtime, ctx.paths.cache(cacheName(ctx.contract.id)), {
      key,
      kept: written.kept.map((item) => ({ ...item })),
      discarded: [...written.discarded],
    });
    logEvent(ctx.runtime, ctx.paths, "blind.written", {
      task: ctx.contract.id,
      kept: written.kept.length,
      discarded: written.discarded.length,
    });
    return written;
  });

const onHead = (ctx: GateContext, kept: readonly Kept[]): readonly Note[] | string =>
  inScratch(ctx, "HEAD", (dir): readonly Note[] | string => {
    copyWorking(ctx, dir);
    const installed = installFrozen(ctx.runtime, dir, ctx.deadline);
    if (!installed.ok) return installed.error.detail;
    return kept.flatMap((test) => {
      const run = runBlindTest(ctx.runtime, dir, test);
      return run.passed
        ? []
        : [
            note("gate.blind.disagree", {
              name: test.name,
              base: clip(ctx.mask(test.baseOutput)) || "-",
              head: clip(ctx.mask(run.output)) || "-",
            }),
          ];
    });
  });

export const blindCheck = (_check: AcceptanceCheck, ctx: GateContext): CheckOutcome => {
  const mode = featureMode(ctx.runtime, ctx.paths, BLIND_FEATURE);
  if (mode === "off") return passed([note("gate.blind.off")]);
  if ((ctx.size?.effective ?? ctx.contract.size) === "S") return passed([note("gate.blind.small")]);
  const packet = buildPacket(ctx.contract, ctx.base, ctx.examples ?? []);
  if (!hasCriteria(packet)) return passed([note("gate.blind.no_criteria")]);
  const config = blindConfig(loadProjectConfig(ctx.runtime, ctx.paths.root));
  if (config.writer === undefined) return passed([note("gate.blind.no_writer")]);
  if (!ctx.trusted) return unverified("untrusted", [note("gate.note.untrusted", { task: ctx.contract.id })]);
  const key = sha256(JSON.stringify([packet, config.writer, config.maxTests]));
  const written = readWritten(ctx, key) ?? write(ctx, packet, config.writer, config.maxTests, key);
  if (typeof written === "string")
    return unverified("tool_missing", [note("gate.blind.unavailable", { detail: ctx.mask(written) })]);
  const summary = note("gate.blind.summary", { kept: written.kept.length, discarded: written.discarded.length });
  if (written.kept.length === 0) return passed([summary]);
  const disagreements = onHead(ctx, written.kept);
  if (typeof disagreements === "string")
    return unverified("tool_missing", [note("gate.blind.unavailable", { detail: ctx.mask(disagreements) })]);
  if (disagreements.length === 0) return passed([summary]);
  if (mode === "active") return failed([summary, ...disagreements]);
  recordFeatureShadow(ctx.runtime, ctx.paths, BLIND_FEATURE, { task: ctx.contract.id, failed: disagreements.length });
  return passed([summary, ...disagreements, note("gate.blind.shadow", { count: disagreements.length })]);
};

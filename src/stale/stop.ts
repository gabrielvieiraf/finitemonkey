import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { allowWith, human, projectPaths } from "../gate/hooks/common.js";
import { onceFor } from "../guardian/once.js";
import type { HookDecision, HookHandler, HookHandlers, HookInput } from "../hooks/handlers.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import { defaultBranch } from "../rules/required.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import type { FmPaths } from "../task/paths.js";
import { readUnits } from "./docs.js";
import { featureDefaults } from "./state.js";
import { changedFiles, type Mention, mentionsOf, type Touched, touchedSince } from "./touched.js";

export const STALE_DOCS_FEATURE = "stale-docs";
const TOUCHED_FILE = "stale-docs-touched.json";
const SHOWN_FILE = "stale-docs-shown.json";
const MAX_LINES = 5;

const allow: HookDecision = { kind: "allow" };

const usable = (input: HookInput): FmPaths | undefined => {
  const paths = projectPaths(input);
  return paths !== undefined && input.runtime.stat(paths.dir)?.kind === "dir" ? paths : undefined;
};

export const diffBase = (runtime: Pick<Runtime, "git">, root: AbsolutePath): string | undefined => {
  const branch = defaultBranch(runtime, root);
  for (const ref of [`origin/${branch}`, branch]) {
    const base = runtime.git(["merge-base", "HEAD", ref], root);
    if (base.ok && base.stdout.trim() !== "") return base.stdout.trim();
  }
  return undefined;
};

const isEmpty = (touched: Touched): boolean =>
  touched.paths.length + touched.symbols.length + touched.features.length + touched.issues.length === 0;

export const touchedByTask = (runtime: Pick<Runtime, "git">, root: AbsolutePath, base: string): Touched =>
  touchedSince(runtime, root, base, new Set(featureDefaults().keys()), true);

export const mentionsFor = (
  runtime: Pick<Runtime, "git" | "readText">,
  root: AbsolutePath,
  base: string,
  touched: Touched,
): readonly Mention[] => {
  const changed = new Set(changedFiles(runtime, root, base, true).filter((path) => path.endsWith(".md")));
  return mentionsOf(readUnits(runtime, root), touched, changed).filter((item) => !item.changedHere);
};

const mentionKey = (item: Mention): string => `${item.file}:${String(item.line)}:${item.mentions.join(",")}`;

const messageOf = (input: HookInput, mentions: readonly Mention[]): string => {
  const lines = mentions
    .slice(0, MAX_LINES)
    .map((item) =>
      input.t("stale.mention", { where: `${item.file}:${String(item.line)}`, mentions: item.mentions.join(", ") }),
    );
  const more = mentions.length - MAX_LINES;
  return [
    input.t("stale.stop.head", { count: mentions.length }),
    ...lines,
    ...(more > 0 ? [input.t("stale.stop.more", { count: more })] : []),
  ].join("\n");
};

export const staleDocsStop: HookHandler = (input) => {
  const paths = usable(input);
  if (paths === undefined || input.payload.stopHookActive) return allow;
  const { runtime } = input;
  const base = diffBase(runtime, paths.root);
  if (base === undefined) return allow;
  const touched = touchedByTask(runtime, paths.root, base);
  if (isEmpty(touched) || !onceFor(runtime, paths, TOUCHED_FILE, sha256Hex(JSON.stringify(touched)))) return allow;
  const fresh = mentionsFor(runtime, paths.root, base, touched).filter((item) =>
    onceFor(runtime, paths, SHOWN_FILE, mentionKey(item)),
  );
  if (fresh.length === 0) return allow;
  if (featureMode(runtime, paths, STALE_DOCS_FEATURE) !== "active") {
    recordFeatureShadow(runtime, paths, STALE_DOCS_FEATURE, {
      mentions: fresh.length,
      files: [...new Set(fresh.map((item) => item.file))],
    });
    return allow;
  }
  return allowWith({ systemMessage: human(messageOf(input, fresh)) });
};

export const STALE_DOCS_HANDLERS: HookHandlers = { Stop: [staleDocsStop] };

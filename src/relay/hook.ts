import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { logEvent } from "../evidence/log.js";
import { contextOutput, projectPaths } from "../gate/hooks/common.js";
import { comesFromPerson } from "../guards/release/markers.js";
import { textField } from "../hooks/fields.js";
import type { HookHandler, HookHandlers } from "../hooks/handlers.js";
import type { Translate } from "../i18n/translate.js";
import type { FmPaths } from "../task/paths.js";
import { detectRelay, type ProjectFacts, type RelayFinding } from "./detect.js";

const JS_MANIFESTS = ["package.json"];
const PYTHON_MANIFESTS = ["requirements.txt", "pyproject.toml", "Pipfile"];
const LOG_TAIL = 64 * 1024;

const read = (runtime: Pick<Runtime, "readText">, root: AbsolutePath, name: string): string | undefined => {
  const text = runtime.readText(toAbsolutePath(join(root, name)));
  return text.ok ? text.value : undefined;
};

const recentClaims = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly string[] => {
  const log = runtime.readText(paths.log);
  if (!log.ok) return [];
  return log.value
    .slice(-LOG_TAIL)
    .split("\n")
    .flatMap((line) => {
      const parsed = parseJsonObject(line);
      const claim = parsed.ok ? parsed.value["claim"] : undefined;
      return typeof claim === "string" ? [claim] : [];
    });
};

export const projectFacts = (runtime: Pick<Runtime, "readText">, paths: FmPaths): ProjectFacts => {
  const js = JS_MANIFESTS.flatMap((name) => read(runtime, paths.root, name) ?? []);
  const python = PYTHON_MANIFESTS.flatMap((name) => read(runtime, paths.root, name) ?? []);
  return {
    manifests: [...js, ...python].join("\n"),
    hasJs: js.length > 0,
    hasPython: python.length > 0,
    ownOutput: recentClaims(runtime, paths),
  };
};

export const relayNote = (t: Translate, finding: RelayFinding): string =>
  [
    t("relay.note.found", { count: finding.blocks, lines: finding.lines }),
    ...finding.markers.map((marker) =>
      marker === "missing_import"
        ? t("relay.marker.missing_import", { list: finding.missing.join(", ") })
        : marker === "placeholder"
          ? t("relay.marker.placeholder", { list: finding.placeholders.join(", ") })
          : t(`relay.marker.${marker}`),
    ),
    t("relay.note.source"),
  ].join(" ");

export const relayDetector: HookHandler = (input) => {
  const prompt = textField(input.payload.raw, "prompt", "prompt_text") ?? "";
  const paths = projectPaths(input);
  if (paths === undefined || prompt.trim() === "" || !comesFromPerson(prompt)) return { kind: "allow" };
  const finding = detectRelay(prompt, projectFacts(input.runtime, paths));
  if (finding === undefined) return { kind: "allow" };
  if (input.runtime.stat(paths.dir)?.kind === "dir") {
    logEvent(input.runtime, paths, "relay.flagged", {
      markers: [...finding.markers],
      blocks: finding.blocks,
      lines: finding.lines,
    });
  }
  return { kind: "allow", output: contextOutput("UserPromptSubmit", relayNote(input.t, finding)) };
};

export const RELAY_HANDLERS: HookHandlers = { UserPromptSubmit: [relayDetector] };

import { dirname, relative } from "node:path";

import { profileDomainOf } from "../conceitos/concepts.js";
import { packageMapOf } from "../conceitos/packages.js";
import { NO_PACKAGES, type PackageMap, recognizeCode } from "../conceitos/recognize.js";
import { toAbsolutePath } from "../core/brand.js";
import { isRecord, type JsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { logEvent } from "../evidence/log.js";
import { projectPaths } from "../gate/hooks/common.js";
import { deny, FILE_TOOLS } from "../guards/context.js";
import { textField, toolInput, toolName } from "../hooks/fields.js";
import type { HookHandler } from "../hooks/handlers.js";
import { readProfile } from "../perfil/store.js";
import { type Domain, levelOf } from "../perfil/types.js";
import { activeBlueprint } from "../planta/store.js";
import { BLUEPRINT_TYPES } from "../planta/types.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, readState, writeJsonFile } from "../task/state.js";
import { teachOptedIn } from "./opt-in.js";

export const BLUEPRINT_ASKED_FILE = "blueprint-asked.json";

const allow = { kind: "allow" } as const;

const editedText = (raw: JsonObject): string => {
  const args = toolInput(raw);
  const edits = Array.isArray(args["edits"]) ? args["edits"] : [];
  return [
    textField(args, "content", "new_string", "new_source") ?? "",
    ...edits.map((edit: unknown) => (isRecord(edit) ? (textField(edit, "new_string") ?? "") : "")),
  ].join("\n");
};

export const domainsOfEdit = (file: string, text: string, map: PackageMap = NO_PACKAGES): readonly Domain[] => {
  const recognized = recognizeCode({ file, lines: text.split("\n") }, map).flatMap(
    (item) => profileDomainOf(item.concept) ?? [],
  );
  const found = [...new Set(recognized)];
  return found.length === 0 ? ["product"] : found;
};

export const beginnerDomain = (
  runtime: Pick<Runtime, "readText" | "now">,
  paths: FmPaths,
  domains: readonly Domain[],
): Domain | undefined => {
  const profile = readProfile(runtime, paths);
  return profile === undefined
    ? undefined
    : domains.find((domain) => levelOf(profile.domains[domain].knowledge) === "beginner");
};

const askedTasks = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly string[] => {
  const list = readJsonFile(runtime, paths.cache(BLUEPRINT_ASKED_FILE))?.["tasks"];
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [];
};

const remember = (runtime: Pick<Runtime, "readText" | "writeText" | "mkdir">, paths: FmPaths, task: string): void => {
  runtime.mkdir(toAbsolutePath(dirname(paths.cache(BLUEPRINT_ASKED_FILE))));
  writeJsonFile(runtime, paths.cache(BLUEPRINT_ASKED_FILE), {
    tasks: [...askedTasks(runtime, paths), task].slice(-100),
  });
};

export const blueprintFirst: HookHandler = (input) => {
  if (!FILE_TOOLS.has(toolName(input.payload.raw))) return allow;
  const paths = projectPaths(input);
  const { runtime, t } = input;
  if (paths === undefined || !teachOptedIn(runtime, paths)) return allow;
  const task = readState(runtime, paths).active;
  if (task === undefined || activeBlueprint(runtime, paths) !== undefined) return allow;
  if (askedTasks(runtime, paths).includes(task)) return allow;
  const raw = textField(toolInput(input.payload.raw), "file_path", "notebook_path") ?? "";
  const file = relative(paths.root, raw).replaceAll("\\", "/");
  const domain = beginnerDomain(
    runtime,
    paths,
    domainsOfEdit(file, editedText(input.payload.raw), packageMapOf(runtime, paths)),
  );
  if (domain === undefined) return allow;
  remember(runtime, paths, task);
  logEvent(runtime, paths, "teach.blueprint_asked", { task, domain });
  const params = { task, domain, types: BLUEPRINT_TYPES.join(", ") };
  return deny(t("teach.blueprint.reason", params), t("teach.blueprint.human", params));
};

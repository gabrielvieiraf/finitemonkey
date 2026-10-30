import type { Runtime } from "../core/runtime.js";
import { human, projectPaths } from "../gate/hooks/common.js";
import { textField, toolInput, toolName } from "../hooks/fields.js";
import type { HookHandler, HookHandlers } from "../hooks/handlers.js";
import { maskText } from "../mask/mask.js";
import { recordHorizon } from "../signals/blind-band.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile } from "../task/state.js";
import { levelSum, raise, readBook, writeBook } from "./book.js";
import { conceptsIn, domainOf } from "./concepts.js";
import { creditPending } from "./credit.js";
import { recordConceptEvents } from "./evidence.js";

export const PENDING_FILE = "conceitos-pending.txt";
export const ALARM_STEP = 3;
const TEACHER = /(?:^|:)teacher$/i;
const MAX_PENDING = 20_000;

const allow = { kind: "allow" } as const;

export const pendingPath = (paths: FmPaths): ReturnType<FmPaths["cache"]> => paths.cache(PENDING_FILE);

export const blueprintGreen = (runtime: Pick<Runtime, "readText">, paths: FmPaths): number | undefined => {
  const green = readJsonFile(runtime, paths.cache("planta.json"))?.["green"];
  return typeof green === "number" ? green : undefined;
};

const alarmOf = (input: Parameters<HookHandler>[0], paths: FmPaths): string | undefined => {
  const green = blueprintGreen(input.runtime, paths);
  const book = readBook(input.runtime, paths);
  if (green === undefined || green - book.baselineGreen < ALARM_STEP || book.alarmGreen === green) return undefined;
  writeBook(input.runtime, paths, { ...book, alarmGreen: green });
  return input.t("conceitos.alarm", { grew: green - book.baselineGreen, concepts: levelSum(book) });
};

export const conceitosStop: HookHandler = (input) => {
  const paths = projectPaths(input);
  if (paths === undefined || input.runtime.stat(paths.dir)?.kind !== "dir") return allow;
  const message = textField(input.payload.raw, "last_assistant_message") ?? "";
  const exposed = message !== "" && conceptsIn(message).length > 0;
  if (exposed) input.runtime.writeText(pendingPath(paths), maskText(message).slice(0, MAX_PENDING));
  if (exposed || creditPending(input.runtime, paths)) input.runtime.spawnSelf(["conceitos", "update"], paths.root);
  const alarm = alarmOf(input, paths);
  return alarm === undefined ? allow : { kind: "allow", output: { systemMessage: human(alarm) } };
};

export const teacherRecorder: HookHandler = (input) => {
  const raw = input.payload.raw;
  if (!["Agent", "Task"].includes(toolName(raw))) return allow;
  const agent = textField(toolInput(raw), "subagent_type") ?? "";
  const paths = projectPaths(input);
  if (!TEACHER.test(agent) || paths === undefined) return allow;
  const ids = conceptsIn(textField(toolInput(raw), "prompt") ?? "");
  const now = input.runtime.now();
  const book = ids.reduce((current, id) => raise(current, id, "explained", now), readBook(input.runtime, paths));
  writeBook(input.runtime, paths, book);
  return allow;
};

export const updateFromPending = (
  runtime: Pick<Runtime, "readText" | "writeText" | "remove" | "now" | "appendText">,
  paths: FmPaths,
): readonly string[] => {
  const text = runtime.readText(pendingPath(paths));
  if (!text.ok) return [];
  runtime.remove(pendingPath(paths));
  const ids = conceptsIn(text.value);
  recordConceptEvents(
    runtime,
    paths,
    ids.map((concept) => ({ concept, kind: "exposure", origin: "agent" })),
  );
  const before = readBook(runtime, paths);
  const after = ids.reduce((current, id) => raise(current, id, "seen", runtime.now()), before);
  const grew = levelSum(after) > levelSum(before);
  for (const id of ids.filter((item) => before.concepts[item] === undefined))
    recordHorizon(runtime, paths, { source: "concept", criterion: "none", domain: domainOf(id) });
  writeBook(
    runtime,
    paths,
    grew ? { ...after, baselineGreen: blueprintGreen(runtime, paths) ?? after.baselineGreen } : after,
  );
  return ids;
};

export const CONCEITOS_HANDLERS: HookHandlers = { Stop: [conceitosStop], PostToolUse: [teacherRecorder] };

import { relative } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { toPosixPath } from "../core/posix-path.js";
import type { Runtime } from "../core/runtime.js";
import { parseTranscript, type ToolUse } from "../history/transcript.js";

export interface StopFacts {
  readonly edited: readonly string[];
  readonly commandsAfterEdit: readonly string[];
  readonly finalText: string;
}

const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
const SHELL = new Set(["Bash", "PowerShell"]);

const pathOf = (tool: ToolUse): string | undefined => {
  const value = tool.input["file_path"] ?? tool.input["notebook_path"];
  return typeof value === "string" && value !== "" ? value : undefined;
};

const commandOf = (tool: ToolUse): string | undefined => {
  const value = tool.input["command"];
  return SHELL.has(tool.name) && typeof value === "string" ? value : undefined;
};

export const stopFacts = (
  runtime: Pick<Runtime, "readText">,
  root: AbsolutePath,
  transcript: string | undefined,
  lastMessage: string | undefined,
): StopFacts => {
  const text = transcript === undefined || transcript === "" ? undefined : runtime.readText(toAbsolutePath(transcript));
  const turn = text?.ok === true ? parseTranscript(text.value).at(-1) : undefined;
  const tools = turn?.tools ?? [];
  const lastEdit = tools.findLastIndex((tool) => EDIT_TOOLS.has(tool.name));
  return {
    edited: [
      ...new Set(
        tools.flatMap((tool) => {
          const path = EDIT_TOOLS.has(tool.name) ? pathOf(tool) : undefined;
          return path === undefined ? [] : [toPosixPath(relative(root, toAbsolutePath(path, root)))];
        }),
      ),
    ],
    commandsAfterEdit: tools.slice(lastEdit + 1).flatMap((tool) => {
      const command = commandOf(tool);
      return command === undefined ? [] : [command];
    }),
    finalText: lastMessage ?? turn?.finalText ?? "",
  };
};

const LANGUAGE_WORDS: Readonly<Record<string, ReadonlySet<string>>> = {
  en: new Set(["the", "and", "is", "are", "of", "with", "this", "that", "it", "you", "have", "be", "for", "was"]),
  "pt-BR": new Set([
    "não",
    "você",
    "isso",
    "uma",
    "também",
    "está",
    "os",
    "do",
    "da",
    "com",
    "mas",
    "são",
    "ao",
    "foi",
  ]),
  es: new Set(["el", "los", "las", "del", "esto", "usted", "también", "pero", "con", "una", "y", "es", "son", "fue"]),
};
const MIN_HITS = 3;
const MARGIN = 1.5;

export const detectLanguage = (text: string): string | undefined => {
  const words = text
    .toLowerCase()
    .replace(/```[\s\S]*?```|`[^`]*`/g, " ")
    .split(/[^\p{L}]+/u);
  const scores = Object.entries(LANGUAGE_WORDS)
    .map(([lang, set]) => [lang, words.filter((word) => set.has(word)).length] as const)
    .sort((left, right) => right[1] - left[1]);
  const [first, second] = scores;
  if (first === undefined || first[1] < MIN_HITS) return undefined;
  return second === undefined || first[1] >= second[1] * MARGIN ? first[0] : undefined;
};

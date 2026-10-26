import { isRecord, type JsonObject, parseJsonObject } from "../core/parsed.js";
import { isScript, type Runner } from "./hook-entries.js";
import { LOCAL_BIN, VENDOR_BIN } from "./layout.js";

export interface StatusLineAdded {
  readonly previous: unknown;
  readonly wrap: string | null;
}

const OWN = /finitemonkey(\.mjs|\.cmd|\.exe)?"?\s+statusline\s*$/;

const projectFile = (relative: string): string => relative;

const commandFor = (runner: Runner): string => {
  if (runner.kind === "local") return `node ${projectFile(LOCAL_BIN)} statusline`;
  if (runner.kind === "vendored") return `node ${projectFile(VENDOR_BIN)} statusline`;
  return isScript(runner.path) ? `node "${runner.path}" statusline` : `"${runner.path}" statusline`;
};

export const ownStatusLine = (runner: Runner): JsonObject => ({
  type: "command",
  command: commandFor(runner),
  padding: 0,
});

export const isOwnStatusLine = (value: unknown): boolean =>
  isRecord(value) && typeof value["command"] === "string" && OWN.test(value["command"]);

export const statusLineCommand = (value: unknown): string | undefined => {
  if (!isRecord(value) || isOwnStatusLine(value)) return undefined;
  const command = value["command"];
  return value["type"] === "command" && typeof command === "string" && command.trim() !== "" ? command : undefined;
};

export const statusLineIn = (text: string | undefined): unknown => {
  const parsed = text === undefined ? undefined : parseJsonObject(text);
  return parsed?.ok === true ? parsed.value["statusLine"] : undefined;
};

export const parseStatusLineAdded = (value: unknown): StatusLineAdded | undefined => {
  if (!isRecord(value) || !("previous" in value)) return undefined;
  const wrap = value["wrap"];
  return { previous: value["previous"], wrap: typeof wrap === "string" ? wrap : null };
};

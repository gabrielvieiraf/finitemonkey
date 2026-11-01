import type { JsonObject } from "../../core/parsed.js";
import { hostOfUrl, isLocal } from "../../git/destructive.js";
import { normalizeCommand } from "../../shell/normalize.js";
import type { ShellCommand } from "../../shell/types.js";

export interface RemoteCall {
  readonly tool: string;
  readonly input: JsonObject;
}

export interface HttpRequest {
  readonly method: string;
  readonly url: string;
  readonly body: string;
}

export const TARGET_LIMIT = 200;

const HTTP_CLIENTS = new Set(["curl", "wget", "http", "https", "xh", "xhs", "httpie"]);
const HTTP_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
export const WRITE_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH"]);
export const SCRIPT_RUNNERS: ReadonlySet<string> = new Set([
  "python",
  "python3",
  "node",
  "deno",
  "bun",
  "ruby",
  "tsx",
  "ts-node",
]);

const SCHEME = /^[a-z][\w+.-]*:\/\//i;
const CURL_BODY = ["-d", "--data", "--data-raw", "--data-binary", "--data-urlencode", "--json", "-F", "--form"];
const WGET_BODY = ["--post-data", "--post-file", "--body-data", "--body-file"];

export const textArg = (input: JsonObject, keys: readonly string[]): string | undefined => {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string") return value;
  }
  return undefined;
};

export const shellCommands = (call: RemoteCall): readonly ShellCommand[] => {
  if (call.tool !== "Bash" && call.tool !== "PowerShell") return [];
  const command = textArg(call.input, ["command"]);
  return command === undefined ? [] : normalizeCommand(command).commands;
};

export const flagValue = (args: readonly string[], names: readonly string[]): string | undefined => {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    for (const name of names) {
      if (arg === name) return args[index + 1];
      if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
      if (name === "-X" && arg.startsWith("-X") && arg.length > 2) return arg.slice(2);
    }
  }
  return undefined;
};

const httpieUrl = (value: string): string => {
  if (SCHEME.test(value)) return value;
  return value.startsWith(":") ? `http://localhost${value}` : `https://${value}`;
};

const curlMethod = (args: readonly string[], body: string | undefined): string => {
  const explicit = flagValue(args, ["-X", "--request"]);
  if (explicit !== undefined) return explicit;
  if (args.includes("-G") || args.includes("--get")) return "GET";
  if (args.includes("-I") || args.includes("--head")) return "HEAD";
  return body === undefined ? "GET" : "POST";
};

const wgetMethod = (args: readonly string[], body: string | undefined): string =>
  flagValue(args, ["--method"]) ?? (body === undefined ? "GET" : "POST");

const isDataItem = (arg: string): boolean => /^[^=:\s]+(?::=|=|@)/.test(arg) && !/^[^=\s]+==/.test(arg);

const httpieRequest = (positional: readonly string[]): HttpRequest => {
  const [first, second] = positional;
  const explicit = first !== undefined && HTTP_METHODS.has(first.toUpperCase());
  const target = (explicit ? second : first) ?? "";
  const items = positional.slice(explicit ? 2 : 1);
  const implied = items.some(isDataItem) ? "POST" : "GET";
  return { method: explicit ? first.toUpperCase() : implied, url: httpieUrl(target), body: items.join(" ") };
};

export const requestOf = (command: ShellCommand): HttpRequest | undefined => {
  if (!HTTP_CLIENTS.has(command.program)) return undefined;
  if (command.program === "curl" || command.program === "wget") {
    const curl = command.program === "curl";
    const body = flagValue(command.args, curl ? CURL_BODY : WGET_BODY);
    const method = curl ? curlMethod(command.args, body) : wgetMethod(command.args, body);
    const url = command.args.find((arg) => SCHEME.test(arg)) ?? "";
    return { method: method.toUpperCase(), url, body: body ?? "" };
  }
  return httpieRequest(command.args.filter((arg) => !arg.startsWith("-")));
};

export const remoteUrl = (url: string): boolean => {
  const host = hostOfUrl(url);
  return host !== undefined && !isLocal(host);
};

export const isGraphqlRead = (body: string): boolean =>
  /"query"\s*:\s*"\s*(?:query\b|\{)/.test(body) && !/\bmutation\b/.test(body);

export const httpRequests = (call: RemoteCall): readonly HttpRequest[] =>
  shellCommands(call).flatMap((command) => {
    const request = requestOf(command);
    return request === undefined ? [] : [request];
  });

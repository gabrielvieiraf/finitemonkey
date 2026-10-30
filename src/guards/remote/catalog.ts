import { isRecord, type JsonObject } from "../../core/parsed.js";
import { hostOfUrl, isLocal, SQL_DESTROY } from "../../git/destructive.js";
import { normalizeCommand } from "../../shell/normalize.js";
import type { ShellCommand } from "../../shell/types.js";

export type RemoteEffect = "read" | "write" | "destroy";

export interface RemoteCall {
  readonly tool: string;
  readonly input: JsonObject;
}

export interface CatalogEntry {
  readonly id: string;
  readonly effect: RemoteEffect;
  readonly match: (call: RemoteCall) => string | undefined;
  readonly positive: readonly RemoteCall[];
  readonly negative: readonly RemoteCall[];
}

export const DESTROY_VERBS: readonly string[] = [
  "delete",
  "drop",
  "remove",
  "purge",
  "destroy",
  "truncate",
  "terminate",
  "wipe",
  "erase",
];

const TARGET_KEYS = [
  "id",
  "user_id",
  "userId",
  "email",
  "name",
  "project_id",
  "projectId",
  "project_ref",
  "bucket",
  "key",
  "path",
  "url",
  "table",
  "database",
  "branch",
  "repo",
] as const;

const TARGET_LIMIT = 200;

export const methodOf = (tool: string): string => tool.slice(tool.lastIndexOf("__") + 2);

const targetOf = (call: RemoteCall): string => {
  const parts = TARGET_KEYS.flatMap((key) => {
    const value = call.input[key];
    return typeof value === "string" || typeof value === "number" ? [`${key}=${String(value)}`] : [];
  });
  return `${call.tool}${parts.length === 0 ? "" : ` ${parts.join(" ")}`}`.slice(0, TARGET_LIMIT);
};

const mcpMethod =
  (pattern: RegExp) =>
  (call: RemoteCall): string | undefined =>
    call.tool.startsWith("mcp__") && pattern.test(methodOf(call.tool)) ? targetOf(call) : undefined;

const textArg = (input: JsonObject, keys: readonly string[]): string | undefined => {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string") return value;
  }
  return undefined;
};

const sqlDestroy = (call: RemoteCall): string | undefined => {
  if (!call.tool.startsWith("mcp__") || !/^(?:execute|run|exec)_(?:sql|query)$|^query$/.test(methodOf(call.tool))) {
    return undefined;
  }
  const statement = textArg(call.input, ["query", "sql", "statement"]) ?? "";
  const match = SQL_DESTROY.exec(statement);
  return match === null ? undefined : `${call.tool} ${match[0].trim()}`.slice(0, TARGET_LIMIT);
};

const mcpFetchDelete = (call: RemoteCall): string | undefined => {
  if (!call.tool.startsWith("mcp__")) return undefined;
  const method = textArg(call.input, ["method"]);
  const url = textArg(call.input, ["url", "uri", "endpoint"]);
  if (method?.toUpperCase() !== "DELETE" || url === undefined) return undefined;
  const host = hostOfUrl(url);
  return host === undefined || isLocal(host) ? undefined : url.slice(0, TARGET_LIMIT);
};

const HTTP_CLIENTS = new Set(["curl", "wget", "http", "https", "xh", "xhs", "httpie"]);
const HTTP_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const SCRIPT_RUNNERS = new Set(["python", "python3", "node", "deno", "bun", "ruby"]);

const shellCommands = (call: RemoteCall): readonly ShellCommand[] => {
  if (call.tool !== "Bash" && call.tool !== "PowerShell") return [];
  const command = textArg(call.input, ["command"]);
  return command === undefined ? [] : normalizeCommand(command).commands;
};

const flagValue = (args: readonly string[], names: readonly string[]): string | undefined => {
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

interface HttpRequest {
  readonly method: string;
  readonly url: string;
  readonly body: string;
}

const httpieUrl = (value: string): string => {
  if (/^[a-z][\w+.-]*:\/\//i.test(value)) return value;
  return value.startsWith(":") ? `http://localhost${value}` : `https://${value}`;
};

const requestOf = (command: ShellCommand): HttpRequest | undefined => {
  if (!HTTP_CLIENTS.has(command.program)) return undefined;
  const positional = command.args.filter((arg) => !arg.startsWith("-"));
  if (command.program === "curl" || command.program === "wget") {
    const method = flagValue(command.args, command.program === "curl" ? ["-X", "--request"] : ["--method"]) ?? "GET";
    const url = command.args.find((arg) => /^[a-z][\w+.-]*:\/\//i.test(arg)) ?? "";
    const body = flagValue(command.args, ["-d", "--data", "--data-raw", "--data-binary", "--json", "--body-data"]);
    return { method: method.toUpperCase(), url, body: body ?? "" };
  }
  const [first, second] = positional;
  const explicit = first !== undefined && HTTP_METHODS.has(first.toUpperCase());
  const target = (explicit ? second : first) ?? "";
  return {
    method: explicit ? first.toUpperCase() : "GET",
    url: httpieUrl(target),
    body: positional.slice(explicit ? 2 : 1).join(" "),
  };
};

const remoteUrl = (url: string): boolean => {
  const host = hostOfUrl(url);
  return host !== undefined && !isLocal(host);
};

const httpDelete = (call: RemoteCall): string | undefined =>
  shellCommands(call)
    .map(requestOf)
    .find((request) => request?.method === "DELETE" && remoteUrl(request.url))?.url;

const GRAPHQL_DESTROY = new RegExp(`\\bmutation\\b[^]*?\\b((?:${DESTROY_VERBS.join("|")})[A-Z_]\\w*)`, "i");

const graphqlDestroy = (call: RemoteCall): string | undefined => {
  for (const request of shellCommands(call).map(requestOf)) {
    if (request === undefined || !remoteUrl(request.url)) continue;
    const field = GRAPHQL_DESTROY.exec(request.body)?.[1];
    if (field !== undefined) return `${request.url} ${field}`.slice(0, TARGET_LIMIT);
  }
  return undefined;
};

const SCRIPT_DELETE = /\.delete\(\s*[`'"](https?:\/\/[^`'"]+)|method\s*[:=]\s*[`'"]DELETE[`'"]/i;
const SCRIPT_URL = /https?:\/\/[^\s'"`)]+/;

const scriptDelete = (call: RemoteCall): string | undefined => {
  for (const command of shellCommands(call)) {
    if (!SCRIPT_RUNNERS.has(command.program)) continue;
    const code = flagValue(command.args, ["-c", "-e", "--eval"]) ?? "";
    const match = SCRIPT_DELETE.exec(code);
    const url = match?.[1] ?? (match === null ? undefined : SCRIPT_URL.exec(code)?.[0]);
    if (url !== undefined && remoteUrl(url)) return url;
  }
  return undefined;
};

const mcp = (tool: string, input: JsonObject = {}): RemoteCall => ({ tool, input });
const bash = (command: string): RemoteCall => ({ tool: "Bash", input: { command } });

export const CATALOG: readonly CatalogEntry[] = [
  {
    id: "mcp-accounts-delete",
    effect: "destroy",
    match: mcpMethod(/^(?:delete|remove|ban|purge)_(?:auth_)?(?:users?|accounts?|members?|customers?|subscribers?)$/),
    positive: [mcp("mcp__auth__delete_user", { user_id: "u1" }), mcp("mcp__stripe__delete_customer", { id: "cus_1" })],
    negative: [mcp("mcp__auth__list_users"), mcp("mcp__auth__list_deleted_users"), mcp("mcp__auth__get_user")],
  },
  {
    id: "mcp-storage-delete",
    effect: "destroy",
    match: mcpMethod(
      /^(?:delete|empty|purge|remove)_(?:buckets?|objects?|files?|blobs?|volumes?|disks?|snapshots?|backups?)$/,
    ),
    positive: [mcp("mcp__aws__delete_bucket", { bucket: "prod-assets" }), mcp("mcp__s3__empty_bucket")],
    negative: [mcp("mcp__aws__list_buckets"), mcp("mcp__s3__get_object", { key: "a" })],
  },
  {
    id: "mcp-infra-delete",
    effect: "destroy",
    match: mcpMethod(
      /^(?:delete|drop|destroy|terminate|reset|pause)_(?:projects?|databases?|db|branch(?:es)?|instances?|clusters?|services?|apps?|deployments?|environments?|tables?|schemas?|repositor(?:y|ies)|repos?)$/,
    ),
    positive: [mcp("mcp__supabase__delete_branch", { branch: "main" }), mcp("mcp__github__delete_repository")],
    negative: [mcp("mcp__supabase__list_branches"), mcp("mcp__github__create_repository")],
  },
  {
    id: "mcp-sql-destroy",
    effect: "destroy",
    match: sqlDestroy,
    positive: [mcp("mcp__postgres__execute_sql", { query: "DROP TABLE users" })],
    negative: [
      mcp("mcp__postgres__execute_sql", { query: "select * from users" }),
      mcp("mcp__postgres__execute_sql", { query: "delete from users where id = 2" }),
    ],
  },
  {
    id: "mcp-fetch-delete",
    effect: "destroy",
    match: mcpFetchDelete,
    positive: [mcp("mcp__fetch__fetch", { url: "https://api.example.com/v1/users/7", method: "DELETE" })],
    negative: [
      mcp("mcp__fetch__fetch", { url: "https://api.example.com/v1/users/7" }),
      mcp("mcp__fetch__fetch", { url: "http://localhost:3000/users/7", method: "DELETE" }),
    ],
  },
  {
    id: "http-delete",
    effect: "destroy",
    match: httpDelete,
    positive: [
      bash("curl -X DELETE https://api.example.com/v1/volumes/vol-1"),
      bash("curl --request=DELETE -H 'Authorization: Bearer $T' https://api.example.com/users/9"),
      bash("http DELETE api.example.com/users/9"),
    ],
    negative: [
      bash("curl -X DELETE http://localhost:8080/users/9"),
      bash("curl https://api.example.com/v1/volumes"),
      bash("http DELETE :3000/users/9"),
    ],
  },
  {
    id: "graphql-destroy",
    effect: "destroy",
    match: graphqlDestroy,
    positive: [bash(`curl https://api.example.com/graphql -d '{"query":"mutation { deleteUser(id: 4) { id } }"}'`)],
    negative: [
      bash(`curl https://api.example.com/graphql -d '{"query":"query { deletedUsers { id } }"}'`),
      bash(`curl http://localhost:4000/graphql -d '{"query":"mutation { deleteUser(id: 4) { id } }"}'`),
    ],
  },
  {
    id: "script-delete",
    effect: "destroy",
    match: scriptDelete,
    positive: [bash(`python3 -c "import requests; requests.delete('https://api.example.com/users/1')"`)],
    negative: [
      bash(`python3 -c "import requests; requests.get('https://api.example.com/users/1')"`),
      bash(`node -e "require('axios').delete('http://localhost:3000/x')"`),
    ],
  },
  {
    id: "mcp-read",
    effect: "read",
    match: mcpMethod(/^(?:list|get|read|search|describe|show|fetch|find|count|query_|inspect|view)/),
    positive: [mcp("mcp__auth__list_users"), mcp("mcp__db__list_deleted_rows")],
    negative: [mcp("mcp__auth__delete_user")],
  },
  {
    id: "mcp-write",
    effect: "write",
    match: mcpMethod(/^(?:create|update|put|insert|add|set|upsert|patch|send|post|rename|move)_/),
    positive: [mcp("mcp__github__create_issue"), mcp("mcp__notion__update_page")],
    negative: [mcp("mcp__github__delete_branch")],
  },
];

export const hasDestroyVerb = (method: string): boolean =>
  method
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((word) => DESTROY_VERBS.includes(word));

export const callOf = (tool: string, input: unknown): RemoteCall => ({ tool, input: isRecord(input) ? input : {} });

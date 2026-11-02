import { isRecord, type JsonObject } from "../../core/parsed.js";
import { hostOfUrl, isLocal, SQL_DESTROY } from "../../git/destructive.js";
import { codeCall, type CodeEffect } from "./code.js";
import {
  flagValue,
  httpRequests,
  isGraphqlRead,
  type RemoteCall,
  remoteUrl,
  SCRIPT_RUNNERS,
  shellCommands,
  TARGET_LIMIT,
  textArg,
  WRITE_METHODS,
} from "./http.js";

export type { RemoteCall } from "./http.js";

export type RemoteEffect = "read" | "write" | "destroy";

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

const sqlDestroy = (call: RemoteCall): string | undefined => {
  if (!call.tool.startsWith("mcp__") || !/^(?:execute|run|exec)_(?:sql|query)$|^query$/.test(methodOf(call.tool))) {
    return undefined;
  }
  const statement = textArg(call.input, ["query", "sql", "statement"]) ?? "";
  const match = SQL_DESTROY.exec(statement);
  return match === null ? undefined : `${call.tool} ${match[0].trim()}`.slice(0, TARGET_LIMIT);
};

const mcpFetch =
  (methods: ReadonlySet<string>) =>
  (call: RemoteCall): string | undefined => {
    if (!call.tool.startsWith("mcp__")) return undefined;
    const method = textArg(call.input, ["method"])?.toUpperCase() ?? "GET";
    const url = textArg(call.input, ["url", "uri", "endpoint"]);
    if (!methods.has(method) || url === undefined) return undefined;
    const host = hostOfUrl(url);
    return host === undefined || isLocal(host) ? undefined : url.slice(0, TARGET_LIMIT);
  };

const DELETE_METHOD: ReadonlySet<string> = new Set(["DELETE"]);

const httpDelete = (call: RemoteCall): string | undefined =>
  httpRequests(call).find((request) => request.method === "DELETE" && remoteUrl(request.url))?.url;

const httpWrite = (call: RemoteCall): string | undefined => {
  const found = httpRequests(call).find(
    (request) => WRITE_METHODS.has(request.method) && remoteUrl(request.url) && !isGraphqlRead(request.body),
  );
  return found === undefined ? undefined : `${found.method} ${found.url}`.slice(0, TARGET_LIMIT);
};

const GRAPHQL_DESTROY = new RegExp(`\\bmutation\\b[^]*?\\b((?:${DESTROY_VERBS.join("|")})[A-Z_]\\w*)`, "i");

const graphqlDestroy = (call: RemoteCall): string | undefined => {
  for (const request of httpRequests(call)) {
    if (!remoteUrl(request.url)) continue;
    const field = GRAPHQL_DESTROY.exec(request.body)?.[1];
    if (field !== undefined) return `${request.url} ${field}`.slice(0, TARGET_LIMIT);
  }
  return undefined;
};

const inlineCode =
  (effect: CodeEffect) =>
  (call: RemoteCall): string | undefined => {
    for (const command of shellCommands(call)) {
      if (!SCRIPT_RUNNERS.has(command.program)) continue;
      const found = codeCall(flagValue(command.args, ["-c", "-e", "--eval"]) ?? "");
      if (found?.effect === effect) return found.url.slice(0, TARGET_LIMIT);
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
    match: mcpFetch(DELETE_METHOD),
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
    match: inlineCode("destroy"),
    positive: [bash(`python3 -c "import requests; requests.delete('https://api.example.com/users/1')"`)],
    negative: [
      bash(`python3 -c "import requests; requests.get('https://api.example.com/users/1')"`),
      bash(`node -e "require('axios').delete('http://localhost:3000/x')"`),
    ],
  },
  {
    id: "mcp-fetch-write",
    effect: "write",
    match: mcpFetch(WRITE_METHODS),
    positive: [mcp("mcp__fetch__fetch", { url: "https://api.example.com/v1/orders", method: "POST" })],
    negative: [
      mcp("mcp__fetch__fetch", { url: "https://api.example.com/v1/orders" }),
      mcp("mcp__fetch__fetch", { url: "http://localhost:3000/orders", method: "POST" }),
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
    match: mcpMethod(/^(?:create|update|put|insert|add|set|upsert|patch|send|post|publish|rename|move)_/),
    positive: [mcp("mcp__github__create_issue"), mcp("mcp__notion__update_page"), mcp("mcp__gmail__send_email")],
    negative: [mcp("mcp__github__delete_branch")],
  },
  {
    id: "http-write",
    effect: "write",
    match: httpWrite,
    positive: [
      bash("curl -X POST https://api.example.com/v1/orders -d '{}'"),
      bash("curl https://hooks.example.com/notify -d 'text=hi'"),
      bash("http PATCH api.example.com/users/9 name=ana"),
      bash("wget --post-data 'a=1' https://api.example.com/form"),
    ],
    negative: [
      bash("curl https://api.example.com/v1/orders"),
      bash("curl -X POST http://localhost:8080/orders -d '{}'"),
      bash(`curl https://api.example.com/graphql -d '{"query":"query { orders { id } }"}'`),
      bash("http api.example.com/users q==ana"),
    ],
  },
  {
    id: "script-write",
    effect: "write",
    match: inlineCode("write"),
    positive: [bash(`python3 -c "import requests; requests.post('https://api.example.com/orders', json={})"`)],
    negative: [
      bash(`python3 -c "import requests; requests.get('https://api.example.com/orders')"`),
      bash(`node -e "require('axios').post('http://localhost:3000/x', {})"`),
    ],
  },
];

export const WRITE_VERBS: readonly string[] = ["create", "update", "send", "post", "insert", "upsert", "publish"];

const wordsOf = (method: string): readonly string[] =>
  method
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z]+/);

export const hasDestroyVerb = (method: string): boolean => wordsOf(method).some((word) => DESTROY_VERBS.includes(word));

export const hasWriteVerb = (method: string): boolean => wordsOf(method).some((word) => WRITE_VERBS.includes(word));

export const callOf = (tool: string, input: unknown): RemoteCall => ({ tool, input: isRecord(input) ? input : {} });

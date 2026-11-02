import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { accept, type Parsed, reject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { configAt, type ConfigTree } from "../git/project-config.js";
import { uiHash } from "../look/contract.js";
import type { FmPaths } from "../task/paths.js";
import { readTrust, writeTrust } from "../task/state.js";
import { type AccessConfig, LOCALHOST, type Resource, scenariosFor } from "./plan.js";

export const TWO_TENANT_FILE = "two-tenant.test.mjs";
export const TWO_TENANT_LOCK = "scenarios-test#two-tenant";
export const DEFAULT_TEST_PATH = "test/two-tenant.test.mjs";

export const proposalPath = (paths: FmPaths): AbsolutePath =>
  toAbsolutePath(join(paths.dir, "scenarios", TWO_TENANT_FILE));

export const testPath = (tree: ConfigTree, root: AbsolutePath): AbsolutePath => {
  const value = configAt(tree, "access", "test_path");
  const relative = typeof value === "string" && value.trim() !== "" ? value.trim() : DEFAULT_TEST_PATH;
  return toAbsolutePath(join(root, relative));
};

const HELPERS = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  "",
  "const base = process.env.FINITEMONKEY_BASE_URL ?? __BASE__;",
  "const header = (line) => {",
  '  const colon = (line ?? "").indexOf(":");',
  "  return colon > 0 ? { [line.slice(0, colon).trim().toLowerCase()]: line.slice(colon + 1).trim() } : {};",
  "};",
  "const users = { A: header(process.env.FINITEMONKEY_USER_A), B: header(process.env.FINITEMONKEY_USER_B), anonymous: {} };",
  "const ready = Object.keys(users.A).length > 0 && Object.keys(users.B).length > 0;",
  'const http = globalThis["fetch"];',
  "const send = (method, path, actor, body) =>",
  "  http(`${base}${path}`, {",
  "    method,",
  '    headers: { ...users[actor], ...(body === undefined ? {} : { "content-type": "application/json" }) },',
  "    ...(body === undefined ? {} : { body }),",
  '    redirect: "manual",',
  "  });",
  "const ok = (status) => status >= 200 && status < 300;",
  "",
];

const block = (resource: Resource, config: AccessConfig): readonly string[] => {
  const steps = scenariosFor(resource).map((scenario) => {
    const body = scenario.method === "put" || scenario.method === "patch" ? ", seed" : "";
    const expectation = scenario.allowed ? "ok(answer.status)" : "!ok(answer.status)";
    return [
      `  answer = await send(${JSON.stringify(scenario.method.toUpperCase())}, item, ${JSON.stringify(scenario.actor)}${body});`,
      `  assert.ok(${expectation}, ${JSON.stringify(`${scenario.id}: status `)} + answer.status);`,
    ].join("\n");
  });
  return [
    `test(${JSON.stringify(`two tenants: ${resource.name}`)}, { skip: !ready && "set FINITEMONKEY_USER_A and FINITEMONKEY_USER_B" }, async () => {`,
    `  const seed = ${JSON.stringify(config.body)};`,
    `  const created = await send("POST", ${JSON.stringify(resource.collection)}, "A", seed);`,
    "  assert.ok(ok(created.status), `create as A: status ${created.status}`);",
    `  const id = String((await created.json())[${JSON.stringify(config.idField)}]);`,
    `  const item = ${JSON.stringify(resource.item)}.replace(/(?::[A-Za-z_][A-Za-z0-9_]*|\\{[A-Za-z_][A-Za-z0-9_]*\\})(\\/?)$/, \`\${encodeURIComponent(id)}$1\`);`,
    "  let answer;",
    ...steps,
    "});",
    "",
  ];
};

export const twoTenantTest = (resources: readonly Resource[], config: AccessConfig): string =>
  [
    ...HELPERS.map((line) => line.replace("__BASE__", JSON.stringify(`http://${LOCALHOST}:${String(config.port)}`))),
    ...resources.flatMap((resource) => block(resource, config)),
  ].join("\n");

export const proposeTwoTenant = (
  runtime: Pick<Runtime, "writeText" | "mkdir">,
  paths: FmPaths,
  source: string,
): Parsed<string> => {
  runtime.mkdir(toAbsolutePath(join(paths.dir, "scenarios")));
  const wrote = runtime.writeText(proposalPath(paths), source);
  return wrote.ok ? accept(uiHash(source)) : reject(wrote.error);
};

export const approveTwoTenant = (
  runtime: Pick<Runtime, "readText" | "writeText" | "mkdir">,
  paths: FmPaths,
  target: AbsolutePath,
  hash: string | undefined,
): Parsed<string, "missing" | "hash" | "write"> => {
  const source = runtime.readText(proposalPath(paths));
  if (!source.ok) return reject("missing");
  if (hash !== undefined && hash !== uiHash(source.value)) return reject("hash");
  runtime.mkdir(toAbsolutePath(join(target, "..")));
  if (!runtime.writeText(target, source.value).ok) return reject("write");
  const lock = readTrust(runtime, paths);
  const saved = writeTrust(runtime, paths, {
    ...lock,
    approved: { ...lock.approved, [TWO_TENANT_LOCK]: source.value },
  });
  return saved.ok ? accept(uiHash(source.value)) : reject("write");
};

import assert from "node:assert/strict";
import { cpSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { format } from "prettier";
import type * as Typescript from "typescript";

import { detectProject } from "../src/apicontract/framework.js";
import { contractCoverage, loadRegistry } from "../src/apicontract/load.js";
import type { AbsolutePath } from "../src/core/brand.js";
import { nodeRuntime } from "../src/core/node-runtime.js";
import { loadTypescript } from "../src/quality/ts-api.js";
import { tempDir } from "./git-support.js";
import { cliJson, field, ROOT } from "./support.js";

const loaded = loadTypescript(ROOT);
if (loaded === undefined) throw new Error("typescript is a dev dependency");
const ts: typeof Typescript = loaded;
const FIXTURES = join(ROOT, "test", "fixtures", "apicontract");
const runtime = nodeRuntime();
const dirs: string[] = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const fixture = (name: string) => {
  const dir = tempDir("fm-api-");
  dirs.push(dir);
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  const handlers = join(dir, "src", "mocks", "handlers");
  for (const file of readdirSync(handlers)) {
    renameSync(join(handlers, file), join(handlers, file.replace(/\.fixture$/, "")));
  }
  return dir;
};

const kindsIn = (name: string): readonly string[] => {
  const dir = fixture(name);
  const registry = loadRegistry(runtime, dir);
  if (registry.kind !== "ok") throw new Error(`${name}: ${registry.kind}`);
  return contractCoverage(runtime, dir, registry.registry).map((problem) => problem.kind);
};

const project = async (packageJson: string): Promise<AbsolutePath> => {
  const dir = tempDir("fm-api-gen-");
  dirs.push(dir);
  writeFileSync(join(dir, "package.json"), packageJson);
  mkdirSync(join(dir, "api"));
  writeFileSync(join(dir, "api", "contract.yml"), readFileSync(join(FIXTURES, "base.yml")));
  for (const argv of [
    ["contract", "--write"],
    ["contract", "mocks", "--write"],
  ]) {
    const run = await cliJson(argv, { cwd: dir, runtime });
    assert.equal(run.code, 0, run.stdout);
  }
  return dir;
};

const generatedFiles = (dir: string, base: string): readonly string[] =>
  ["api", "mocks", "mocks/handlers"].flatMap((sub) =>
    readdirSync(join(dir, base, sub))
      .filter((file) => file.endsWith(".ts"))
      .map((file) => join(dir, base, sub, file)),
  );

const MSW_STUB = [
  'declare module "msw" {',
  "  interface Info { method: string; path: string }",
  "  interface HttpHandler { info: Info }",
  "  type Resolver = (args: { request: Request; params: Record<string, string | readonly string[] | undefined> }) =>",
  "    Response | Promise<Response>;",
  "  export const http: Record<'get' | 'post' | 'put' | 'patch' | 'delete', (path: string, resolver: Resolver) => HttpHandler>;",
  "}",
  'declare module "vitest" {',
  "  export const test: (name: string, run: () => void) => void;",
  "}",
  'declare module "msw/browser" {',
  "  export const setupWorker: (...handlers: unknown[]) => { start: () => Promise<void> };",
  "}",
  "",
].join("\n");

const typeErrors = (dir: string, files: readonly string[]): readonly string[] => {
  const stub = join(dir, "msw.d.ts");
  writeFileSync(stub, MSW_STUB);
  const program = ts.createProgram([...files, stub], {
    strict: true,
    noUncheckedIndexedAccess: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
    types: ["node"],
    typeRoots: [join(ROOT, "node_modules", "@types")],
    skipLibCheck: true,
  });
  return ts
    .getPreEmitDiagnostics(program)
    .map((item) => `${item.file?.fileName ?? ""}: ${ts.flattenDiagnosticMessageText(item.messageText, "\n")}`);
};

const runnable = async (dir: string) => {
  const out = join(dir, "js");
  for (const file of [
    "api/registry",
    "api/errors",
    "api/validate",
    "api/client",
    "mocks/seed",
    "mocks/store",
    "mocks/respond",
  ]) {
    const source = readFileSync(join(dir, "src", `${file}.ts`), "utf8");
    const js = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const target = join(out, `${file}.mjs`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, js.replace(/from "(\.{1,2}\/[^"]+)"/g, 'from "$1.mjs"'));
  }
  const respond: unknown = await import(pathToFileURL(join(out, "mocks/respond.mjs")).href);
  const client: unknown = await import(pathToFileURL(join(out, "api/client.mjs")).href);
  return { respond, client };
};

type Respond = (id: string, request: Request, params: Record<string, string>) => Promise<Response>;
type CallApi = (id: string, input: Record<string, unknown>) => Promise<unknown>;

const isFunction = (value: unknown): value is (...args: never[]) => unknown => typeof value === "function";

describe("API contract, mocks and coverage", () => {
  for (const [name, kind] of [
    ["no_mock", "no_mock"],
    ["outside", "outside"],
    ["duplicate_handler", "duplicate_handler"],
    ["repeated_route", "repeated_route"],
  ] as const) {
    it(`reports ${kind} from its fixture`, () => {
      assert.deepEqual(kindsIn(name), [kind]);
    });
  }

  it("generates files that prettier keeps and strict TypeScript accepts", async () => {
    const dir = await project('{ "devDependencies": { "vite": "6.0.0", "vitest": "3.0.0" } }\n');
    const files = generatedFiles(dir, "src");
    assert.equal(files.length, 12);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      assert.equal(await format(text, { parser: "typescript" }), text, file);
    }
    assert.deepEqual(typeErrors(dir, files), []);
    const gate = await cliJson(["contract", "coverage"], { cwd: dir, runtime });
    assert.equal(gate.code, 0, gate.stdout);
  });

  it("answers every endpoint from the mocks, so the app runs without a backend", async () => {
    const dir = await project('{ "devDependencies": { "vite": "6.0.0" } }\n');
    const { respond, client } = await runnable(dir);
    const respondFn = field(respond, "respond");
    const callFn = field(client, "callApi");
    assert.ok(isFunction(respondFn) && isFunction(callFn));
    const answer = respondFn as unknown as Respond;
    const call = callFn as unknown as CallApi;
    const routes: readonly [string, string, RegExp][] = [
      ["GET", "listOrders", /^\/api\/orders(\?.*)?$/],
      ["GET", "getOrder", /^\/api\/orders\/([^/?]+)/],
      ["POST", "createUser", /^\/api\/users/],
    ];
    const original = globalThis.fetch;
    globalThis.fetch = (url, init) => {
      const path = url instanceof Request ? url.url : url.toString();
      const route = routes.find(([method, , pattern]) => method === (init?.method ?? "GET") && pattern.test(path));
      const id = route?.[2].exec(path)?.[1];
      const request = new Request(`http://localhost${path}`, init);
      return answer(route?.[1] ?? "", request, id === undefined || route?.[1] !== "getOrder" ? {} : { id });
    };
    try {
      const list = await call("listOrders", {});
      assert.equal(field(list, "ok"), true);
      assert.equal((field(list, "data") as unknown[]).length, 3);
      assert.equal(field(await call("getOrder", { id: "id-2" }), "data", "id"), "id-2");
      const created = await call("createUser", { name: "Ana" });
      assert.equal(field(created, "data", "name"), "Ana");
      const empty = await answer("listOrders", new Request("http://localhost/api/orders?mock=empty"), {});
      assert.deepEqual(await empty.json(), []);
      const missing = await answer("getOrder", new Request("http://localhost/api/orders/x?mock=NOT_FOUND"), {});
      assert.equal(missing.status, 404);
      assert.deepEqual(await missing.json(), { error: { code: "NOT_FOUND", message: "mocked NOT_FOUND" } });
      const unknown = await answer("listOrders", new Request("http://localhost/api/orders?mock=TEAPOT"), {});
      assert.equal(unknown.status, 200);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("places files for Vite, Next and Remix projects", () => {
    const at = (json: string, has: readonly string[] = []) =>
      detectProject(
        (file) => (file === "package.json" ? json : undefined),
        (file) => has.includes(file),
      );
    assert.deepEqual(at('{ "dependencies": { "vite": "6" } }'), { framework: "vite", base: "src", runner: "node" });
    assert.deepEqual(at('{ "dependencies": { "next": "15" }, "devDependencies": { "jest": "29" } }'), {
      framework: "next",
      base: "lib",
      runner: "jest",
    });
    assert.equal(at('{ "dependencies": { "next": "15" } }', ["src"]).base, "src");
    assert.deepEqual(at('{ "dependencies": { "@remix-run/react": "2" } }'), {
      framework: "remix",
      base: "app",
      runner: "node",
    });
  });
});

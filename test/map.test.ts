import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import type { ExecRequest, Runtime } from "../src/core/runtime.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, execResult, field, found, missing } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const app = (extra: Readonly<Record<string, string>> = {}): Repo => {
  const made = makeRepo({
    "src/pages/home.tsx": "export function Home() { return null; }\n",
    "src/lib/money.js": "export function formatMoney(value) { return value; }\nexport const CENTS = 100;\n",
    "src/utils/date.ts": "export const parseDate = (text: string) => text;\nfunction inner() {}\n",
    "server/main.go": "package main\n\nfunc Serve() {}\n",
    "src/lib/money.test.js": "export function testOnly() {}\n",
    "test/helpers.js": "export function helper() {}\n",
    "dist/bundle.js": "export function bundled() {}\n",
    ...extra,
  });
  repos.push(made);
  return made;
};

interface Counted {
  readonly runtime: Runtime;
  readonly greps: () => number;
}

const counting = (base: Runtime): Counted => {
  let greps = 0;
  return {
    runtime: {
      ...base,
      exec: (request: ExecRequest) => {
        if (request.command === "git" && request.args.includes("grep")) greps += 1;
        return base.exec(request);
      },
    },
    greps: () => greps,
  };
};

const withoutAstGrep = (base: Runtime): Runtime => ({
  ...base,
  probe: (command, args, timeoutMs) => (command === "ast-grep" ? missing : base.probe(command, args, timeoutMs)),
});

const textOf = (body: Record<string, unknown>): string => String(field(body, "data", "text"));

describe("finitemonkey map", () => {
  it("lists shared folders first, without tests or generated code", async () => {
    const repo = app();
    const { code, body } = await cliJson(["map"], { cwd: repo.root, runtime: withoutAstGrep(repoRuntime()) });
    assert.equal(code, 0);
    assert.equal(field(body, "data", "source"), "git-grep");
    assert.deepEqual(textOf(body).split("\n"), [
      "src/lib: CENTS, formatMoney",
      "src/utils: inner, parseDate",
      "server: Serve",
      "src/pages: Home",
    ]);
  });

  it("reads the cache on a second run of the same tree and rebuilds after a change", async () => {
    const repo = app();
    const counted = counting(withoutAstGrep(repoRuntime()));
    const first = await cliJson(["map"], { cwd: repo.root, runtime: counted.runtime });
    assert.equal(field(first.body, "data", "cached"), false);
    const greps = counted.greps();
    assert.ok(greps > 0);
    const second = await cliJson(["map"], { cwd: repo.root, runtime: counted.runtime });
    assert.equal(field(second.body, "data", "cached"), true);
    assert.equal(counted.greps(), greps);
    assert.equal(textOf(second.body), textOf(first.body));
    assert.match(repo.read(".finitemonkey/map.txt"), /^# finitemonkey map tree=w[0-9a-f]+ budget=4000 /);
    repo.write("src/lib/tax.js", "export function addTax(value) { return value; }\n");
    const third = await cliJson(["map"], { cwd: repo.root, runtime: counted.runtime });
    assert.equal(field(third.body, "data", "cached"), false);
    assert.match(textOf(third.body), /^src\/lib: addTax, CENTS, formatMoney$/m);
  });

  it("stays within the character budget from the flag or from config.yml", async () => {
    const folders = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [
        `src/feature${String(index).padStart(2, "0")}/index.ts`,
        `export const someLongDefinitionName${String(index)} = 1;\nexport const anotherLongDefinitionName = 2;\n`,
      ]),
    );
    const repo = app(folders);
    const flag = await cliJson(["map", "--budget", "300"], { cwd: repo.root, runtime: withoutAstGrep(repoRuntime()) });
    assert.ok(textOf(flag.body).length <= 300, textOf(flag.body));
    assert.match(textOf(flag.body), /… \d+ more folders$/);
    repo.write(".finitemonkey/config.yml", "map:\n  budget: 500\n");
    const config = await cliJson(["map"], { cwd: repo.root, runtime: withoutAstGrep(repoRuntime()) });
    assert.equal(field(config.body, "data", "budget"), 500);
    assert.ok(textOf(config.body).length <= 500);
    assert.ok(textOf(config.body).length > 300);
  });

  it("uses ast-grep when installed, keeps top-level matches only and still greps other languages", async () => {
    const repo = app();
    const base = repoRuntime();
    const calls: string[][] = [];
    const match = (file: string, name: string, column: number): string =>
      JSON.stringify({ file, range: { start: { line: 0, column } }, metaVariables: { single: { N: { text: name } } } });
    const runtime: Runtime = {
      ...base,
      probe: (command, args, timeoutMs) =>
        command === "ast-grep" ? found("ast-grep 0.51.0") : base.probe(command, args, timeoutMs),
      exec: (request) => {
        if (request.command !== "ast-grep") return base.exec(request);
        calls.push([...request.args]);
        const ts = request.args.includes("ts") && request.args.includes("export const $N = $V");
        return execResult(
          0,
          ts ? `${match("src/utils/date.ts", "fromAst", 0)}\n${match("src/utils/date.ts", "nested", 4)}\n` : "",
        );
      },
    };
    const { body } = await cliJson(["map"], { cwd: repo.root, runtime });
    assert.equal(field(body, "data", "source"), "ast-grep");
    assert.ok(calls.length > 0);
    assert.deepEqual(textOf(body).split("\n"), ["src/utils: fromAst", "server: Serve"]);
  });
});

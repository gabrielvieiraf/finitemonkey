import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { nodeRuntime } from "../src/core/node-runtime.js";
import { buildDerived, readDerived } from "../src/knowledge/derived.js";
import { MAP_GENERATOR } from "../src/map/build.js";
import { fmPaths } from "../src/task/paths.js";
import { type TempRepo, tempRepo } from "./git-support.js";
import { repoRuntime } from "./repo.js";
import { cliJson } from "./support.js";

const repos: TempRepo[] = [];
after(() => {
  for (const repo of repos) repo.dispose();
});

const project = (): TempRepo => {
  const repo = tempRepo({ "src/money.ts": "export function total(): number {\n  return 1;\n}\n" });
  repos.push(repo);
  return repo;
};

describe("generated text is a cache keyed by its inputs", () => {
  it("rebuilds a derived file when an input hash changes and not otherwise", () => {
    const repo = project();
    const paths = fmPaths(repo.root);
    let renders = 0;
    const spec = (input: string) => ({
      file: ".finitemonkey/summary.txt",
      generator: "toy",
      inputs: { "src/money.ts": input },
      sources: ["src/money.ts"],
      render: () => {
        renders += 1;
        return `summary ${input}\n`;
      },
    });
    assert.equal(buildDerived(nodeRuntime(), paths, spec("h1")).kind, "built");
    assert.equal(buildDerived(nodeRuntime(), paths, spec("h1")).kind, "fresh");
    assert.equal(renders, 1);
    assert.equal(buildDerived(nodeRuntime(), paths, spec("h2")).kind, "built");
    assert.equal(renders, 2);
  });

  it("refuses a generator that reads a derived file, and no shipped generator does", () => {
    const repo = project();
    const paths = fmPaths(repo.root);
    buildDerived(nodeRuntime(), paths, {
      file: ".finitemonkey/summary.txt",
      generator: "toy",
      inputs: { a: "1" },
      sources: [],
      render: () => "summary\n",
    });
    const second = buildDerived(nodeRuntime(), paths, {
      file: ".finitemonkey/overview.txt",
      generator: "toy2",
      inputs: { a: "1" },
      sources: [".finitemonkey/summary.txt"],
      render: () => "overview\n",
    });
    assert.deepEqual(second, { kind: "refused", source: ".finitemonkey/summary.txt" });
    const derived = new Set(readDerived(nodeRuntime(), paths).keys());
    assert.ok(!MAP_GENERATOR.sources.some((source) => derived.has(source)));
  });

  it("reports a hand edit of the map and keeps it as a claim from the person", async () => {
    const repo = project();
    const first = await cliJson(["map"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(first.code, 0, first.stdout);
    const file = join(repo.root, ".finitemonkey/map.txt");
    writeFileSync(file, `${readFileSync(file, "utf8")}money totals are rounded in the caller\n`);
    const second = await cliJson(["map"], { cwd: repo.root, runtime: repoRuntime() });
    assert.match(second.stdout, /money totals are rounded in the caller/);
    assert.doesNotMatch(readFileSync(file, "utf8"), /rounded in the caller/);
    const claims = readFileSync(join(repo.root, ".finitemonkey/claims.jsonl"), "utf8");
    assert.match(claims, /Correction to \.finitemonkey\/map\.txt: money totals are rounded in the caller/);
    assert.match(claims, /"source":"person"/);
  });
});

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { after, before, describe, it } from "node:test";

import { readDont } from "../src/look/dont.js";
import { regionsOf, verdictFor, visualPages } from "../src/look/visual.js";
import { fmPaths } from "../src/task/paths.js";
import { fixtureRepo, hasBrowser, lookAt, serverSource } from "./look-fixture.js";
import { type Repo, repoRuntime } from "./repo.js";
import { cliJson } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

let browser = false;
before(async () => {
  browser = await hasBrowser();
});

describe("visual: verdicts and regions", () => {
  it("adjacent changed cells merge into one boxed region", () => {
    assert.deepEqual(
      regionsOf(
        [
          { col: 0, row: 0 },
          { col: 1, row: 0 },
          { col: 5, row: 5 },
        ],
        16,
      ),
      [
        { x: 0, y: 0, w: 32, h: 16 },
        { x: 80, y: 80, w: 16, h: 16 },
      ],
    );
  });

  it("a verdict is bound to its tree and goes stale on another tree", () => {
    const verdicts = [{ route: "/", tree: "t1", verdict: "approved" as const, by: "Ana", reason: "", at: "x" }];
    const diff = {
      route: "/",
      viewport: 390,
      changed: 40,
      regions: [{ x: 0, y: 0, w: 16, h: 16 }],
      sideBySide: undefined,
      sizeChanged: false,
    };
    assert.deepEqual(visualPages([diff], verdicts, "t1"), []);
    assert.equal(verdictFor(verdicts, "/", "t2"), undefined);
    assert.deepEqual(
      visualPages([diff], verdicts, "t2").flatMap((page) => page.issues.map((item) => item.rule)),
      ["visual/pending"],
    );
  });
});

const page = (color: string): string =>
  `<main><h1>Shop</h1><button style="background:${color};color:#fff;border:0;padding:12px 24px">Buy</button></main>`;

const tty = (): Readable => Object.assign(Readable.from([]), { isTTY: true });

describe("visual: approved image against the next change", () => {
  it("unchanged trees stay quiet, a color change is boxed at every width, verdicts need the person", async (t) => {
    if (!browser) {
      t.skip("no browser");
      return;
    }
    const policy =
      "guards:\n  a11y: off\n  keyboard: off\n  ui-states: off\n  ds-adherence: off\n  default-look: off\n";
    const repo = await fixtureRepo({ "/": page("#2563eb") }, { routes: ["/"], policy });
    repos.push(repo);
    const runtime = repoRuntime();
    await lookAt(repo);
    const agent = await cliJson(["look", "approve", "/"], { runtime, cwd: repo.root, env: { CLAUDECODE: "1" } });
    assert.notEqual(agent.code, 0);
    assert.ok(!existsSync(join(repo.root, ".finitemonkey", "look", "approved", "root-390.png")));
    const approved = await cliJson(["look", "approve", "/"], { runtime, cwd: repo.root, stdin: tty() });
    assert.equal(approved.code, 0, approved.stdout);
    assert.ok(existsSync(join(repo.root, ".finitemonkey", "look", "approved", "root-390.png")));
    const visual = (run: Awaited<ReturnType<typeof lookAt>>) =>
      run.summary.findings.filter((item) => item.feature === "visual-approve");
    assert.deepEqual(visual(await lookAt(repo)), []);
    repo.write("server.js", serverSource({ "/": page("#dc2626") }));
    const changed = await lookAt(repo);
    assert.deepEqual([...new Set(visual(changed).map((item) => `${item.rule} ${String(item.viewport)}`))].sort(), [
      "visual/pending 1440",
      "visual/pending 390",
    ]);
    const rejected = await cliJson(["look", "reject", "/", "--reason", "keep the blue button"], {
      runtime,
      cwd: repo.root,
      stdin: tty(),
    });
    assert.equal(rejected.code, 0, rejected.stdout);
    assert.deepEqual(
      readDont(runtime, fmPaths(repo.root)).map((rule) => [rule.reason, rule.source]),
      [["keep the blue button", "visual /"]],
    );
    assert.ok(visual(await lookAt(repo)).every((item) => item.rule === "visual/rejected"));
  });
});

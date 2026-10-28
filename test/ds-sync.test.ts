import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { after, describe, it } from "node:test";

import { format } from "prettier";

import type { AbsolutePath } from "../src/core/brand.js";
import type { TextSource } from "../src/core/context.js";
import { nodeRuntime } from "../src/core/node-runtime.js";
import type { ExecRequest, Runtime } from "../src/core/runtime.js";
import { replaceMarked, SECTION_END, SECTION_START } from "../src/dssync/issue.js";
import { renderSummary } from "../src/dssync/render.js";
import { dsSummary } from "../src/dssync/summary.js";
import { tempDir } from "./git-support.js";
import { t } from "./git-support.js";
import { cliJson, execResult, field } from "./support.js";

const tty = (): TextSource => Object.assign(Readable.from([]), { isTTY: true });
const dirs: string[] = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const tree = (files: Readonly<Record<string, string>>): AbsolutePath => {
  const dir = tempDir("fm-ds-");
  dirs.push(dir);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
};

const BEFORE = new Map([
  ["tokens.css", ":root { --color-primary: #111; --space-2: 4px; }\n.btn { color: red; }\n"],
  ["components/Card.tsx", "export const Card = () => null;\n"],
  ["assets/logo.svg", "<svg/>"],
]);
const AFTER = new Map([
  ["tokens.css", ":root { --color-primary: #222; --space-2: 4px; --space-3: 8px; }\n.btn { color: red; }\n.chip { }\n"],
  ["components/Card.tsx", "export const Card = () => null;\n"],
  ["components/Badge.tsx", "export const Badge = () => null;\n"],
]);

describe("ds-sync and issues from prototypes", () => {
  it("writes the same summary for the same input, with a checklist of new components", () => {
    const first = renderSummary(t, dsSummary(BEFORE, AFTER));
    const shuffled = new Map([...AFTER].reverse());
    assert.equal(renderSummary(t, dsSummary(new Map([...BEFORE].reverse()), shuffled)), first);
    assert.match(first, /changed: `--color-primary` from `#111` to `#222`/);
    assert.match(first, /added: `--space-3` = `8px`/);
    assert.match(first, /added: `\.chip`/);
    assert.match(first, /added: `Badge`/);
    assert.match(first, /removed: `assets\/logo\.svg`/);
    assert.match(first, /- \[ \] `Badge`: props, states and accessibility/);
  });

  it("rewrites only the section between the markers", () => {
    const body = `Context from the team.\n\n${SECTION_START}\nold\n${SECTION_END}\n\nNotes below stay.\n`;
    const next = replaceMarked(body, `${SECTION_START}\nnew\n${SECTION_END}`);
    assert.equal(next, `Context from the team.\n\n${SECTION_START}\nnew\n${SECTION_END}\n\nNotes below stay.\n`);
    assert.equal(replaceMarked("Only text", "S"), "Only text\n\nS");
  });

  it("edits the issue of a prototype ready for dev and keeps the rest of its body", async () => {
    const prototypes = tree({
      "checkout.html": '<main data-status="ready-for-dev"><Button/><Card/></main>',
      "draft.html": "<main><Button/></main>",
    });
    const calls: ExecRequest[] = [];
    const existing = `Written by a person.\n\n${SECTION_START}\nold\n${SECTION_END}\nTail.\n`;
    const base = nodeRuntime();
    const runtime: Runtime = {
      ...base,
      exec: (request) => {
        if (request.command !== "gh") return base.exec(request);
        calls.push(request);
        if (request.args[1] === "list")
          return execResult(0, JSON.stringify([{ number: 7, title: "Prototype: checkout", body: existing }]));
        return execResult(0);
      },
    };
    const dry = await cliJson(["ds-sync", "issue", prototypes], { cwd: prototypes, runtime });
    assert.deepEqual(
      (field(dry.body, "data", "ready") as unknown[]).map((item) => field(item, "title")),
      ["Prototype: checkout"],
    );
    assert.equal(calls.length, 0);
    const done = await cliJson(["ds-sync", "issue", prototypes, "--yes"], { cwd: prototypes, runtime, stdin: tty() });
    assert.equal(done.code, 0, done.stdout);
    const edit = calls.find((call) => call.args[1] === "edit");
    assert.ok(edit?.input !== undefined);
    assert.ok(edit.input.startsWith("Written by a person.\n\n"));
    assert.ok(edit.input.endsWith(`${SECTION_END}\nTail.\n`));
    assert.match(edit.input, /- `Button`\n- `Card`/);
  });

  it("the agent cannot open or edit issues, even with --yes", async () => {
    const prototypes = tree({ "a.html": "@ready-for-dev <Button/>" });
    const calls: string[] = [];
    const base = nodeRuntime();
    const runtime: Runtime = {
      ...base,
      exec: (request) => {
        calls.push(request.command);
        return base.exec(request);
      },
    };
    const run = await cliJson(["ds-sync", "issue", prototypes, "--yes"], {
      cwd: prototypes,
      runtime,
      env: { CLAUDECODE: "1", GITHUB_ACTIONS: "true" },
      stdin: tty(),
    });
    assert.equal(field(run.body, "error", "code"), "needs_confirmation");
    assert.ok(!calls.includes("gh"));
  });

  it("generates a hardened workflow that prettier keeps", async () => {
    const dir = tree({ "README.md": "x\n" });
    const run = await cliJson(["ds-sync", "init", "--source", "acme/prototypes", "--write"], {
      cwd: dir,
      runtime: nodeRuntime(),
    });
    assert.equal(run.code, 0, run.stdout);
    const yaml = readFileSync(join(dir, ".github/workflows/ds-sync.yml"), "utf8");
    assert.equal(await format(yaml, { parser: "yaml" }), yaml);
    for (const trigger of ["repository_dispatch:", "schedule:", "workflow_dispatch:"])
      assert.ok(yaml.includes(trigger));
    for (const line of yaml.split("\n").filter((item) => item.includes("uses:"))) {
      assert.match(line, /@[0-9a-f]{40} # v/);
    }
    assert.match(yaml, /permissions:\n {2}contents: read\n/);
    assert.match(yaml, /concurrency:/);
    assert.match(yaml, /timeout-minutes: 15/);
    assert.equal(yaml.match(/persist-credentials: false/g)?.length, 2);
    assert.ok(yaml.includes("actions/create-github-app-token@"));
    assert.ok(!/pull_request_target|secrets\.(?!DS_SYNC_APP_PRIVATE_KEY)/.test(yaml));
    const runBlocks = yaml.split(/\n {6}- /).flatMap((step) => step.split(/\n {8}run: /).slice(1));
    assert.equal(runBlocks.length, 3);
    assert.ok(runBlocks.every((block) => !block.includes("${{")));
  });

  it("copies the design system and writes the summary", async () => {
    const from = tree({ "tokens.css": ":root { --a: 1px; }\n", "components/Chip.tsx": "x" });
    const to = tree({ "tokens.css": ":root { --a: 2px; }\n", "old.svg": "<svg/>" });
    const summary = join(to, "..", `${String(Date.now())}-summary.md`);
    const run = await cliJson(["ds-sync", "apply", "--from", from, "--to", to, "--summary", summary], {
      cwd: to,
      runtime: nodeRuntime(),
    });
    assert.equal(run.code, 0, run.stdout);
    assert.equal(readFileSync(join(to, "tokens.css"), "utf8"), ":root { --a: 1px; }\n");
    assert.match(readFileSync(summary, "utf8"), /removed: `old\.svg`/);
    rmSync(summary);
  });
});

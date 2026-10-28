import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { describe, it } from "node:test";

import { auditText } from "../src/ci/audit/audit.js";
import { toAbsolutePath } from "../src/core/brand.js";
import type { ExecRequest } from "../src/core/runtime.js";
import { cli, cliJson, execResult, fakeRuntime, field } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/app");
const at = (path: string): string => toAbsolutePath(path, ROOT);
const CHECKOUT = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1";

const workflow = (on: string, job: string, top = "permissions:\n  contents: read\n"): string =>
  `name: W\non:\n${on}\n${top}concurrency:\n  group: w\n  cancel-in-progress: true\njobs:\n  build:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n${job}`;

const steps = (...lines: readonly string[]): string => `    steps:\n${lines.join("\n")}\n`;

const rulesIn = (text: string, level: 0 | 1 | 2 | 3 = 1, isPublic = false): readonly string[] =>
  auditText(".github/workflows/w.yml", text, level, isPublic).map((item) => `${item.severity}:${item.rule}`);

interface Fixture {
  readonly rule: string;
  readonly severity: "block" | "warn";
  readonly failing: string;
  readonly passing: string;
  readonly publicRepo?: boolean;
}

const FIXTURES: readonly Fixture[] = [
  {
    rule: "dangerous-trigger",
    severity: "block",
    failing: workflow(
      "  pull_request_target:",
      steps(
        `      - uses: ${CHECKOUT}`,
        "        with:",
        "          persist-credentials: false",
        "          ref: ${{ github.event.pull_request.head.sha }}",
      ),
    ),
    passing: workflow(
      "  pull_request_target:",
      steps(`      - uses: ${CHECKOUT}`, "        with:", "          persist-credentials: false"),
    ),
  },
  {
    rule: "template-injection",
    severity: "block",
    failing: workflow("  issues:", steps("      - run: |", '          echo "${{ github.event.issue.title }}"')),
    passing: workflow(
      "  issues:",
      steps(
        "      - env:",
        "          TITLE: ${{ github.event.issue.title }}",
        "        run: |",
        '          echo "$TITLE"',
      ),
    ),
  },
  {
    rule: "persisted-credentials",
    severity: "block",
    failing: workflow(
      "  push:",
      `    permissions:\n      contents: write\n${steps(`      - uses: ${CHECKOUT}`, "      - run: npm install")}`,
    ),
    passing: workflow(
      "  push:",
      `    permissions:\n      contents: write\n${steps(
        `      - uses: ${CHECKOUT}`,
        "        with:",
        "          persist-credentials: false",
        "      - run: npm install",
      )}`,
    ),
  },
  {
    rule: "permissions",
    severity: "warn",
    failing: workflow("  push:", steps("      - run: make"), ""),
    passing: workflow("  push:", steps("      - run: make")),
  },
  {
    rule: "unpinned-action",
    severity: "warn",
    failing: workflow(
      "  push:",
      steps("      - uses: actions/checkout@v7", "        with:", "          persist-credentials: false"),
    ),
    passing: workflow(
      "  push:",
      steps(`      - uses: ${CHECKOUT}`, "        with:", "          persist-credentials: false"),
    ),
  },
  {
    rule: "secret-printed",
    severity: "block",
    failing: workflow("  push:", steps('      - run: echo "token=${{ secrets.TOKEN }}"')),
    passing: workflow(
      "  push:",
      steps("      - env:", "          TOKEN: ${{ secrets.TOKEN }}", "        run: ./publish"),
    ),
  },
  {
    rule: "deploy-unsafe",
    severity: "warn",
    failing: workflow("  push:", `    name: deploy\n${steps("      - run: ./deploy.sh")}`).replace(
      "concurrency:\n  group: w\n  cancel-in-progress: true\n",
      "",
    ),
    passing: workflow(
      "  push:",
      `    name: deploy\n    needs: [ci]\n    environment: production\n${steps("      - run: ./deploy.sh")}`,
    ),
  },
  {
    rule: "self-hosted-public",
    severity: "block",
    publicRepo: true,
    failing: workflow("  push:", steps("      - run: make")).replace("ubuntu-latest", "[self-hosted, linux]"),
    passing: workflow("  push:", steps("      - run: make")),
  },
  {
    rule: "no-timeout",
    severity: "warn",
    failing: workflow("  push:", steps("      - run: make")).replace("    timeout-minutes: 5\n", ""),
    passing: workflow("  push:", steps("      - run: make")),
  },
];

describe("ci audit rules", () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.rule} has a failing and a passing fixture`, () => {
      const isPublic = fixture.publicRepo === true;
      assert.ok(
        rulesIn(fixture.failing, 1, isPublic).includes(`${fixture.severity}:${fixture.rule}`),
        rulesIn(fixture.failing, 1, isPublic).join(", "),
      );
      assert.ok(!rulesIn(fixture.passing, 1, isPublic).some((rule) => rule.endsWith(`:${fixture.rule}`)));
    });
  }

  it("permissions, unpinned actions and unsafe deploys warn at levels 0 and 1 and block from level 2", () => {
    for (const rule of ["permissions", "unpinned-action", "deploy-unsafe"]) {
      const fixture = FIXTURES.find((item) => item.rule === rule);
      assert.ok(fixture !== undefined);
      assert.ok(rulesIn(fixture.failing, 0).includes(`warn:${rule}`), rule);
      assert.ok(rulesIn(fixture.failing, 2).includes(`block:${rule}`), rule);
      assert.ok(rulesIn(fixture.failing, 3).includes(`block:${rule}`), rule);
    }
  });

  it("a deploy that waits for a pushed green CI may check out the head commit", () => {
    const text = workflow(
      "  workflow_run:\n    workflows: [CI]\n    types: [completed]",
      `    if: github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push'\n    environment: production\n${steps(
        `      - uses: ${CHECKOUT}`,
        "        with:",
        "          persist-credentials: false",
        "          ref: ${{ github.event.workflow_run.head_sha }}",
      )}`,
    );
    assert.deepEqual(rulesIn(text), []);
    assert.ok(
      rulesIn(text.replace(" && github.event.workflow_run.event == 'push'", "")).includes("block:dangerous-trigger"),
    );
  });
});

const PLANTED = [
  "name: planted",
  "on:",
  "  pull_request_target:",
  "  issue_comment:",
  "permissions:",
  "  contents: write",
  "jobs:",
  "  build:",
  "    runs-on: ubuntu-latest",
  "    timeout-minutes: 5",
  "    steps:",
  `      - uses: ${CHECKOUT}`,
  "        with:",
  "          ref: ${{ github.event.pull_request.head.ref }}",
  "      - run: |",
  '          echo "${{ github.event.comment.body }}"',
  "      - run: npm ci",
  "",
].join("\n");

const runtimeWith = (
  files: Readonly<Record<string, string>>,
  exec?: (request: ExecRequest) => ReturnType<typeof execResult> | undefined,
) =>
  fakeRuntime({
    files: Object.fromEntries(Object.entries(files).map(([path, text]) => [at(path), text])),
    ...(exec === undefined ? {} : { exec }),
  });

describe("ci audit command", () => {
  it("catches the three planted patterns of the stage gate and exits 1", async () => {
    const runtime = runtimeWith({ ".github/workflows/planted.yml": PLANTED });
    const run = await cliJson(["ci", "audit"], { runtime, cwd: ROOT });
    assert.equal(run.code, 1);
    const findings = field(run.body, "data", "findings");
    assert.ok(Array.isArray(findings));
    const rules = findings.map((item) => field(item, "rule"));
    for (const rule of ["dangerous-trigger", "template-injection", "persisted-credentials"]) {
      assert.ok(rules.includes(rule), rule);
    }
  });

  it("takes the level from policy.yml", async () => {
    const unpinned = FIXTURES.find((item) => item.rule === "unpinned-action")?.failing ?? "";
    const light = await cli(["ci", "audit"], {
      runtime: runtimeWith({ ".github/workflows/w.yml": unpinned }),
      cwd: ROOT,
    });
    assert.equal(light.code, 0, light.stdout);
    for (const level of ["level: strict\n", "projectLevel: 2\n"]) {
      const policy = `${level}guards:\n  ci-audit: active\n`;
      const runtime = runtimeWith({ ".github/workflows/w.yml": unpinned, ".finitemonkey/policy.yml": policy });
      const strict = await cli(["ci", "audit"], { runtime, cwd: ROOT });
      assert.equal(strict.code, 1, level);
    }
  });

  it("a finding accepted in the shared baseline stops blocking, and findings accept knows ci-audit ids", async () => {
    const runtime = runtimeWith({ ".github/workflows/planted.yml": PLANTED });
    const first = await cliJson(["ci", "audit"], { runtime, cwd: ROOT });
    const findings = field(first.body, "data", "findings");
    assert.ok(Array.isArray(findings));
    for (const item of findings) {
      if (field(item, "severity") !== "block") continue;
      const id = String(field(item, "id"));
      const accepted = await cli(["findings", "accept", id, "--reason", "fixture"], {
        runtime,
        cwd: ROOT,
        stdin: Object.assign(Readable.from([]), { isTTY: true }),
      });
      assert.equal(accepted.code, 0, accepted.stdout + accepted.stderr);
    }
    const second = await cli(["ci", "audit"], { runtime, cwd: ROOT });
    assert.equal(second.code, 0, second.stdout);
  });

  it("translates actionlint and zizmor findings and says which tool is missing", async () => {
    const calls: string[] = [];
    const runtime = runtimeWith({ ".github/workflows/w.yml": FIXTURES[1]?.passing ?? "" }, (request) => {
      calls.push(request.command);
      if (request.command === "actionlint")
        return execResult(
          1,
          JSON.stringify([
            { message: "unknown key", filepath: `${ROOT}/.github/workflows/w.yml`, line: 3, kind: "syntax-check" },
          ]),
        );
      return undefined;
    });
    const run = await cliJson(["ci", "audit"], { runtime, cwd: ROOT });
    assert.deepEqual(calls, ["actionlint", "zizmor"]);
    assert.equal(run.code, 1);
    assert.deepEqual(field(run.body, "data", "missingTools"), ["zizmor"]);
    assert.match(
      JSON.stringify(field(run.body, "data", "findings")),
      /actionlint\/syntax-check.*\.github\/workflows\/w\.yml/,
    );
  });

  it("shadow mode reports and exits 0", async () => {
    const runtime = runtimeWith({
      ".github/workflows/planted.yml": PLANTED,
      ".finitemonkey/policy.yml": "guards:\n  ci-audit: shadow\n",
    });
    const run = await cli(["ci", "audit"], { runtime, cwd: ROOT });
    assert.equal(run.code, 0);
    assert.match(run.stdout, /template-injection/);
  });
});

describe("ci gen output passes ci audit", () => {
  for (const [label, files] of [
    ["node", { "package.json": '{"scripts":{"test":"vitest","build":"tsc"}}', "package-lock.json": "{}" }],
    ["pnpm", { "package.json": '{"scripts":{"lint":"eslint ."}}', "pnpm-lock.yaml": "" }],
    ["python", { "pyproject.toml": "[project]\ndeps = ['ruff', 'pytest']\n", "uv.lock": "" }],
  ] as const) {
    for (const level of ["0", "2", "3"]) {
      it(`${label} project at level ${level}`, async () => {
        const policy = `projectLevel: ${level}\nguards:\n  ci-gen: active\n  ci-audit: active\n`;
        const runtime = runtimeWith({ ...files, ".finitemonkey/policy.yml": policy });
        const gen = await cli(["ci", "gen", "--with", "deploy,release,review", "--oidc", "--yes"], {
          runtime,
          cwd: ROOT,
        });
        assert.equal(gen.code, 0, gen.stdout);
        const run = await cliJson(["ci", "audit"], { runtime, cwd: ROOT });
        assert.equal(run.code, 0, run.stdout);
        assert.deepEqual(field(run.body, "data", "findings"), []);
        assert.equal((field(run.body, "data", "files") as readonly string[]).length, 5);
      });
    }
  }
});

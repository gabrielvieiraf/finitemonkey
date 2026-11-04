import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { claimUnits, unitsOf } from "../src/stale/docs.js";
import { issueFacts, milestonesOf } from "../src/stale/github.js";
import { statusOf } from "../src/stale/phrases.js";
import { closedByMessage, parseLog, unclosedIssues } from "../src/stale/release.js";
import { type ProjectState, resolveUnits } from "../src/stale/resolve.js";
import { publishedIn } from "../src/stale/state.js";
import { featuresInDiff, mentionsOf, symbolsInDiff } from "../src/stale/touched.js";

const state = (overrides: Partial<ProjectState> = {}): ProjectState => ({
  commands: new Map([
    ["recap", "ready"],
    ["prose check", "ready"],
    ["future", "planned"],
  ]),
  features: new Map([
    ["drift-sensor", "shadow"],
    ["gate", "active"],
  ]),
  published: undefined,
  issues: new Map([
    [12, { state: "closed", completed: true }],
    [13, { state: "open", completed: false }],
    [14, { state: "closed", completed: false }],
  ]),
  ...overrides,
});

const resolve = (text: string, overrides: Partial<ProjectState> = {}) =>
  resolveUnits(unitsOf("docs/essay.md", text), state(overrides));

describe("stale status claims", () => {
  it("reports a table cell saying in development when the issue is closed and the flag ships", () => {
    const doc = [
      "| Mechanism | Flag | Status |",
      "|---|---|---|",
      "| Drift sensor | `drift-sensor` | In development ([#12](https://github.com/acme/app/issues/12)) |",
    ].join("\n");
    const result = resolve(doc);
    assert.equal(result.claims, 1);
    assert.deepEqual(
      result.stale.map((claim) => [claim.line, claim.truth, claim.subject]),
      [
        [3, "issue_closed", "#12"],
        [3, "feature_ships", "drift-sensor"],
      ],
    );
    const [issue, feature] = result.stale;
    assert.match(issue?.evidence ?? "", /issue #12 is closed as completed/);
    assert.match(feature?.evidence ?? "", /ships, shadow by default/);
    assert.equal(issue?.file, "docs/essay.md");
    assert.match(issue.says, /In development/);
  });

  it("reports planned next to a command that exists, and not a planned item with no code", () => {
    const result = resolve(
      ["- `fm recap --since 7d` (planned).", "- `fm teleport` (planned).", "- `fm future` (planned)."].join("\n"),
    );
    assert.equal(result.claims, 3);
    assert.deepEqual(
      result.stale.map((claim) => [claim.line, claim.subject, claim.truth]),
      [[1, "finitemonkey recap", "command_ready"]],
    );
  });

  it("keeps a status to its own clause in a row that says several things", () => {
    const row =
      "| I13 | No em dashes. | `fm prose check` flags em dashes, but no CI step runs it on the docs **(planned)** |";
    assert.deepEqual(resolve(row).stale, []);
  });

  it("does not report issues that are open or closed as not planned", () => {
    assert.deepEqual(resolve("The sensor is planned (#13).\n\nThe probe is planned (#14).").stale, []);
  });

  it("counts issue references it could not check when offline", () => {
    const result = resolve("The sensor is planned (#12).", { issues: undefined });
    assert.deepEqual(result.stale, []);
    assert.deepEqual(result.unresolvedIssues, [12]);
  });

  it("reports nothing installs yet when the changelog lists a published version", () => {
    const changelog = "# Changelog\n\n## [0.1.0-next.42](https://example.com) (2026-11-01)\n";
    const published = publishedIn(changelog);
    assert.equal(published, "0.1.0-next.42");
    const result = resolve("Nothing installs yet: the package is not on npm.", {
      published: { version: published, source: "changelog" },
    });
    assert.deepEqual(
      result.stale.map((claim) => [claim.truth, claim.detail]),
      [["version_published", "0.1.0-next.42"]],
    );
    assert.deepEqual(resolve("Nothing installs yet.").stale, []);
  });

  it("reads status phrases in Portuguese and Spanish", () => {
    assert.equal(statusOf("| Em desenvolvimento (#12) |")?.kind, "unshipped");
    assert.equal(statusOf("Esta función está en desarrollo.")?.kind, "unshipped");
    assert.equal(statusOf("Ainda não publicado no npm.")?.kind, "unpublished");
    assert.equal(statusOf("Disponible próximamente.")?.kind, "unshipped");
    assert.equal(statusOf("O plano ainda não existe."), undefined);
    const pt = resolve("| Sensor | `drift-sensor` | Em desenvolvimento |");
    assert.deepEqual(
      pt.stale.map((claim) => claim.subject),
      ["drift-sensor"],
    );
  });

  it("ignores fenced code and experimental prose without a flag", () => {
    const doc = ["```", "finitemonkey recap (planned)", "```", "Recent experimental work shows this."].join("\n");
    const result = resolve(doc);
    assert.equal(result.claims, 0);
    assert.equal(resolve("`gate` is experimental.").stale[0]?.truth, "feature_active");
  });

  it("uses the whole row only for a short status cell", () => {
    const units = claimUnits("| `drift-sensor` | planned |", (text) => statusOf(text) !== undefined);
    assert.ok(units.some((unit) => unit.text === "planned" && unit.scope.includes("drift-sensor")));
  });
});

describe("stale lookups and releases", () => {
  it("parses gh issues and keeps only completed closes as completed", () => {
    const facts = issueFacts([
      { number: 1, state: "CLOSED", stateReason: "COMPLETED" },
      { number: 2, state: "CLOSED", stateReason: "NOT_PLANNED" },
      { number: 3, state: "OPEN", stateReason: "" },
      { title: "no number" },
    ]);
    assert.deepEqual(
      [...facts.entries()],
      [
        [1, { state: "closed", completed: true }],
        [2, { state: "closed", completed: false }],
        [3, { state: "open", completed: false }],
      ],
    );
  });

  it("lists milestones with zero open issues", () => {
    const milestones = milestonesOf([
      { number: 1, title: "Stage 3", open_issues: 0, closed_issues: 9 },
      { number: 2, title: "Stage 4", open_issues: 2, closed_issues: 1 },
    ]);
    assert.deepEqual(milestones, [{ title: "Stage 3", number: 1, closedIssues: 9 }]);
  });

  it("finds the issues a commit closes", () => {
    assert.deepEqual(closedByMessage("feat: x\n\nCloses #12, #15 and fixes: #20. Part of #30"), [12, 15, 20]);
    assert.deepEqual(closedByMessage("feat: x (#40)"), []);
  });

  it("lists issues closed by commits on another branch that are still open", () => {
    const commits = parseLog(
      [
        "aaaaaaaaaaaaaaaa\u001ffeat: a (#41)\u001fCloses #12\u001e",
        "bbbbbbbbbbbbbbbb\u001ffix: b\u001fFixes #13\u001e",
      ].join("\n"),
    );
    assert.equal(commits.length, 2);
    assert.deepEqual(unclosedIssues(commits, state().issues ?? new Map()), [{ issue: 13, commits: ["bbbbbbbbbbbb"] }]);
  });
});

describe("what a change makes stale", () => {
  const diff = [
    "+++ b/src/recap/recap.ts",
    "+export const buildRecap = () => 1;",
    "-export function run() {}",
    '+  const id = "drift-sensor";',
    '+  const other = "not-a-feature";',
  ].join("\n");

  it("reads exported symbols and flags from the diff", () => {
    assert.deepEqual(symbolsInDiff(diff), ["buildRecap"]);
    assert.deepEqual(featuresInDiff(diff, new Set(["drift-sensor"])), ["drift-sensor"]);
    const words = '+  run("gate");\n+  featureMode(runtime, paths, "git");';
    assert.deepEqual(featuresInDiff(words, new Set(["gate", "git"])), ["git"]);
  });

  it("lists doc lines that mention touched files, symbols, flags and issues", () => {
    const units = unitsOf(
      "README.md",
      [
        "See src/recap/recap.ts for the digest.",
        "`buildRecap()` builds it.",
        "The `drift-sensor` flag.",
        "Tracked in #364.",
        "Nothing here about src/recap/recap.tsx or #3640.",
      ].join("\n"),
    );
    const mentions = mentionsOf(
      units,
      { paths: ["src/recap/recap.ts"], symbols: ["buildRecap"], features: ["drift-sensor"], issues: [364] },
      new Set(["README.md"]),
    );
    assert.deepEqual(
      mentions.map((item) => [item.line, item.mentions, item.changedHere]),
      [
        [1, ["src/recap/recap.ts"], true],
        [2, ["buildRecap"], true],
        [3, ["drift-sensor"], true],
        [4, ["#364"], true],
      ],
    );
  });
});

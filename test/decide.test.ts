import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { checkDecisionText } from "../src/decide/check.js";
import { renderDecision } from "../src/decide/template.js";
import { createTranslator } from "../src/i18n/translate.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cli, cliJson, field, ROOT } from "./support.js";

const t = createTranslator("en");
const NOW = "2026-10-27T12:00:00.000Z";
const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const runtime = () => repoRuntime({ now: () => NOW });

const valid = (): string =>
  renderDecision(t, "provider", "2026-10-27")
    .replace("|  |  |  |", "| Settles Pix in one day | 5 | product owner |")
    .replace("## Proof\n", "## Proof\n\nFACT: Asaas settles Pix on D+0 (https://docs.asaas.com/pix, 2026-10-20)\n");

const kinds = (text: string): readonly string[] =>
  checkDecisionText("docs/plan/02-decision-provider.md", text).map((item) => item.kind);

describe("decision records", () => {
  it("a record with every section, criteria rows, do nothing and dated facts passes", () => {
    assert.deepEqual(kinds(valid()), []);
  });

  it("missing required sections fail the check with the list", async () => {
    const text = valid()
      .replace(/## Proof\n[\s\S]*?(?=## Cost)/, "")
      .replace(/## Cost\n[\s\S]*?(?=## Reversibility)/, "");
    const issues = checkDecisionText("docs/plan/02-decision-provider.md", text);
    assert.deepEqual(
      issues.map((item) => [item.kind, item.detail]),
      [["missing_sections", "Proof, Cost"]],
    );
    const repo = makeRepo({ "docs/plan/02-decision-provider.md": text });
    repos.push(repo);
    const run = await cli(["decide", "check"], { cwd: repo.root, runtime: runtime() });
    assert.equal(run.code, 1);
    assert.match(run.stdout + run.stderr, /required sections missing: Proof, Cost/);
  });

  it("rejects a FACT line without source or date, and keeps numbers from passing as a source", () => {
    assert.deepEqual(kinds(valid().replace(", 2026-10-20)", ")")), ["fact_without_source"]);
    assert.deepEqual(
      kinds(
        valid()
          .replace("FACT: Asaas settles", "FACT: fee is 2.9% and settles")
          .replace("https://docs.asaas.com/pix, ", ""),
      ),
      ["fact_without_source"],
    );
    assert.deepEqual(kinds(valid().replace("https://docs.asaas.com/pix", "docs/plan/01a-today-billing.md:12")), []);
  });

  it("requires do nothing among the alternatives, weights and origins, and a parity row per removal", () => {
    assert.deepEqual(kinds(valid().replace("| Do nothing |", "| Stripe |")), ["no_do_nothing"]);
    assert.deepEqual(kinds(valid().replace("| 5 | product owner |", "|  | product owner |")), ["criteria_incomplete"]);
    assert.deepEqual(kinds(valid().replace("- Removed:", "- Removed: the old webhook route")), [
      "removal_without_parity",
    ]);
    assert.deepEqual(kinds(valid().replace("- Removed:", "- Removed: the old webhook route (parity.csv P3)")), []);
  });

  it("checks the sections are in order", () => {
    const text = valid();
    const risks = /## Risks\n[\s\S]*?(?=## Points to prove)/.exec(text)?.[0] ?? "";
    assert.deepEqual(kinds(text.replace(risks, "").replace("## Short answer", `${risks}## Short answer`)), ["order"]);
  });

  it("questions to the person follow Decision, options, recommendation, cost and risk", () => {
    const asking = valid().replace("status: proposed", "status: needs-person");
    assert.deepEqual(kinds(asking), ["question_incomplete"]);
    const answered = asking
      .replace("- **Decision:**", "- **Decision:** payment provider")
      .replace("- **Options:**", "- **Options:** Asaas, Stripe, do nothing")
      .replace("- **Recommendation:**", "- **Recommendation:** Asaas, Pix settles same day")
      .replace("- **Cost:**", "- **Cost:** 0.99 per Pix, two days of work")
      .replace("- **Risk:**", "- **Risk:** split rules differ; the way back is the current provider");
    assert.deepEqual(kinds(answered), []);
    const skill = readFileSync(join(ROOT, "plugin", "skills", "decide", "SKILL.md"), "utf8");
    const labels = ["**Decision:**", "**Options:**", "**Recommendation:**", "**Cost:**", "**Risk:**"].map((label) =>
      skill.indexOf(label),
    );
    assert.ok(labels.every((index, position) => index > 0 && (position === 0 || index > (labels[position - 1] ?? 0))));
  });
});

describe("finitemonkey decide", () => {
  it("writes the scaffold with every section in order and a do nothing row", async () => {
    const repo = makeRepo({ "README.md": "# app\n" });
    repos.push(repo);
    const created = await cliJson(["decide", "new", "Payment provider"], { cwd: repo.root, runtime: runtime() });
    assert.equal(field(created.body, "data", "file"), "docs/plan/01-decision-payment-provider.md");
    const text = repo.read("docs/plan/01-decision-payment-provider.md");
    assert.deepEqual(kinds(text), ["criteria_incomplete"]);
    assert.ok(text.indexOf("## Criteria") < text.indexOf("## Alternatives"));
  });

  it("a revoked record keeps its content and gains the banner", async () => {
    const repo = makeRepo({
      "docs/plan/02-decision-provider.md": valid(),
      "docs/plan/05-decision-provider-v2.md": valid(),
    });
    repos.push(repo);
    const before = repo.read("docs/plan/02-decision-provider.md");
    const missing = await cliJson(["decide", "revoke", "docs/plan/02-decision-provider.md", "--by", "09-nope.md"], {
      cwd: repo.root,
      runtime: runtime(),
    });
    assert.equal(field(missing.body, "error", "code"), "invalid_arguments");
    const run = await cliJson(
      ["decide", "revoke", "docs/plan/02-decision-provider.md", "--by", "docs/plan/05-decision-provider-v2.md"],
      {
        cwd: repo.root,
        runtime: runtime(),
      },
    );
    assert.equal(run.code, 0);
    const after = repo.read("docs/plan/02-decision-provider.md");
    assert.match(
      after,
      /^# Decision: provider\n\n> \*\*Revoked on 2026-10-27\. Replaced by \[05-decision-provider-v2\.md\]\(05-decision-provider-v2\.md\)\.\*\*\n/m,
    );
    assert.match(after, /^status: revoked$/m);
    assert.match(after, /## Status\n\nrevoked\n/);
    const kept = before.split("\n").filter((line) => line !== "proposed" && !line.startsWith("status:"));
    for (const line of kept) assert.ok(after.includes(line), line);
    const again = await cliJson(["decide", "revoke", "02-decision-provider.md", "--by", "05-decision-provider-v2.md"], {
      cwd: repo.root,
      runtime: runtime(),
    });
    assert.equal(field(again.body, "error", "code"), "invalid_arguments");
  });
});

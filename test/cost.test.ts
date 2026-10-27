import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { parseCsv } from "../src/cost/csv.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, field, ROOT } from "./support.js";

const NOW = "2026-10-27T12:00:00.000Z";
const FIXTURES = join(ROOT, "test", "fixtures", "cost");
const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const runtime = () => repoRuntime({ now: () => NOW });

const fixture = (...layers: readonly string[]): Repo => {
  const files = layers.reduce<Readonly<Record<string, string>>>(
    (all, name) => ({
      ...all,
      ...Object.fromEntries(
        readdirSync(join(FIXTURES, name)).map((file) => [
          `docs/plan/${file}`,
          readFileSync(join(FIXTURES, name, file), "utf8"),
        ]),
      ),
    }),
    { "README.md": "# app\n" },
  );
  const repo = makeRepo(files);
  repos.push(repo);
  return repo;
};

const kinds = async (repo: Repo): Promise<readonly string[]> => {
  const { body } = await cliJson(["cost", "check"], { cwd: repo.root, runtime: runtime() });
  const issues = field(body, "data", "issues");
  return Array.isArray(issues) ? issues.map((item: unknown) => String(field({ item }, "item", "kind"))) : [];
};

const arithmetic = (text: string): number => {
  const tokens = text.match(/\d+(?:\.\d+)?(?:e[+-]?\d+)?|[-+*/()]/gi) ?? [];
  let at = 0;
  const peek = (): string | undefined => tokens[at];
  const take = (): string => tokens[at++] ?? "";
  const factor = (): number => {
    const token = take();
    if (token === "(") {
      const value = sum();
      take();
      return value;
    }
    return token === "-" ? -factor() : Number(token);
  };
  const product = (): number => {
    let value = factor();
    while (peek() === "*" || peek() === "/") value = take() === "*" ? value * factor() : value / factor();
    return value;
  };
  const sum = (): number => {
    let value = product();
    while (peek() === "+" || peek() === "-") value = take() === "+" ? value + product() : value - product();
    return value;
  };
  return sum();
};

const spreadsheet = (rows: readonly (readonly string[])[], column: "F" | "G") => {
  const index = column === "F" ? 5 : 6;
  const cell = (row: number): number => {
    const raw = rows[row - 1]?.[index] ?? "";
    if (!raw.startsWith("=")) return Number(raw);
    const expr = raw.slice(1).replace(/([FG])(\d+)/g, (_, col: string, at: string) => {
      assert.equal(col, column);
      return `(${String(cell(Number(at)))})`;
    });
    assert.match(expr, /^[0-9eE+\-*/(). ]+$/);
    return arithmetic(expr);
  };
  return cell;
};

describe("finitemonkey cost", () => {
  it("generates a model whose CSV opens in a spreadsheet and recalculates", async () => {
    const repo = makeRepo({ "README.md": "# app\n" });
    repos.push(repo);
    const created = await cliJson(["cost", "init", "pix"], { cwd: repo.root, runtime: runtime() });
    assert.equal(field(created.body, "data", "file"), "docs/plan/01-cost-model.mjs");
    const run = spawnSync(process.execPath, [join(repo.root, "docs", "plan", "01-cost-model.mjs")], {
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);
    const rows = parseCsv(repo.read("docs/plan/01-cost-model.csv"));
    assert.deepEqual(rows[0], ["id", "unit", "type", "source", "date", "base", "conservative", "readable"]);
    const unit = rows.findIndex((row) => row[0] === "unit_cost_brl") + 1;
    assert.match(rows[unit - 1]?.[5] ?? "", /^=F4 \* F5 \* F2 \* \(1 \+ F3\)$/);
    assert.equal(
      rows[unit - 1]?.[7],
      "price_per_call_usd * calls_per_operation * fx_usd_brl * (1 + tax_on_foreign_services)",
    );
    const base = spreadsheet(rows, "F");
    assert.ok(Math.abs(base(unit) - 0.002 * 3 * 5.4 * 1.0638) < 1e-9);
    const conservative = spreadsheet(rows, "G");
    assert.ok(Math.abs(conservative(unit) - 0.003 * 5 * 5.4 * 1.0638) < 1e-9);
    const total = rows.findIndex((row) => row[0] === "total_cost_brl") + 1;
    assert.ok(Math.abs(base(total) - (base(unit) * 10000 + 300)) < 1e-6);
    assert.ok(parseCsv(repo.read("docs/plan/01-cost-limits.csv")).length > 1);
    assert.equal((await cliJson(["cost", "check"], { cwd: repo.root, runtime: runtime() })).code, 0);
  });

  it("marks assumptions visibly in the report", async () => {
    const repo = makeRepo({ "README.md": "# app\n" });
    repos.push(repo);
    await cliJson(["cost", "init"], { cwd: repo.root, runtime: runtime() });
    spawnSync(process.execPath, [join(repo.root, "docs", "plan", "01-cost-model.mjs")], { encoding: "utf8" });
    const report = repo.read("docs/plan/01-cost-model.md");
    assert.match(report, /Rows marked ASSUMPTION or OPINION are not facts/);
    assert.match(report, /^- \*\*ASSUMPTION\*\* calls_per_operation = 3 \/ 5 calls$/m);
    assert.match(report, /^\| \*\*ASSUMPTION\*\* operations_per_month \| 10000 \| 25000 \| ASSUMPTION \|/m);
    assert.match(report, /^## Break-even \(base \/ conservative\)$/m);
    assert.match(report, /^## What to measure in production$/m);
  });

  it("passes the valid fixture", async () => {
    assert.deepEqual(await kinds(fixture("valid")), []);
  });

  it("fails on a FACT row without source", async () => {
    assert.deepEqual(await kinds(fixture("valid", "missing-source")), ["missing_source"]);
  });

  it("fails on a price older than the validity, and the validity is configurable", async () => {
    const repo = fixture("valid", "expired");
    assert.deepEqual(await kinds(repo), ["expired"]);
    repo.write(".finitemonkey/config.yml", "cost:\n  validity_days: 200\n");
    assert.deepEqual(await kinds(repo), []);
  });

  it("fails when the product accepts more than the next layer handles", async () => {
    assert.deepEqual(await kinds(fixture("valid", "limit-over")), ["limit_exceeds_next_layer"]);
  });
});

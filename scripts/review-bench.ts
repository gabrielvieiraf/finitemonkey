import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { toAbsolutePath } from "../src/core/brand.js";
import { nodeRuntime } from "../src/core/node-runtime.js";
import { isRecord, type JsonObject, parseJson, parseJsonObject } from "../src/core/parsed.js";
import { FORBIDDEN_TOOLS, REVIEWER } from "../src/review/agents.js";
import { buildPacket } from "../src/review/packet.js";
import { reproduce } from "../src/review/reproduce.js";
import { spawnClaude } from "./bench-claude.js";
import {
  costEstimate,
  type GoldenPr,
  judgeInputs,
  parseGolden,
  parsePin,
  parseRecord,
  pullOf,
  realReviewProblems,
  type ReviewDeps,
  reviewOne,
} from "./review-bench-lib.js";
import { judgeModelDir, scoreArms, scoreTable } from "./review-bench-score.js";

const repo = fileURLToPath(new URL("..", import.meta.url));

const USAGE = [
  "npm run bench:review -- <plan|review|export|score> --bench <checkout of the pinned benchmark>",
  "  plan                      count PRs and golden comments and print the cost estimate; spends nothing",
  "  review --out <file>       review every PR (needs --yes, a TTY, --config-dir and --repos)",
  "  export --findings <file>  write the judge inputs into the benchmark checkout",
  "  score [--out <file>]      precision, recall and F1 per arm from the benchmark's evaluations.json",
].join("\n");

const fail = (message: string): never => {
  console.error(`bench:review: ${message}\n\n${USAGE}`);
  process.exit(2);
};

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    bench: { type: "string" },
    out: { type: "string" },
    findings: { type: "string" },
    repos: { type: "string" },
    "config-dir": { type: "string" },
    "max-budget-usd": { type: "string", default: "3" },
    model: { type: "string", default: "claude-opus-4-5" },
    "judge-model": { type: "string" },
    yes: { type: "boolean" },
  },
});

const readObject = (path: string): JsonObject => {
  if (!existsSync(path)) return {};
  const parsed = parseJsonObject(readFileSync(path, "utf8"));
  return parsed.ok ? parsed.value : fail(`${path}: ${parsed.error}`);
};

const pinned = parsePin(readObject(join(repo, "bench", "review", "martian.json")));
const pin = pinned.ok ? pinned.value : fail(pinned.error);
const bench = values.bench ?? fail("--bench is required");
const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: bench, encoding: "utf8" }).stdout.trim();
if (head !== pin.commit) fail(`${bench} is at ${head || "no commit"}, not the pinned ${pin.commit} of ${pin.repo}`);

const goldenDir = join(bench, pin.goldenDir);
const prs: readonly GoldenPr[] = readdirSync(goldenDir)
  .filter((file) => file.endsWith(".json"))
  .sort()
  .flatMap((file) => {
    const raw = parseJson(readFileSync(join(goldenDir, file), "utf8"));
    const parsed = parseGolden(basename(file, ".json"), raw.ok ? raw.value : undefined);
    return parsed.ok ? parsed.value : fail(parsed.error);
  });

const maxBudgetUsd = Number(values["max-budget-usd"]);
if (!Number.isFinite(maxBudgetUsd) || maxBudgetUsd <= 0) fail("--max-budget-usd must be a positive number");
const judgeModel = values["judge-model"] ?? pin.judgeModel;
const resultsDir = join(bench, "offline", "results");
const estimate = costEstimate(prs, pin.estimate, maxBudgetUsd);

const git = (cwd: string, ...args: readonly string[]): string => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.trim()}`);
  return result.stdout.trim();
};

const sidesOf = (clone: string, pr: GoldenPr): { base: string; head: string } => {
  const pull = pullOf(pr.url);
  if (pull === undefined) throw new Error(`${pr.url} is not a GitHub pull request`);
  const api = spawnSync("gh", ["api", `repos/${pull.owner}/${pull.name}/pulls/${String(pull.number)}`], {
    encoding: "utf8",
  });
  const body = parseJsonObject(api.stdout);
  const base = body.ok && isRecord(body.value["base"]) ? body.value["base"]["sha"] : undefined;
  const tip = body.ok && isRecord(body.value["head"]) ? body.value["head"]["sha"] : undefined;
  if (typeof base !== "string" || typeof tip !== "string")
    throw new Error(`cannot read the base and head of ${pr.url}`);
  git(clone, "fetch", "-q", "origin", base, `pull/${String(pull.number)}/head`);
  return { base, head: tip };
};

const realDeps = (repos: string, configDir: string): ReviewDeps => {
  const runtime = nodeRuntime();
  const sides = new Map<string, { base: string; head: string }>();
  const cloneOf = (pr: GoldenPr): string => {
    const clone = join(repos, pr.repo);
    if (!existsSync(join(clone, ".git"))) throw new Error(`${clone} is not a clone of ${pr.repo}`);
    return clone;
  };
  return {
    review: async (pr) => {
      const clone = cloneOf(pr);
      const pair = sidesOf(clone, pr);
      sides.set(pr.url, pair);
      const packet = buildPacket(runtime, toAbsolutePath(clone), pair.base, pair.head);
      const tree = mkdtempSync(join(tmpdir(), "fm-review-bench-"));
      git(clone, "worktree", "add", "-q", "--detach", tree, pair.head);
      try {
        const outcome = await spawnClaude({
          command: "claude",
          args: [
            "-p",
            packet.text,
            "--output-format",
            "json",
            "--model",
            values.model,
            "--max-budget-usd",
            maxBudgetUsd.toFixed(2),
            "--append-system-prompt",
            REVIEWER.body,
            "--disallowedTools",
            ...FORBIDDEN_TOOLS,
          ],
          cwd: tree,
          env: { CLAUDE_CONFIG_DIR: configDir },
          settings: {},
        });
        const result = parseJsonObject(outcome.stdout);
        const text = result.ok && typeof result.value["result"] === "string" ? result.value["result"] : "";
        const cost = result.ok ? result.value["total_cost_usd"] : undefined;
        return { text, costUsd: typeof cost === "number" ? cost : null };
      } finally {
        git(clone, "worktree", "remove", "--force", tree);
        rmSync(tree, { recursive: true, force: true });
      }
    },
    verify: (pr, findings) => {
      const pair = sides.get(pr.url);
      if (pair === undefined) return Promise.resolve(new Map());
      const checked = reproduce(runtime, toAbsolutePath(cloneOf(pr)), pair, findings);
      return Promise.resolve(new Map(checked.map((item) => [item.finding.id, item.outcome])));
    },
  };
};

const records = (path: string) =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line) => {
      const raw = parseJsonObject(line);
      const record = raw.ok ? parseRecord(raw.value) : undefined;
      return record === undefined ? [] : [record];
    });

const step: string = positionals[0] ?? "";

switch (step) {
  case "plan": {
    console.log(`${pin.repo} at ${pin.commit}`);
    console.log(estimate.text);
    break;
  }
  case "review": {
    const out = values.out ?? fail("--out <file> is required");
    console.log(estimate.text);
    const problems = realReviewProblems({
      yes: values.yes === true,
      tty: process.stdin.isTTY,
      configDir: values["config-dir"],
      repos: values.repos,
    });
    if (problems.length > 0) fail(problems.join("\n"));
    const deps = realDeps(values.repos ?? "", values["config-dir"] ?? "");
    const done = new Set(existsSync(out) ? records(out).map((record) => record.url) : []);
    for (const pr of prs) {
      if (done.has(pr.url)) continue;
      const record = await reviewOne(pr, deps);
      appendFileSync(out, `${JSON.stringify(record)}\n`);
      console.log(`${pr.url}: ${record.error ?? `${String(record.findings.length)} findings`}`);
    }
    break;
  }
  case "export": {
    const reviewed = records(values.findings ?? fail("--findings <file> is required"));
    const modelDir = join(resultsDir, judgeModelDir(judgeModel));
    mkdirSync(modelDir, { recursive: true });
    const inputs = judgeInputs(
      prs,
      reviewed,
      readObject(join(resultsDir, "benchmark_data.json")),
      readObject(join(modelDir, "candidates.json")),
    );
    writeFileSync(join(resultsDir, "benchmark_data.json"), `${JSON.stringify(inputs.benchmarkData, null, 2)}\n`);
    writeFileSync(join(modelDir, "candidates.json"), `${JSON.stringify(inputs.candidates, null, 2)}\n`);
    console.log(estimate.text);
    console.log(
      [
        "Judge inputs written. The judge spends the benchmark's API key; run it yourself from the offline folder:",
        `  MARTIAN_MODEL=${judgeModel} uv run python -m code_review_benchmark.step3_judge_comments --tool finitemonkey`,
        `  MARTIAN_MODEL=${judgeModel} uv run python -m code_review_benchmark.step3_judge_comments --tool finitemonkey-reproduced`,
      ].join("\n"),
    );
    break;
  }
  case "score": {
    const scores = scoreArms(readObject(join(resultsDir, judgeModelDir(judgeModel), "evaluations.json")));
    console.log(scoreTable(scores));
    if (values.out !== undefined) {
      writeFileSync(
        values.out,
        `${JSON.stringify({ benchmark: pin.repo, commit: pin.commit, judgeModel, arms: scores }, null, 2)}\n`,
      );
    }
    break;
  }
  default:
    fail(`unknown step ${step || "(none)"}`);
}

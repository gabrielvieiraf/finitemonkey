import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { ExecRequest } from "../src/core/runtime.js";
import { citeVerifier } from "../src/judge/cite.js";
import type { Fetched } from "../src/judge/fetch.js";
import { DEFAULT_NUMBER_EXCEPTIONS, numberVerifier } from "../src/judge/number-verify.js";
import type { NumberLocale } from "../src/judge/numbers.js";
import { parseRequest } from "../src/judge/request.js";
import { type JudgeDeps, runVerb } from "../src/judge/verbs.js";
import { DEFAULT_VERIFIERS } from "../src/judge/verify.js";
import { fmPaths } from "../src/task/paths.js";
import { type MemoryFs, memoryFs } from "./memory-fs.js";
import { execResult, fakeRuntime } from "./support.js";

const ROOT = "/home/ana/project";

const sumOf = (fs: MemoryFs) => (request: ExecRequest) => {
  if (request.command !== "sum data.csv") return undefined;
  const text = fs.read(toAbsolutePath(`${ROOT}/data.csv`)) ?? "";
  const total = text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .reduce((sum, line) => sum + Number(line), 0);
  return execResult(0, `total ${String(total)}\n`);
};

const world = (pages: Readonly<Record<string, string>>, locale: NumberLocale = "en") => {
  const fs = memoryFs({ [`${ROOT}/data.csv`]: "1200\n34\n" }, [toAbsolutePath(`${ROOT}/.finitemonkey`)]);
  const deps: JudgeDeps = {
    runtime: fakeRuntime({ fs, exec: sumOf(fs) }),
    paths: fmPaths(toAbsolutePath(ROOT)),
    fetcher: (id): Fetched => {
      const page = pages[id];
      return page === undefined ? { status: "not-found" } : { status: "ok", content: page };
    },
    verifiers: {
      ...DEFAULT_VERIFIERS,
      "source-span": citeVerifier,
      number: numberVerifier({ locale, exceptions: DEFAULT_NUMBER_EXCEPTIONS }),
    },
  };
  return { fs, deps };
};

const call = (deps: JudgeDeps, record: Readonly<Record<string, unknown>>) => {
  const request = parseRequest(record);
  if (request === undefined) throw new Error(`bad request ${JSON.stringify(record)}`);
  return runVerb(deps, request);
};

const verify = (deps: JudgeDeps, text: string) => {
  const claim = call(deps, { verb: "classify", file: "note.md", text }).result?.rows[0]?.claim;
  return call(deps, { verb: "verify", claim }).claim;
};

describe("numbers anchored to a source span or a computation", () => {
  it("a number that appears in its anchored source is machine-verified, in two locales", () => {
    const en = world({ "https://example.org/guide": "<p>The standard rate is 20% and the cap is 1,234.5 euros.</p>" });
    const english = verify(
      en.deps,
      "The rate is 20% and the cap is 1,234.5 euros ([Guide](https://example.org/guide)).",
    );
    assert.equal(english?.state, "machine-verified");
    assert.deepEqual(
      english.numbers?.map((item) => item.state),
      ["anchored", "anchored"],
    );
    const pt = world({ "https://example.org/guia": "<p>A alíquota padrão é 20% e o teto é 1.234,5 euros.</p>" }, "pt");
    const portuguese = verify(pt.deps, "A alíquota é 20% e o teto é 1.234,5 euros ([Guia](https://example.org/guia)).");
    assert.equal(portuguese?.state, "machine-verified");
  });

  it("a number with no anchor stays not verified", () => {
    const { deps } = world({});
    const claim = verify(deps, "The registration takes 10 working days.");
    assert.equal(claim?.outcome, "unanchored");
    assert.equal(claim.state, "model-only");
    const view = call(deps, { verb: "report" }).results?.[0];
    assert.equal(view?.done, false);
  });

  it("reports a swapped unit or magnitude", () => {
    const { deps } = world({
      "https://example.org/a": "<p>Revenue reached 4 thousand euros.</p>",
      "https://example.org/b": "<p>Turnout rose by 5 percentage points.</p>",
    });
    const magnitude = verify(deps, "Revenue reached 4 million euros ([A](https://example.org/a)).");
    assert.equal(magnitude?.outcome, "unit-mismatch");
    assert.equal(magnitude.numbers?.[0]?.state, "magnitude");
    const unit = verify(deps, "Turnout rose by 5% ([B](https://example.org/b)).");
    assert.equal(unit?.numbers?.[0]?.state, "unit");
    assert.equal(unit.state, "model-only");
  });

  it("a computed number reruns from its hashed inputs and fails when an input changes", () => {
    const { fs, deps } = world({});
    const claim = call(deps, { verb: "classify", file: "n.md", text: "The total is 1234 orders." }).result?.rows[0];
    const anchored = call(deps, { verb: "anchor", claim: claim?.claim, run: "sum data.csv", inputs: ["data.csv"] });
    assert.equal(anchored.ok, true);
    assert.equal(call(deps, { verb: "verify", claim: claim?.claim }).claim?.state, "machine-verified");
    fs.writeText(toAbsolutePath(`${ROOT}/data.csv`), "1200\n35\n");
    const after = verify(deps, "The total is 1234 orders.");
    assert.equal(after?.outcome, "input-changed");
  });

  it("counts the exceptions and lists them in the report", () => {
    const { deps } = world({ "https://example.org/g": "<p>The rate is 20%.</p>" });
    const claim = verify(deps, "In 2021 the rate was 20% ([G](https://example.org/g)).");
    assert.deepEqual(
      claim?.numbers?.map((item) => [item.number, item.state]),
      [
        ["2021", "exception"],
        ["20%", "anchored"],
      ],
    );
    assert.deepEqual(call(deps, { verb: "report" }).exceptions, [{ claim: claim.claim, number: "2021" }]);
  });
});

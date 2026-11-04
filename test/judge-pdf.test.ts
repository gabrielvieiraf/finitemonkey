import assert from "node:assert/strict";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { ExecRequest, Runtime } from "../src/core/runtime.js";
import { checkPdfExtractor } from "../src/doctor/pdf.js";
import { citeVerifier } from "../src/judge/cite.js";
import { curlFetcher } from "../src/judge/fetch.js";
import { pagesOf } from "../src/judge/pdf.js";
import { parseRequest } from "../src/judge/request.js";
import { contentHash } from "../src/judge/span.js";
import { type JudgeDeps, runVerb } from "../src/judge/verbs.js";
import { DEFAULT_VERIFIERS } from "../src/judge/verify.js";
import { fmPaths } from "../src/task/paths.js";
import { type TempRepo, tempRepo, write } from "./git-support.js";
import { repoRuntime } from "./repo.js";
import { execMissing, execResult, fakeRuntime, found } from "./support.js";

const repos: TempRepo[] = [];
after(() => {
  for (const repo of repos) repo.dispose();
});

const PAGE_ONE = "Fabrication in citations\nWilliam H. Walters, Scientific Reports, 2023.\n";
const PAGE_TWO = "Results\nOf the 636 citations, 55% of the GPT-3.5 citations are fabricated.\n";
const QUOTE = "55% of the GPT-3.5 citations are fabricated";
const PDF = "%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n";

const withPdf = (stdout: string | undefined): { readonly runtime: Runtime; readonly seen: ExecRequest[] } => {
  const base = repoRuntime();
  const seen: ExecRequest[] = [];
  return {
    seen,
    runtime: {
      ...base,
      exec: (request: ExecRequest) => {
        if (request.command !== "pdftotext") return base.exec(request);
        seen.push(request);
        return stdout === undefined ? execMissing : execResult(0, stdout);
      },
    },
  };
};

const judgeOf = (runtime: Runtime): { readonly deps: JudgeDeps; readonly repo: TempRepo } => {
  const repo = tempRepo({ "docs/paper.pdf": PDF });
  repos.push(repo);
  write(repo.root, ".fm/policy.yml", "guards:\n  judge-core: shadow\n");
  return {
    repo,
    deps: {
      runtime,
      paths: fmPaths(repo.root),
      fetcher: curlFetcher(runtime, repo.root),
      verifiers: { ...DEFAULT_VERIFIERS, "source-span": citeVerifier, prose: citeVerifier },
    },
  };
};

const call = (deps: JudgeDeps, record: Readonly<Record<string, unknown>>) => {
  const request = parseRequest(record);
  if (request === undefined) throw new Error(`bad request ${JSON.stringify(record)}`);
  return runVerb(deps, request);
};

const verify = (deps: JudgeDeps) => {
  const text = `In the audit, "${QUOTE}" ([Walters 2023](docs/paper.pdf)).`;
  const row = call(deps, { verb: "classify", file: "note.md", text }).result?.rows[0];
  return call(deps, { verb: "verify", claim: row?.claim });
};

describe("PDF sources", () => {
  it("a fixture PDF with a matching quote is verified with the page and the content hash", () => {
    const pdf = withPdf(`${PAGE_ONE}\f${PAGE_TWO}\f`);
    const { deps } = judgeOf(pdf.runtime);
    const verified = verify(deps);
    assert.equal(verified.claim?.state, "machine-verified");
    const anchors = call(deps, { verb: "export" }).export?.support.at(-1)?.anchors;
    assert.deepEqual(anchors, [
      { kind: "span", ref: "docs/paper.pdf", span: QUOTE, hash: contentHash(`${PAGE_ONE}\n${PAGE_TWO}`), page: 2 },
    ]);
    assert.equal(pdf.seen.length, 1);
    assert.deepEqual(pdf.seen[0]?.args.slice(0, 2), ["-enc", "UTF-8"]);
  });

  it("a scanned PDF without text and a machine without the extractor stay not verified", () => {
    const scanned = judgeOf(withPdf("\f\f").runtime);
    assert.equal(verify(scanned.deps).claim?.state, "model-only");
    const missing = judgeOf(withPdf(undefined).runtime);
    assert.equal(verify(missing.deps).claim?.state, "model-only");
  });

  it("a cited PDF URL is saved under the judge folder and read with the local extractor", () => {
    const pdf = withPdf(`${PAGE_ONE}\f${PAGE_TWO}`);
    const curls: ExecRequest[] = [];
    const runtime: Runtime = {
      ...pdf.runtime,
      exec: (request: ExecRequest) => {
        if (request.command !== "curl") return pdf.runtime.exec(request);
        curls.push(request);
        return request.args.includes("-o") ? execResult(0, "") : execResult(0, `${PDF}\n200`);
      },
    };
    const repo = judgeOf(runtime).repo;
    const fetched = curlFetcher(runtime, repo.root)("https://example.org/paper.pdf");
    assert.deepEqual(fetched, { status: "ok", content: `${PAGE_ONE}\n${PAGE_TWO}`, pages: [PAGE_ONE, PAGE_TWO] });
    const saved = curls[1]?.args[curls[1].args.indexOf("-o") + 1] ?? "";
    assert.match(saved, /[\\/]\.finitemonkey[\\/]judge[\\/]pdf[\\/][0-9a-f]{16}\.pdf$/);
    assert.equal(pdf.seen[0]?.args[2], saved);
  });

  it("doctor reports the extractor only where the judge is in use", () => {
    const root = toAbsolutePath("/home/ana/project");
    const env = (
      files: Readonly<Record<string, string>>,
      tools: Readonly<Record<string, ReturnType<typeof found>>>,
    ) => ({
      platform: "linux" as const,
      env: {},
      cwd: root,
      root,
      version: "0.0.0",
      runtime: fakeRuntime({ files, tools }),
    });
    const judge = { [join(root, ".fm", "judge.jsonl")]: "" };
    assert.deepEqual(checkPdfExtractor(env({}, {})), []);
    assert.equal(checkPdfExtractor(env(judge, {}))[0]?.status, "warn");
    assert.equal(checkPdfExtractor(env(judge, { pdftotext: found("pdftotext version 24.02.0") }))[0]?.status, "ok");
  });

  it("splits the extractor output into pages on form feeds", () => {
    assert.deepEqual(pagesOf("one\ftwo\f"), ["one", "two"]);
    assert.deepEqual(pagesOf("only"), ["only"]);
  });
});

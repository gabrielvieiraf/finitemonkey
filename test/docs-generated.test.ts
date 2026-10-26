import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { BLOCKS, CLAIM_FILES, forbiddenPhrases, missingTests, replaceBetween } from "../scripts/docs-gen.js";
import { FAILURE_MODES } from "../scripts/failure-modes.js";
import { FOOTPRINT, SENDS_HOSTS } from "../src/core/footprint.js";
import { ROOT } from "./support.js";

const read = (file: string): string | undefined => {
  try {
    return readFileSync(join(ROOT, file), "utf8");
  } catch {
    return undefined;
  }
};

const sources = (): readonly string[] =>
  readdirSync(join(ROOT, "src"), { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts"))
    .map((file) => readFileSync(join(ROOT, "src", file), "utf8"));

const targets: readonly string[] = FOOTPRINT.flatMap((entry) => entry.targets);

const covered = (path: string): boolean =>
  targets.some(
    (target) => target === path || target === `${path}/` || (target.endsWith("/") && path.startsWith(target)),
  );

describe("failure modes", () => {
  it("every failure mode names a test that exists", () => {
    assert.deepEqual(missingTests(FAILURE_MODES, read), []);
  });

  it("removing the test behind a failure mode is reported", () => {
    const [mode] = FAILURE_MODES;
    assert.ok(mode !== undefined);
    const withoutIt = (file: string): string | undefined =>
      file === mode.file ? (read(file) ?? "").replaceAll(`"${mode.test}"`, '"renamed"') : read(file);
    assert.deepEqual(missingTests(FAILURE_MODES, withoutIt), [
      `${mode.file} has no test named "${mode.test}" (failure mode: ${mode.failure})`,
    ]);
  });
});

describe("generated docs", () => {
  for (const block of BLOCKS) {
    it(`${block.file} ${block.marker} section matches its source`, () => {
      const current = read(block.file) ?? "";
      assert.equal(replaceBetween(current, block.marker, block.render()), current);
    });
  }

  it("a file without markers is reported instead of rewritten", () => {
    assert.equal(replaceBetween("# Title\n", "footprint", "x"), undefined);
  });
});

describe("network claims in docs", () => {
  it("the passing fixture has no forbidden phrase", () => {
    assert.deepEqual(forbiddenPhrases(read("test/fixtures/docs/claims-pass.md") ?? "", ["api.github.com"]), []);
  });

  it("the failing fixture is caught while a host is listed", () => {
    const text = read("test/fixtures/docs/claims-fail.md") ?? "";
    assert.deepEqual(forbiddenPhrases(text, ["api.github.com"]), ["Network: none", "offline only"]);
    assert.deepEqual(forbiddenPhrases(text, []), []);
  });

  for (const file of CLAIM_FILES) {
    it(`${file} does not claim there is no network`, () => {
      assert.deepEqual(forbiddenPhrases(read(file) ?? "", SENDS_HOSTS), []);
    });
  }
});

describe("footprint list matches the code", () => {
  it("every .finitemonkey/ path in src is listed", () => {
    const paths = sources().flatMap((text) =>
      [...text.matchAll(/["`](\.finitemonkey\/[\w./-]+)/g)].map((m) => m[1] ?? ""),
    );
    const unlisted = [...new Set(paths)].filter((path) => path !== ".finitemonkey/" && !covered(path));
    assert.deepEqual(unlisted, []);
  });

  it("every program that reaches the network is listed with its host", () => {
    const programs = sources().flatMap((text) =>
      [...text.matchAll(/command: "(gh|curl|wget|npm|npx)"/g)].map((m) => m[1]),
    );
    const listed: readonly string[] = FOOTPRINT.flatMap((entry) =>
      entry.kind === "sends" && "via" in entry ? [entry.via] : [],
    );
    assert.deepEqual(
      [...new Set(programs)].filter((program) => !listed.includes(program ?? "")),
      [],
    );
  });

  it("src opens no socket of its own", () => {
    const direct = sources().filter((text) => /from "node:(?:https?|net|tls|dgram)"|\bfetch\(/.test(text));
    assert.equal(direct.length, 0);
  });
});

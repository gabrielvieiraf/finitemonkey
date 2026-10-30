import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  BLOCKS,
  CLAIM_FILES,
  forbiddenPhrases,
  missingTests,
  replaceBetween,
  threatProblems,
} from "../scripts/docs-gen.js";
import { FAILURE_MODES } from "../scripts/failure-modes.js";
import { ATTACKERS, type Threat, THREATS } from "../scripts/threat-model.js";
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

describe("threat model", () => {
  const exists = (path: string): boolean => existsSync(join(ROOT, path));

  it("every threat model line cites code that exists and links a test or says not covered", () => {
    assert.deepEqual(threatProblems(THREATS, read, exists), []);
  });

  it("every attacker case has at least one line", () => {
    assert.deepEqual(
      ATTACKERS.filter((attacker) => !THREATS.some((threat) => threat.attacker === attacker)),
      [],
    );
  });

  it("a missing test, a missing path and a covered line without a test are reported", () => {
    const line: Threat = {
      component: "Guards",
      attacker: "mistaken agent",
      threat: "t",
      outcome: "prevented",
      mechanism: "m",
      code: ["src/nowhere.ts"],
      proof: { file: "test/stop.test.ts", test: "renamed" },
    };
    const withoutProof: Threat = {
      component: line.component,
      attacker: line.attacker,
      threat: line.threat,
      outcome: line.outcome,
      mechanism: line.mechanism,
      code: line.code,
    };
    assert.deepEqual(threatProblems([line, withoutProof], read, exists), [
      "src/nowhere.ts does not exist (threat model: t)",
      'test/stop.test.ts has no test named "renamed" (threat model: t)',
      "src/nowhere.ts does not exist (threat model: t)",
      "threat model: t names no test",
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
    const local = new Set([join("app", "node-process.ts"), join("app", "node-probe.ts")]);
    const direct = readdirSync(join(ROOT, "src"), { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".ts") && !local.has(file))
      .filter((file) => /from "node:(?:https?|net|tls|dgram)"|\bfetch\(/.test(read(join("src", file)) ?? ""));
    assert.equal(direct.length, 0);
  });
});

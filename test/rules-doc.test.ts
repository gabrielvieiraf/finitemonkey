import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { readDerived } from "../src/knowledge/derived.js";
import { fmPaths } from "../src/task/paths.js";
import { at, repo, ROOT, run } from "./install-support.js";
import { fakeRuntime, field } from "./support.js";

const RULES = [
  "schemaVersion: 1",
  "rules:",
  "  - id: no-force-push",
  "    text: Never force push a shared branch",
  '    origin: "review of PR 12, 2026-10-20"',
  "    severity: must",
  "",
].join("\n");

const PROSE = "# Team notes\n\nWrite tests first.\n";

const written = (body: unknown): readonly unknown[] => {
  const value = field(body, "data", "written");
  return Array.isArray(value) ? value : [];
};

describe("the generated part of AGENTS.md as a derived file", () => {
  it("keeps the person's text in AGENTS.md and the rule lines in a registered file", async () => {
    const fs = repo({ ".finitemonkey/rules.yml": RULES, "AGENTS.md": PROSE });
    const compiled = await run(fs, ["rules", "compile"]);
    assert.equal(compiled.code, 0, compiled.stdout);
    const agents = fs.read(at("AGENTS.md")) ?? "";
    assert.match(agents, /Write tests first\./);
    assert.match(agents, /^@AGENTS\.rules\.md$/m);
    assert.doesNotMatch(agents, /rule no-force-push/);
    assert.match(fs.read(at("AGENTS.rules.md")) ?? "", /Never force push a shared branch \(rule no-force-push\)/);
    const entry = readDerived(fakeRuntime({ fs }), fmPaths(ROOT)).get("AGENTS.rules.md");
    assert.equal(entry?.generator, "rules");
  });

  it("rebuilds the file only when the rules change", async () => {
    const fs = repo({ ".finitemonkey/rules.yml": RULES });
    assert.ok(written((await run(fs, ["rules", "compile"])).body).includes("AGENTS.rules.md"));
    const again = await run(fs, ["rules", "compile"]);
    assert.ok(!written(again.body).includes("AGENTS.rules.md"));
    assert.ok(!written(again.body).includes("AGENTS.md"));
    fakeRuntime({ fs }).writeText(
      toAbsolutePath(at(".finitemonkey/rules.yml")),
      RULES.replace("Never force push a shared branch", "Never force push to main"),
    );
    const changed = await run(fs, ["rules", "compile"]);
    assert.ok(written(changed.body).includes("AGENTS.rules.md"));
    assert.match(fs.read(at("AGENTS.rules.md")) ?? "", /Never force push to main/);
  });

  it("reports a hand edit and records it as a correction by the person", async () => {
    const fs = repo({ ".finitemonkey/rules.yml": RULES });
    await run(fs, ["rules", "compile"]);
    const runtime = fakeRuntime({ fs });
    const path = toAbsolutePath(at("AGENTS.rules.md"));
    runtime.writeText(path, `${fs.read(at("AGENTS.rules.md")) ?? ""}- Squash before merging\n`);
    const compiled = await run(fs, ["rules", "compile"]);
    assert.deepEqual(field(compiled.body, "data", "edited"), ["- Squash before merging"]);
    assert.match(
      fs.read(at(".finitemonkey/claims.jsonl")) ?? "",
      /Correction to AGENTS\.rules\.md: - Squash before merging/,
    );
    assert.doesNotMatch(fs.read(at("AGENTS.rules.md")) ?? "", /Squash/);
  });

  it("keeps the rule lines inside AGENTS.md when the derived cache is off", async () => {
    const fs = repo({
      ".finitemonkey/rules.yml": RULES,
      ".finitemonkey/policy.yml": "guards:\n  derived-cache: off\n",
    });
    await run(fs, ["rules", "compile"]);
    assert.match(fs.read(at("AGENTS.md")) ?? "", /- Never force push a shared branch \(rule no-force-push\)/);
    assert.equal(fs.read(at("AGENTS.rules.md")), undefined);
  });
});

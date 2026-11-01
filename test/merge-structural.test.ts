import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { structuredMerge } from "../src/merge/structured.js";
import { hunksOf, merge, resultFile, sandbox, sides } from "./merge-support.js";
import { field } from "./support.js";

const CONFIG = "# deploy settings\nname: app\nserver:\n  port: 80\n  host: localhost\nfeatures:\n  - login\n";

describe("merge protocol: structural merges of YAML and TOML (C5)", () => {
  it("a YAML conflict in different keys merges by key and keeps the comments", () => {
    const box = sandbox({ "config.yml": CONFIG });
    try {
      sides(
        box,
        { "config.yml": CONFIG.replace("port: 80\n  host: localhost", "port: 81\n  host: localhost") },
        { "config.yml": CONFIG.replace("port: 80\n  host: localhost", "port: 80\n  host: example.com") },
      );
      const report = merge(box);
      assert.equal(report["outcome"], "merged", JSON.stringify(report["stops"]));
      assert.deepEqual(hunksOf(report, "config.yml"), [{ cls: "C5", rule: "merged-by-key" }]);
      assert.equal(
        resultFile(box, report, "config.yml"),
        "# deploy settings\nname: app\nserver:\n  port: 81\n  host: example.com\nfeatures:\n  - login",
      );
    } finally {
      box.dispose();
    }
  });

  it("the same YAML key changed on both sides stays a conflict", () => {
    const box = sandbox({ "config.yml": CONFIG });
    try {
      sides(
        box,
        { "config.yml": CONFIG.replace("port: 80", "port: 81") },
        {
          "config.yml": CONFIG.replace("port: 80", "port: 82"),
        },
      );
      const report = merge(box);
      assert.equal(report["outcome"], "stopped");
      assert.deepEqual(hunksOf(report, "config.yml"), [{ cls: "C7", rule: "same-key-different-values: server.port" }]);
    } finally {
      box.dispose();
    }
  });

  it("TOML tables and keys merge by key; the same key stays a conflict", () => {
    const base = 'title = "app"\n\n[server]\nport = 80\nhost = "localhost"\n';
    const ours = base.replace("port = 80", "port = 81");
    const theirs = `${base.replace('"localhost"', '"example.com"')}\n[db]\nurl = "postgres://db"\n`;
    const merged = structuredMerge("app.toml", base, ours, theirs);
    assert.equal(
      merged?.text,
      'title = "app"\n\n[server]\nport = 81\nhost = "example.com"\n\n[db]\nurl = "postgres://db"\n',
    );
    const same = structuredMerge("app.toml", base, ours, base.replace("port = 80", "port = 82"));
    assert.deepEqual(same?.conflicts, [{ key: "[server].port" }]);
  });

  it("YAML that is not a mapping is left to the line merge", () => {
    assert.equal(structuredMerge("list.yml", "- a\n", "- a\n- b\n", "- a\n- c\n"), undefined);
  });
});

describe("merge protocol: owners of C0 conflicts", () => {
  it("lists every CODEOWNERS owner of a C0 file in the report", () => {
    const page = 'export const title = "Home";\n';
    const box = sandbox({
      "src/billing/page.ts": page,
      ".github/CODEOWNERS": "* @lead\nsrc/billing/ @ana @acme/payments\n",
      "contracts/target.yml": "scope:\n  paths: [src/shared/**]\n",
      "contracts/source.yml": "scope:\n  paths: [src/pages/**]\n",
    });
    try {
      sides(
        box,
        { "src/billing/page.ts": page.replace("Home", "Inicio") },
        {
          "src/billing/page.ts": page.replace("Home", "Start"),
        },
      );
      const report = merge(
        box,
        "--target-contract",
        "contracts/target.yml",
        "--source-contract",
        "contracts/source.yml",
      );
      assert.equal(report["outcome"], "stopped");
      const files = report["files"];
      assert.ok(Array.isArray(files));
      const file: unknown = files.find((item: unknown) => field(item, "path") === "src/billing/page.ts");
      assert.equal(field(file, "class"), "C0");
      assert.deepEqual(field(file, "owners"), ["@ana", "@acme/payments"]);
    } finally {
      box.dispose();
    }
  });
});

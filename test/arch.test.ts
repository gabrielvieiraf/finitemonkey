import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { format } from "prettier";

import { parseArch } from "../src/arch/config.js";
import { archFiles, type ArchTool } from "../src/arch/generate.js";
import { importEdges } from "../src/arch/imports.js";
import { git, type TempRepo, tempRepo, write } from "./git-support.js";
import { repoRuntime } from "./repo.js";
import { cliJson, field, ROOT } from "./support.js";
import { trustContract } from "./trusted-contract.js";

const FIXTURES = join(ROOT, "test", "fixtures", "arch");
const deny = (from: string, allowed: readonly string[]): string => `${from} may import only: ${allowed.join(", ")}`;

const CASES: readonly (readonly [string, readonly ArchTool[], boolean])[] = [
  ["js", ["eslint", "boundaries", "dependency-cruiser"], false],
  ["py", ["import-linter"], false],
  ["jvm", ["archunit"], false],
  ["jvm", ["archunit"], true],
  ["go", ["depguard"], false],
];

const generated = (stack: string, tools: readonly ArchTool[], kotlin: boolean) => {
  const parsed = parseArch(readFileSync(join(FIXTURES, `${stack}.yml`), "utf8"));
  assert.ok(parsed.ok);
  return archFiles(parsed.value, tools, deny, {
    exists: (file) => kotlin && file === "build.gradle.kts",
    goModule: "example.com/shop",
  });
};

const fixtureName = (stack: string, kotlin: boolean, path: string): string =>
  join(FIXTURES, `${stack}${kotlin ? "-kotlin" : ""}.${path.replace(/\//g, "_")}`);

const repos: TempRepo[] = [];
after(() => {
  for (const repo of repos) repo.dispose();
});

const ARCH = readFileSync(join(FIXTURES, "js.yml"), "utf8");
const CONTRACT = "id: layers\ngoal: keep the layers\nacceptance:\n  - id: arch\n    check: arch\n";

const archItem = async (repo: TempRepo): Promise<unknown> => {
  const run = await cliJson(["gate"], { cwd: repo.root, runtime: repoRuntime() });
  const items = field(run.body, "data", "items");
  return Array.isArray(items) ? items.find((item) => field(item, "id") === "arch") : undefined;
};

const noteKeys = (item: unknown): readonly unknown[] => {
  const notes = field(item, "notes");
  return Array.isArray(notes) ? notes.map((entry) => field(entry, "key")) : [];
};

describe("arch: one file, configs per stack, and a ratchet", () => {
  for (const [stack, tools, kotlin] of CASES) {
    it(`generates the ${tools.join(", ")} config${kotlin ? " for Kotlin" : ""} as in its fixture`, () => {
      for (const file of generated(stack, tools, kotlin)) {
        const path = fixtureName(stack, kotlin, file.path);
        if (process.env["FM_UPDATE_FIXTURES"] === "1") writeFileSync(path, file.content);
        assert.equal(file.content, readFileSync(path, "utf8"), path);
      }
    });
  }

  it("writes JSON configs the way prettier formats them", async () => {
    for (const file of generated("js", ["eslint", "boundaries", "dependency-cruiser"], false)) {
      assert.equal(await format(file.content, { parser: "json" }), file.content, file.path);
    }
  });

  it("resolves imports in Python, Go and Java", () => {
    const files: Readonly<Record<string, string>> = {
      "src/shop/domain/order.py": "from shop.infra import db\nfrom . import money\n",
      "src/shop/domain/money.py": "",
      "src/shop/infra/db.py": "",
      "internal/domain/a.go": 'import (\n  "example.com/shop/internal/infra"\n)\n',
      "internal/infra/db.go": "",
      "src/main/java/com/acme/shop/domain/Order.java": "import com.acme.shop.infra.Db;\n",
      "src/main/java/com/acme/shop/infra/Db.java": "",
    };
    const edges = importEdges({ files: Object.keys(files), read: (path) => files[path], goModule: "example.com/shop" });
    assert.deepEqual(
      edges.map((edge) => `${edge.from} -> ${edge.to}`),
      [
        "src/shop/domain/order.py -> src/shop/infra/db.py",
        "src/shop/domain/order.py -> src/shop/domain/money.py",
        "internal/domain/a.go -> internal/infra/db.go",
        "src/main/java/com/acme/shop/domain/Order.java -> src/main/java/com/acme/shop/infra/Db.java",
      ],
    );
  });

  it("records old violations, fails only new ones and drops fixed ones from the baseline", async () => {
    const repo = tempRepo({
      ".finitemonkey/arch.yml": ARCH,
      "src/infra/db.js": "export const db = 1;\n",
      "src/domain/order.js": 'import { db } from "../infra/db.js";\nexport const order = db;\n',
    });
    repos.push(repo);
    trustContract(repo.root, "layers", CONTRACT);
    write(repo.root, "src/domain/note.js", "export const note = 1;\n");
    const first = await archItem(repo);
    assert.equal(field(first, "status"), "passed");
    assert.ok(noteKeys(first).includes("gate.arch.adopted"));
    write(repo.root, "src/domain/pay.js", 'import { db } from "../infra/db.js";\nexport const pay = db;\n');
    const fresh = await archItem(repo);
    assert.equal(field(fresh, "status"), "failed");
    const notes = field(fresh, "notes");
    assert.ok(Array.isArray(notes));
    assert.equal(field(notes[0], "params", "file"), "src/domain/pay.js");
    assert.ok(!JSON.stringify(notes).includes('order.js"'));
    write(repo.root, "src/domain/pay.js", "export const pay = 2;\n");
    write(repo.root, "src/domain/order.js", "export const order = 1;\n");
    const fixed = await archItem(repo);
    assert.equal(field(fixed, "status"), "passed");
    assert.ok(noteKeys(fixed).includes("gate.arch.fixed"));
    const baseline = readFileSync(join(repo.root, ".finitemonkey/findings/baseline.json"), "utf8");
    assert.ok(!baseline.includes('"check": "arch"'));
    git(repo.root, "status", "--short");
  });
});

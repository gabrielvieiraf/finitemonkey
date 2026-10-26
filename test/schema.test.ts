import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { before, describe, it } from "node:test";

import { generateSchemas, SCHEMA_DIR, staleSchemas } from "../scripts/schema-gen.js";
import { compatProblems, validate } from "./schema-compat.js";
import { cliJson, field, parseBody, ROOT } from "./support.js";

const FROZEN = join(ROOT, "test", "fixtures", "schema");

const readJson = (path: string): unknown => parseBody(readFileSync(path, "utf8"));

const published = (): readonly string[] => readdirSync(join(ROOT, SCHEMA_DIR)).filter((name) => name.endsWith(".json"));

const sample = {
  type: "object",
  properties: {
    schema: { const: "finitemonkey/sample@1" },
    status: { type: "string", enum: ["ok", "fail"] },
    items: { type: "array", items: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
    note: { type: "string" },
  },
  required: ["schema", "status", "items"],
};

const without = (key: string): unknown => {
  const properties = Object.fromEntries(Object.entries(sample.properties).filter(([name]) => name !== key));
  return { ...sample, properties, required: sample.required.filter((name) => name !== key) };
};

describe("published JSON schemas", () => {
  let fresh: ReadonlyMap<string, string> = new Map();
  before(() => {
    fresh = generateSchemas(ROOT);
  });

  it("docs/schema matches a fresh generation from the TypeScript types", () => {
    const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
    const committed = published().map((name) => `${SCHEMA_DIR}/${name}`);
    assert.deepEqual(staleSchemas(fresh, committed, read), []);
  });

  it("a stale or orphan schema file is reported", () => {
    const [path = "", text = ""] = [...fresh][0] ?? [];
    const problems = staleSchemas(fresh, [path, `${SCHEMA_DIR}/gone@1.json`], (file) =>
      file === path ? text.replace("required", "needed") : (fresh.get(file) ?? ""),
    );
    assert.deepEqual(problems, [
      `${path} is out of date with its type`,
      `${SCHEMA_DIR}/gone@1.json has no source in scripts/schema-gen.ts`,
    ]);
  });

  it("every published schema has a frozen copy", () => {
    const frozen = readdirSync(FROZEN);
    for (const name of published()) assert.ok(frozen.includes(name), `freeze ${name} in test/fixtures/schema`);
  });

  for (const name of readdirSync(FROZEN).filter((file) => file.endsWith(".json"))) {
    it(`${name} only gained fields since it was frozen`, () => {
      const current = readJson(join(ROOT, SCHEMA_DIR, name));
      assert.deepEqual(compatProblems(readJson(join(FROZEN, name)), current), []);
    });
  }

  it("doctor --json data validates against doctor@1", async () => {
    const { body } = await cliJson(["doctor"]);
    assert.deepEqual(validate(readJson(join(ROOT, SCHEMA_DIR, "doctor@1.json")), field(body, "data")), []);
  });

  it("every --json envelope validates against envelope@1", async () => {
    const { body } = await cliJson(["version"]);
    assert.deepEqual(validate(readJson(join(ROOT, SCHEMA_DIR, "envelope@1.json")), body), []);
  });
});

describe("schema compatibility rule: add-only within a version", () => {
  it("adding a field passes", () => {
    const added = { ...sample, properties: { ...sample.properties, extra: { type: "number" } } };
    assert.deepEqual(compatProblems(sample, added), []);
  });

  it("removing a field fails", () => {
    assert.deepEqual(compatProblems(sample, without("note")), ["$.note was removed or renamed"]);
  });

  it("renaming a field fails", () => {
    const { status, ...rest } = sample.properties;
    const renamed = { ...sample, properties: { ...rest, state: status } };
    assert.deepEqual(compatProblems(sample, renamed), ["$.status was removed or renamed"]);
  });

  it("renaming a nested field fails", () => {
    const items = {
      type: "array",
      items: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
    };
    const changed = { ...sample, properties: { ...sample.properties, items } };
    assert.deepEqual(compatProblems(sample, changed), ["$.items[].id was removed or renamed"]);
  });

  it("retyping, loosening or narrowing a field fails", () => {
    const retyped = { ...sample, properties: { ...sample.properties, note: { type: "number" } } };
    assert.deepEqual(compatProblems(sample, retyped), ["$.note changed type"]);
    const optional = { ...sample, required: ["schema", "items"] };
    assert.deepEqual(compatProblems(sample, optional), ["$.status is no longer required"]);
    const narrowed = { ...sample, properties: { ...sample.properties, status: { type: "string", enum: ["ok"] } } };
    assert.deepEqual(compatProblems(sample, narrowed), ['$.status no longer allows "fail"']);
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { isRecord, type JsonObject } from "../src/core/parsed.js";
import { ERROR_CODES } from "../src/core/problem.js";
import { ExitCode } from "../src/exit-codes.js";
import { cliJson, field, parseBody, ROOT } from "./support.js";

interface Shape {
  readonly required: Readonly<Record<string, string>>;
  readonly optional: Readonly<Record<string, string>>;
}

const frozen = parseBody(readFileSync(join(ROOT, "test", "fixtures", "contract-v1.json"), "utf8"));

const stringMap = (value: unknown): Readonly<Record<string, string>> => {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
};

const shape = (name: string): Shape => ({
  required: stringMap(field(frozen, name, "required")),
  optional: stringMap(field(frozen, name, "optional")),
});

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const typeOf = (value: unknown): string => (Array.isArray(value) ? "array" : value === null ? "null" : typeof value);

const assertShape = (value: unknown, name: string, label: string): void => {
  assert.ok(isRecord(value), `${label} is an object`);
  const { required, optional } = shape(name);
  for (const [key, type] of Object.entries(required)) {
    assert.ok(key in value, `${label}.${key} must stay in the contract`);
    assert.equal(typeOf(value[key]), type, `${label}.${key} must stay ${type}`);
  }
  for (const [key, type] of Object.entries(optional)) {
    if (key in value && type !== "any") assert.equal(typeOf(value[key]), type, `${label}.${key} must stay ${type}`);
  }
};

const assertEnvelope = (body: JsonObject, command: string): void => {
  assertShape(body, "envelope", "envelope");
  assert.equal(body["schemaVersion"], 1);
  assert.equal(body["command"], command);
  if (body["ok"] === false) assertShape(body["error"], "error", "error");
};

const items = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

describe("JSON output contract v1: fields may only be added", () => {
  const cases = [
    { argv: ["version"], command: "version", data: "version" },
    { argv: ["help"], command: "help", data: "help" },
    { argv: ["doctor"], command: "doctor", data: "doctor" },
    { argv: ["i18n", "check"], command: "i18n check", data: "i18nCheck" },
    { argv: ["nope"], command: "nope", data: undefined },
    { argv: ["init"], command: "init", data: undefined },
    { argv: ["secrets", "scan"], command: "secrets scan", data: "secretsScan" },
    { argv: ["secrets", "incident"], command: "secrets incident", data: "secretsIncidents" },
  ] as const;

  for (const { argv, command, data } of cases) {
    it(`${argv.join(" ")} keeps the envelope${data === undefined ? "" : ` and ${data} data`}`, async () => {
      const { body } = await cliJson(argv);
      assertEnvelope(body, command);
      if (data !== undefined) assertShape(body["data"], data, `${command}.data`);
    });
  }

  it("help commands and doctor items keep their shapes", async () => {
    const help = await cliJson(["help"]);
    for (const command of items(field(help.body, "data", "commands"))) {
      assertShape(command, "helpCommand", "help.data.commands[]");
    }
    const doctor = await cliJson(["doctor"]);
    assert.equal(field(doctor.body, "data", "schema"), field(frozen, "doctor", "schema"));
    assertShape(field(doctor.body, "data", "summary"), "doctorSummary", "doctor.data.summary");
    const statuses = strings(field(frozen, "doctorItem", "statuses"));
    for (const item of items(field(doctor.body, "data", "checks"))) {
      assertShape(item, "doctorItem", "doctor.data.checks[]");
      assert.ok(statuses.includes(String(field(item, "status"))));
    }
  });

  it("exit codes never change value", () => {
    assert.deepEqual({ ...ExitCode }, field(frozen, "exitCodes"));
  });

  it("frozen error codes are never removed", () => {
    const known: readonly string[] = ERROR_CODES;
    for (const code of strings(field(frozen, "errorCodes"))) {
      assert.ok(known.includes(code), `error code ${code} disappeared`);
    }
  });
});

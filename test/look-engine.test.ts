import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { engineLines } from "../src/commands/init.js";
import { toAbsolutePath } from "../src/core/brand.js";
import type { ExecRequest } from "../src/core/runtime.js";
import { checkLookEngine } from "../src/doctor/look-engine.js";
import type { DoctorEnv } from "../src/doctor/types.js";
import { createTranslator } from "../src/i18n/translate.js";
import { enginePlan } from "../src/look/engine.js";
import { missingEngine } from "../src/look/node-ux.js";
import { cli, execResult, fakeRuntime } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/app");
const file = (name: string) => toAbsolutePath(`${ROOT}/${name}`);
const LOOK = { [file(".finitemonkey/look.yml")]: "port: 3000\n" };
const PACKAGE = { [file("package.json")]: JSON.stringify({ name: "app", devDependencies: { vite: "^7.0.0" } }) };

const runtimeWith = (files: Readonly<Record<string, string>>, calls: ExecRequest[] = []) =>
  fakeRuntime({
    files,
    exec: (request) => {
      calls.push(request);
      return request.args.includes("axe-core") ? execResult(0, "added 1 package") : undefined;
    },
  });

const doctorEnv = (files: Readonly<Record<string, string>>): DoctorEnv => ({
  platform: "linux",
  env: {},
  cwd: ROOT,
  root: ROOT,
  version: "9.9.9-test",
  runtime: runtimeWith(files),
});

describe("a11y rule engine from the project", () => {
  it("doctor names the missing engine when the project uses look, and stays quiet otherwise", () => {
    assert.deepEqual(checkLookEngine(doctorEnv({ ...LOOK, ...PACKAGE })), [
      {
        check: "look.engine",
        status: "warn",
        messageKey: "doctor.look.engine_missing",
        params: { package: "axe-core", size: 3 },
        fixKey: "doctor.look.fix_engine",
      },
    ]);
    assert.deepEqual(checkLookEngine(doctorEnv(PACKAGE)), []);
    const declared = { [file("package.json")]: JSON.stringify({ devDependencies: { "axe-core": "^4.10.0" } }) };
    assert.deepEqual(checkLookEngine(doctorEnv({ ...LOOK, ...declared })), []);
  });

  it("without the engine the check is not verified, never passed", () => {
    assert.deepEqual(
      missingEngine(true).map((item) => [item.rule, item.unverified]),
      [["a11y/engine", true]],
    );
    assert.deepEqual(missingEngine(false), []);
  });

  it("the plan names the package, size and command and installs nothing without consent", () => {
    const calls: ExecRequest[] = [];
    const plan = enginePlan(runtimeWith({ ...LOOK, ...PACKAGE }, calls), ROOT, false);
    assert.deepEqual(plan, {
      package: "axe-core",
      sizeMb: 3,
      present: false,
      command: "npm install --save-dev axe-core",
      added: false,
    });
    assert.equal(calls.length, 0);
    const lines = engineLines(createTranslator("en"), plan, false);
    assert.match(lines[0] ?? "", /axe-core is missing.*about 3 MB: npm install --save-dev axe-core/);
    assert.match(lines[1] ?? "", /nothing was installed/);
  });

  it("with consent the package manager of the project adds it as a dev dependency", () => {
    const calls: ExecRequest[] = [];
    const files = { ...LOOK, ...PACKAGE, [file("pnpm-lock.yaml")]: "lockfileVersion: 9\n" };
    const plan = enginePlan(runtimeWith(files, calls), ROOT, true);
    assert.equal(plan.added, true);
    assert.deepEqual(
      calls.map((call) => [call.command, ...call.args].join(" ")),
      ["pnpm add --save-dev axe-core"],
    );
  });

  it("an engine already in the project is reported as present and nothing runs", () => {
    const calls: ExecRequest[] = [];
    const files = { ...LOOK, [file("node_modules/axe-core/axe.min.js")]: "/* axe */" };
    const plan = enginePlan(runtimeWith(files, calls), ROOT, true);
    assert.equal(plan.present, true);
    assert.equal(calls.length, 0);
  });

  it("init --look --yes from an agent prints the plan and installs nothing", async () => {
    const calls: ExecRequest[] = [];
    const run = await cli(["init", "--look", "--yes"], {
      runtime: runtimeWith({ ...LOOK, ...PACKAGE }, calls),
      cwd: ROOT,
    });
    assert.match(run.stdout + run.stderr, /npm install --save-dev axe-core/);
    assert.equal(calls.filter((call) => call.args.includes("axe-core")).length, 0);
  });
});

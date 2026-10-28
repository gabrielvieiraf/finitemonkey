import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { ESLint } from "eslint";
import * as prettier from "prettier";

import { toAbsolutePath } from "../src/core/brand.js";
import { mergeEslintConfig } from "../src/generate/lint/merge.js";
import { python, type TempProject, tempProject } from "./gen-support.js";
import { cliJson, fakeRuntime, field } from "./support.js";

const PACKAGE = JSON.stringify({
  name: "app",
  type: "module",
  devDependencies: { eslint: "*", "typescript-eslint": "*", typescript: "*", prettier: "*" },
  dependencies: { axios: "*" },
});

const CLEAN: Readonly<Record<string, string>> = {
  "package.json": `${PACKAGE}\n`,
  "tsconfig.json": '{ "compilerOptions": { "strict": true } }\n',
  "src/screens/home.ts": 'import { loadUser } from "../api/users.js";\n\nexport const home = () => loadUser();\n',
  "src/api/users.ts": 'import axios from "axios";\n\nexport const loadUser = () => axios.get("/user");\n',
  "src/mocks/handlers.ts": "export const handlers = [];\n",
  "src/mocks/browser.ts": 'import { handlers } from "./handlers.js";\n\nexport const worker = handlers;\n',
  "src/types.ts": "export interface Thing {\n  readonly id: string;\n}\n",
};

interface Fixture {
  readonly rule: string;
  readonly file: string;
  readonly failing: string;
  readonly passing: string;
}

const FIXTURES: readonly Fixture[] = [
  {
    rule: "finitemonkey/no-comments",
    file: "src/comments.ts",
    failing: "// explains the code\nexport const a = 1;\n",
    passing: "#!/usr/bin/env node\nexport const a = 1;\n",
  },
  {
    rule: "no-restricted-globals",
    file: "src/screens/list.ts",
    failing: 'export const list = () => fetch("/items");\n',
    passing: 'import { loadUser } from "../api/users.js";\n\nexport const list = () => loadUser();\n',
  },
  {
    rule: "no-restricted-imports",
    file: "src/screens/mocked.ts",
    failing: 'import { handlers } from "../mocks/handlers.js";\n\nexport const mocked = handlers;\n',
    passing: 'import { home } from "./home.js";\n\nexport const mocked = home;\n',
  },
  {
    rule: "no-restricted-imports",
    file: "src/screens/client.ts",
    failing: 'import axios from "axios";\n\nexport const client = axios;\n',
    passing: 'import { loadUser } from "../api/users.js";\n\nexport const client = loadUser;\n',
  },
  {
    rule: "@typescript-eslint/no-explicit-any",
    file: "src/any.ts",
    failing: "export const id = (value: any) => value;\n",
    passing: "export const id = (value: unknown) => value;\n",
  },
  {
    rule: "@typescript-eslint/no-non-null-assertion",
    file: "src/bang.ts",
    failing: "export const first = (items: string[]) => items[0]!;\n",
    passing: 'export const first = (items: string[]) => items[0] ?? "";\n',
  },
  {
    rule: "no-console",
    file: "src/log.ts",
    failing: 'export const log = () => console.log("x");\n',
    passing: "export const log = () => 1;\n",
  },
  {
    rule: "no-restricted-syntax",
    file: "src/default.ts",
    failing: "const value = 1;\nexport default value;\n",
    passing: "export const value = 1;\n",
  },
  {
    rule: "no-restricted-syntax",
    file: "src/enum.ts",
    failing: "export enum Color {\n  Red,\n}\n",
    passing: 'export const COLORS = ["red"] as const;\n',
  },
  {
    rule: "@typescript-eslint/consistent-type-imports",
    file: "src/typed.ts",
    failing: 'import { Thing } from "./types.js";\n\nexport const idOf = (thing: Thing) => thing.id;\n',
    passing: 'import type { Thing } from "./types.js";\n\nexport const idOf = (thing: Thing) => thing.id;\n',
  },
];

const ruleIds = async (project: TempProject, file: string, text: string): Promise<readonly string[]> => {
  project.write(file, text);
  const eslint = new ESLint({ cwd: project.root });
  const [result] = await eslint.lintFiles([file]);
  return (result?.messages ?? []).map((message) => message.ruleId ?? `fatal: ${message.message}`);
};

describe("gen lint on a real project", () => {
  let project: TempProject;

  before(async () => {
    project = tempProject(CLEAN);
    const run = await project.run(["gen", "lint", "--yes"]);
    assert.equal(run.code, 0, run.stdout + run.stderr);
  });

  after(() => {
    project.cleanup();
  });

  it("a generated project passes its own lint and formatter on the first commit", async () => {
    const eslint = new ESLint({ cwd: project.root });
    const results = await eslint.lintFiles(["."]);
    const messages = results.flatMap((result) => result.messages.map((item) => `${result.filePath}: ${item.message}`));
    assert.deepEqual(messages, []);
    for (const file of ["eslint.config.mjs", "eslint.finitemonkey.mjs"]) {
      const text = readFileSync(join(project.root, file), "utf8");
      assert.ok(await prettier.check(text, { filepath: join(project.root, file) }), file);
    }
  });

  for (const fixture of FIXTURES) {
    it(`${fixture.rule} fails ${fixture.file} and passes the fixed version`, async () => {
      assert.ok((await ruleIds(project, fixture.file, fixture.failing)).includes(fixture.rule));
      assert.deepEqual(await ruleIds(project, fixture.file, fixture.passing), []);
    });
  }
});

describe("gen lint merges an existing config", () => {
  it("keeps the project's own rules and adds the generated ones", async () => {
    const project = tempProject({
      ...CLEAN,
      "eslint.config.mjs":
        'import tseslint from "typescript-eslint";\n\nexport default [\n  { files: ["**/*.ts"], languageOptions: { parser: tseslint.parser }, rules: { eqeqeq: "error" } }\n];\n',
    });
    try {
      const run = await project.run(["gen", "lint", "--yes"]);
      assert.equal(run.code, 0, run.stdout);
      const config = readFileSync(join(project.root, "eslint.config.mjs"), "utf8");
      assert.match(config, /eqeqeq/);
      assert.match(config, /\.\.\.finitemonkey/);
      assert.deepEqual(await ruleIds(project, "src/eq.ts", "export const same = (a: number) => a == 1;\n"), ["eqeqeq"]);
      assert.ok(
        (await ruleIds(project, "src/c.ts", "// note\nexport const c = 1;\n")).includes("finitemonkey/no-comments"),
      );
      const again = await project.run(["gen", "lint", "--yes"]);
      assert.match(again.stdout, /Nothing to write/);
    } finally {
      project.cleanup();
    }
  });

  it("merges array, defineConfig and tseslint.config forms and leaves unknown shapes alone", () => {
    for (const text of [
      "export default [{ rules: {} }];\n",
      'import { defineConfig } from "eslint/config";\nexport default defineConfig([{ rules: {} }]);\n',
      'import tseslint from "typescript-eslint";\nexport default tseslint.config({ rules: {} });\n',
    ]) {
      const merged = mergeEslintConfig(text) ?? "";
      assert.match(merged, /^import \{ finitemonkey \}/m);
      assert.match(merged, /\.\.\.finitemonkey,\n[\])]/);
    }
    assert.equal(mergeEslintConfig("module.exports = [];\n"), undefined);
  });
});

describe("gen lint plan", () => {
  it("shows the plan and writes nothing without --yes, and never overwrites a file that differs", async () => {
    const root = toAbsolutePath("/home/ana/project");
    const runtime = fakeRuntime({
      files: {
        [`${root}/package.json`]: PACKAGE,
        [`${root}/eslint.finitemonkey.mjs`]: "export const finitemonkey = [];\n",
      },
    });
    const preview = await cliJson(["gen", "lint"], { runtime, cwd: root });
    assert.equal(preview.code, 0);
    assert.deepEqual(field(preview.body, "data", "written"), []);
    assert.equal(runtime.readText(toAbsolutePath(`${root}/eslint.config.mjs`)).ok, false);
    const applied = await cliJson(["gen", "lint", "--yes"], { runtime, cwd: root });
    assert.deepEqual(field(applied.body, "data", "written"), ["eslint.config.mjs"]);
    const kept = runtime.readText(toAbsolutePath(`${root}/eslint.finitemonkey.mjs`));
    assert.equal(kept.ok && kept.value, "export const finitemonkey = [];\n");
  });

  it("is off when policy.yml turns lint-gen off", async () => {
    const root = toAbsolutePath("/home/ana/project");
    const runtime = fakeRuntime({
      files: { [`${root}/package.json`]: PACKAGE, [`${root}/.finitemonkey/policy.yml`]: "guards:\n  lint-gen: off\n" },
    });
    const run = await cliJson(["gen", "lint", "--yes"], { runtime, cwd: root });
    assert.equal(field(run.body, "data", "mode"), "off");
    assert.deepEqual(field(run.body, "data", "written"), []);
  });
});

describe("python no-comments checker", () => {
  const command = python();
  it("fails a comment and passes tool directives", { skip: command === undefined }, async () => {
    const project = tempProject({ "pyproject.toml": '[project]\nname = "app"\n' }, false);
    try {
      const run = await project.run(["gen", "lint", "--yes", "--preset", "no-comments"]);
      assert.equal(run.code, 0, run.stdout);
      project.write("bad/app.py", "x = 1  # explains x\n");
      project.write("good/app.py", "#!/usr/bin/env python3\nimport os  # noqa: F401\n\nx = 1\n");
      const check = (dir: string) =>
        spawnSync(command ?? "python3", ["scripts/check_no_comments.py", dir], { cwd: project.root, encoding: "utf8" });
      const bad = check("bad");
      assert.equal(bad.status, 1);
      assert.match(bad.stdout, /app\.py:1:8/);
      assert.equal(check("good").status, 0);
    } finally {
      project.cleanup();
    }
  });
});

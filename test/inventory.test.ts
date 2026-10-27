import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { inventoryOutcome } from "../src/gate/checks/inventory.js";
import { inventoryStates } from "../src/inventory/expiry.js";
import { CREDENTIAL_HINTS, ENV, JOBS, QUEUES, ROUTES, TABLES } from "../src/inventory/patterns.js";
import { readFront } from "../src/plan/front.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { SAMPLES } from "./secret-samples.js";
import { cli, cliJson, field } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const app = (): Repo => {
  const made = makeRepo({
    "src/api.js": 'app.get("/coupons", list);\napp.post("/coupons", create);\n',
    "src/db/schema.sql": "CREATE TABLE coupons (id int);\n",
    "src/config.js": `export const key = process.env.STRIPE_KEY;\nexport const gh = "${SAMPLES.githubPat}";\n`,
    "src/jobs.js": 'cron.schedule("0 * * * *", expire);\n',
    "package.json": '{\n  "dependencies": {\n    "express": "4.21.0"\n  }\n}\n',
    "test/api.test.js": "test('x', () => {});\n",
    "README.md": "# app\n",
  });
  repos.push(made);
  return made;
};

const head = (repo: Repo): string => repo.git("rev-parse", "HEAD").trim();

const inventory = async (repo: Repo, ...args: readonly string[]) =>
  cliJson(["inventory", "coupons", ...args], { cwd: repo.root, runtime: repoRuntime() });

const gateStatus = (repo: Repo): string => inventoryOutcome(inventoryStates(repoRuntime(), repo.root)).status;

describe("finitemonkey inventory", () => {
  it("uses only POSIX ERE in git grep patterns, so macOS finds the same lines", () => {
    for (const grep of [ROUTES, TABLES, QUEUES, JOBS, ENV, CREDENTIAL_HINTS]) {
      assert.doesNotMatch(grep.pattern, /\\[bBdDsSwW<>]/, grep.pattern);
    }
  });

  it("starts the report with the hash of every repo read", async () => {
    const main = app();
    const other = makeRepo({ "lib/a.js": "export const a = 1;\n" });
    repos.push(other);
    const { code, body } = await inventory(main, "--repo", ".", "--repo", other.root);
    assert.equal(code, 0);
    assert.equal(field(body, "data", "file"), "docs/plan/01a-today-coupons.md");
    const text = main.read("docs/plan/01a-today-coupons.md");
    const top = text.split("\n").slice(0, 12).join("\n");
    assert.match(top, new RegExp(`hash: "?${head(main)}`));
    assert.match(top, new RegExp(`hash: "?${head(other)}`));
    const body2 = readFront(text).body;
    assert.match(body2, new RegExp(`^# Today: coupons\\n\\nRead \`\\.\` at ${head(main)}`));
    assert.ok(body2.indexOf(head(other)) < body2.indexOf("## Active risks"));
  });

  it("lists routes, tables, jobs, env names, dependencies and tests with file:line", async () => {
    const main = app();
    await inventory(main);
    const text = main.read("docs/plan/01a-today-coupons.md");
    assert.match(text, /`src\/api.js:1` `app.get\("\/coupons", list\);`/);
    assert.match(text, /`src\/db\/schema.sql:1`/);
    assert.match(text, /`src\/jobs.js:1`/);
    assert.match(text, /- `STRIPE_KEY`: `src\/config.js:1`/);
    assert.match(text, /- `express` 4.21.0: `package.json:3`/);
    assert.match(text, /1 test file\./);
    assert.match(text, /\| The plan says \| The code does today \| Effect \|/);
  });

  it("cites secrets by file and line only", async () => {
    const main = app();
    const human = await cli(["inventory", "coupons"], { cwd: main.root, runtime: repoRuntime() });
    assert.equal(human.code, 0);
    const text = main.read("docs/plan/01a-today-coupons.md");
    assert.ok(!text.includes(SAMPLES.githubPat));
    assert.ok(!human.stdout.includes(SAMPLES.githubPat));
    assert.match(text, /\| Credential in a tracked file \([\w-]+\) \| yes \| `src\/config.js:2` \|/);
    assert.match(text, /## Credentials\n\nCited by file and line only\. [^\n]+\n\n- `src\/config.js:2` \(/);
  });

  it("expires when a covered path changes and passes again after the delta", async () => {
    const main = app();
    const before = head(main);
    await inventory(main, "--path", "src");
    main.commit("plan");
    assert.equal(gateStatus(main), "passed");
    main.write("README.md", "# app v2\n");
    assert.equal(gateStatus(main), "passed");
    main.write("src/api.js", 'app.get("/coupons", list);\n');
    const outcome = inventoryOutcome(inventoryStates(repoRuntime(), main.root));
    assert.equal(outcome.status, "failed");
    assert.deepEqual(
      outcome.notes.map((item) => [item.key, item.params["paths"]]),
      [["gate.inventory.expired", "src/api.js"]],
    );
    main.commit("drop create");
    assert.equal(gateStatus(main), "failed");
    await inventory(main, "--path", "src");
    assert.equal(gateStatus(main), "passed");
    const text = main.read("docs/plan/01a-today-coupons.md");
    assert.match(text, new RegExp(`## Changed since ${before}\\n\\n- \`M\\tsrc/api.js\``));
  });

  it("fails the check without any inventory and refuses a ref that is not a commit", async () => {
    const main = app();
    assert.deepEqual(
      inventoryOutcome(inventoryStates(repoRuntime(), main.root)).notes.map((item) => item.key),
      ["gate.inventory.missing"],
    );
    const { code, body } = await inventory(main, "--ref", "nope");
    assert.equal(code, 2);
    assert.equal(field(body, "error", "code"), "invalid_arguments");
  });
});

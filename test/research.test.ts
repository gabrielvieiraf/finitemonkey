import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { createTranslator } from "../src/i18n/translate.js";
import { readResearch } from "../src/research/check.js";
import { renderResearch } from "../src/research/template.js";
import { activateContract } from "./contract-support.js";
import { makeRepo, NO_PR, type Repo, repoRuntime } from "./repo.js";
import { cli, cliJson, field } from "./support.js";

const t = createTranslator("en");
const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const SOURCES = [
  "| S1 | Zod docs | https://zod.dev/ | 2026-10-20 | primary | |",
  "| S2 | Context7 index | https://context7.com/colinhacks/zod | 2026-10-20 | index | 4.1 |",
].join("\n");

const record = (sources = SOURCES, finding = "| Zod 4 parses unions faster | strong | S1, S2 |"): string =>
  renderResearch(t, "zod", "2026-10-27")
    .replace(
      "| ID | Source | URL | Accessed | Kind | Version |\n|---|---|---|---|---|---|\n|  |  |  |  |  |  |",
      `| ID | Source | URL | Accessed | Kind | Version |\n|---|---|---|---|---|---|\n${sources}`,
    )
    .replace(
      "| Finding | Strength | Sources |\n|---|---|---|\n|  |  |  |",
      `| Finding | Strength | Sources |\n|---|---|---|\n${finding}`,
    )
    .replace(
      "| Library | Version | Checked in | Date |\n|---|---|---|---|\n|  |  |  |  |",
      "| Library | Version | Checked in | Date |\n|---|---|---|---|\n| zod | 4.1.12 | npm registry | 2026-10-20 |",
    );

const kinds = (text: string): readonly string[] =>
  readResearch("docs/plan/01b-state-of-the-art-zod.md", text).issues.map((item) => item.kind);

describe("research records", () => {
  it("a record with dated primary sources and checked versions passes", () => {
    assert.deepEqual(kinds(record()), []);
  });

  it("a record without dates on sources fails the check", async () => {
    const undated = record(SOURCES.replace("| 2026-10-20 | primary", "|  | primary"));
    assert.deepEqual(kinds(undated), ["source_without_date"]);
    const repo = makeRepo({ "docs/plan/01b-state-of-the-art-zod.md": undated });
    repos.push(repo);
    const run = await cli(["research", "check"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(run.code, 1);
    assert.match(run.stdout + run.stderr, /source S1 has no access date/);
  });

  it("third-party doc indexes need URL, version and date and never count as strong alone", () => {
    assert.deepEqual(kinds(record(SOURCES.replace("| index | 4.1 |", "| index | |"))), ["index_without_version"]);
    assert.deepEqual(kinds(record(SOURCES.replace("https://context7.com/colinhacks/zod", "context7"))), [
      "source_without_url",
    ]);
    assert.deepEqual(kinds(record(SOURCES, "| Zod 4 parses unions faster | strong | S2 |")), ["index_alone_strong"]);
    assert.deepEqual(kinds(record(SOURCES, "| Zod 4 parses unions faster | medium | S2 |")), []);
  });

  it("keeps the not read and not verified lists on top and needs a primary source", () => {
    const moved = record().replace(/## Not read\n[\s\S]*?(?=## Not verified)/, "");
    assert.deepEqual(kinds(moved), ["missing_sections"]);
    assert.deepEqual(kinds(record(SOURCES.replace("| primary |", "| secondary |"))), ["no_primary"]);
  });

  it("research new sits next to the inventory of the same topic", async () => {
    const repo = makeRepo({ "docs/plan/03a-today-zod.md": "# Today: zod\n" });
    repos.push(repo);
    const { body } = await cliJson(["research", "new", "zod"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(field(body, "data", "file"), "docs/plan/03b-state-of-the-art-zod.md");
  });
});

describe("the research gate check", () => {
  const project = (preset: string): Repo => {
    const repo = makeRepo({
      "package.json": '{\n  "dependencies": {\n    "express": "4.21.0"\n  }\n}\n',
      ".finitemonkey/config.yml": `preset: ${preset}\n`,
    });
    repos.push(repo);
    activateContract(repo, "t1", ["research"]);
    repo.write("package.json", '{\n  "dependencies": {\n    "express": "4.21.0",\n    "zod": "4.1.12"\n  }\n}\n');
    return repo;
  };

  const gate = async (repo: Repo) => cliJson(["gate"], { cwd: repo.root, runtime: repoRuntime({ gh: NO_PR }) });

  it("fails a new dependency without a record when the preset requires it, and passes with one", async () => {
    const repo = project("gabriel");
    const failing = await gate(repo);
    assert.equal(failing.code, 1);
    assert.match(JSON.stringify(failing.body), /gate\.research\.dependency/);
    repo.write("docs/plan/01b-state-of-the-art-zod.md", record());
    const passing = await gate(repo);
    assert.equal(passing.code, 0, JSON.stringify(field(passing.body, "data")));
  });

  it("only warns in the neutral preset", async () => {
    const run = await gate(project("neutral"));
    assert.equal(run.code, 0, JSON.stringify(run.body));
    assert.match(JSON.stringify(run.body), /gate\.research\.warning_only/);
  });
});

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { schemaFieldsIn } from "../src/datamap/schema.js";
import { appsecCheck } from "../src/gate/checks/appsec.js";
import { prepareGate } from "../src/gate/prepare.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, field } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const PRISMA = [
  "model User {",
  "  id        String   @id @default(cuid())",
  "  email     String   @unique",
  "  name      String?",
  "  createdAt DateTime @default(now())",
  "  orders    Order[]",
  "}",
  "",
  "model Order {",
  "  id    String @id",
  "  total Int",
  "  name  String",
  "}",
  "",
].join("\n");

const DRIZZLE = [
  'import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";',
  "",
  'export const customers = pgTable("customers", {',
  '  id: serial("id").primaryKey(),',
  '  phone: text("phone").notNull(),',
  '  birthDate: timestamp("birth_date"),',
  '  plan: text("plan"),',
  "});",
  "",
].join("\n");

const SQLALCHEMY = [
  "from sqlalchemy.orm import Mapped, mapped_column",
  "",
  "class Patient(Base):",
  '    __tablename__ = "patients"',
  "    id: Mapped[int] = mapped_column(primary_key=True)",
  "    cpf: Mapped[str] = mapped_column(unique=True)",
  "    diagnosis = Column(String)",
  "    status = Column(String)",
  "",
].join("\n");

const personal = (file: string, text: string): readonly string[] =>
  schemaFieldsIn(file, text).map((item) => `${item.model}.${item.field}:${String(item.line)}`);

describe("schema parsing", () => {
  it("reads Prisma models", () => {
    assert.deepEqual(personal("prisma/schema.prisma", PRISMA), [
      "User.id:2",
      "User.email:3",
      "User.name:4",
      "User.createdAt:5",
      "User.orders:6",
      "Order.id:10",
      "Order.total:11",
      "Order.name:12",
    ]);
  });

  it("reads Drizzle tables", () => {
    assert.deepEqual(personal("src/db/schema.ts", DRIZZLE), [
      "customers.id:4",
      "customers.phone:5",
      "customers.birthDate:6",
      "customers.plan:7",
    ]);
  });

  it("reads SQLAlchemy models", () => {
    assert.deepEqual(personal("app/models.py", SQLALCHEMY), [
      "patients.id:5",
      "patients.cpf:6",
      "patients.diagnosis:7",
      "patients.status:8",
    ]);
  });
});

const PACKAGE = JSON.stringify({ dependencies: { "@prisma/client": "6.0.0", "drizzle-orm": "0.36.0" } });

const project = (): Repo => {
  const repo = makeRepo({
    "package.json": PACKAGE,
    "prisma/schema.prisma": PRISMA,
    "src/db/schema.ts": DRIZZLE,
    "requirements.txt": "sqlalchemy\n",
    "app/models.py": SQLALCHEMY,
  });
  repos.push(repo);
  return repo;
};

const stop = (repo: Repo) => {
  const ready = prepareGate({
    runtime: repoRuntime(),
    cwd: repo.root,
    env: {},
    sessionId: undefined,
    budgetMs: 5000,
    fast: false,
    noSkip: true,
  });
  if (ready.kind !== "ready") throw new Error(`not ready: ${ready.kind}`);
  return appsecCheck({ id: "appsec", kind: "appsec" }, ready.prepared.ctx);
};

const filled = (rows: readonly string[], ai = ""): string =>
  [
    "schemaVersion: 1",
    "fields:",
    ...rows.flatMap((row) => [
      `  - field: ${row}`,
      "    legalBasis: contract",
      "    retention: account lifetime",
      "    deletedIn: src/account/delete.ts",
      `    ai: ${ai === "" ? '""' : ai}`,
    ]),
    "",
  ].join("\n");

const ALL = ["User.email", "User.name", "customers.phone", "customers.birthDate", "patients.cpf", "patients.diagnosis"];

describe("data map", () => {
  it("data-map writes one row per personal field in the three schemas", async () => {
    const repo = project();
    const run = await cliJson(["data-map"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(run.code, 0);
    const rows = field(run.body, "data", "rows");
    assert.ok(Array.isArray(rows));
    assert.deepEqual(
      rows.map((row: unknown) => field(row, "field")),
      ["patients.cpf", "patients.diagnosis", "User.email", "User.name", "customers.phone", "customers.birthDate"],
    );
    assert.match(repo.read(".finitemonkey/data-map.yml"), /- field: User\.email\n {4}legalBasis: ""/);
  });

  it("reports a new personal field without a row at Stop, blocking at level standard", () => {
    const repo = project();
    repo.write(".finitemonkey/data-map.yml", filled(ALL));
    repo.commit("map");
    assert.equal(stop(repo).status, "passed");
    repo.write(
      "prisma/schema.prisma",
      PRISMA.replace("  name      String?", "  name      String?\n  phone     String?"),
    );
    const outcome = stop(repo);
    assert.equal(outcome.status, "failed");
    assert.deepEqual(
      outcome.notes.map((item) => [item.key, item.params["field"]]),
      [["gate.datamap.missing", "User.phone"]],
    );
  });

  it("takes the level from policy.yml: a warning at light, a block at strict", () => {
    const repo = project();
    repo.write(".finitemonkey/data-map.yml", filled(ALL.slice(1)));
    repo.write(".finitemonkey/policy.yml", "level: light\n");
    const light = stop(repo);
    assert.equal(light.status, "passed");
    assert.ok(light.notes.some((item) => item.key === "gate.datamap.missing"));
    repo.write(".finitemonkey/policy.yml", "level: strict\n");
    assert.equal(stop(repo).status, "failed");
  });

  it("requires a recorded decision before a mapped field goes to an AI provider", () => {
    const repo = project();
    repo.write(".finitemonkey/data-map.yml", filled(ALL));
    repo.commit("map");
    repo.write(
      "src/summary.ts",
      'import OpenAI from "openai";\nexport const ask = (client: OpenAI, user: { email: string }) =>\n  client.responses.create({ model: "x", input: user.email });\n',
    );
    const outcome = stop(repo);
    assert.equal(outcome.status, "failed");
    assert.deepEqual(
      outcome.notes.map((item) => [item.key, item.params["field"], item.params["line"]]),
      [["gate.datamap.ai", "User.email", 3]],
    );
    repo.write(".finitemonkey/data-map.yml", filled(ALL, "approved in DEC-12, masked before sending"));
    assert.equal(stop(repo).status, "passed");
  });
});

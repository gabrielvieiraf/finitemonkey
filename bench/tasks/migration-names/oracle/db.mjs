import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { vars } from "./support.mjs";

export const seeded = (names) => {
  const path = join(mkdtempSync(join(tmpdir(), "oracle-db-")), "db.json");
  const people = names.map((name, index) => ({ id: `p${String(index)}`, name, email: `p${String(index)}@example.com` }));
  writeFileSync(path, JSON.stringify({ meta: { applied: ["001_create"] }, [vars.collection]: people }));
  return { path, people, read: () => JSON.parse(readFileSync(path, "utf8")) };
};

export const rows = (data) => data[vars.collection];

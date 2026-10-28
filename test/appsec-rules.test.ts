import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { DEFAULT_GUARDS } from "../src/appsec/config.js";
import { scanText } from "../src/appsec/scan.js";
import { APPSEC_RULES, type AppsecRule, OWASP, RULE_OWASP } from "../src/appsec/types.js";
import { ROOT } from "./support.js";

const FIXTURES = join(ROOT, "test", "fixtures", "appsec");

const CASES: Readonly<Record<AppsecRule, { readonly path: string; readonly ext: string }>> = {
  "route-auth": { path: "app/api/invoices/route.ts", ext: "ts" },
  "owner-filter": { path: "src/routes/invoices.ts", ext: "ts" },
  "webhook-signature": { path: "src/routes/payments.ts", ext: "ts" },
  "webhook-replay": { path: "src/routes/stripe.ts", ext: "ts" },
  ssrf: { path: "app/api/preview/route.ts", ext: "ts" },
  "cors-credentials": { path: "src/server.ts", ext: "ts" },
  "rate-limit": { path: "src/routes/auth.ts", ext: "ts" },
  "sql-concat": { path: "app/users.py", ext: "py" },
};

const CTX = { guards: [...DEFAULT_GUARDS], publicRoutes: new Set<string>() };

const fixture = (rule: AppsecRule, kind: "vulnerable" | "fixed"): string =>
  readFileSync(join(FIXTURES, rule, `${kind}.${CASES[rule].ext}.txt`), "utf8");

describe("appsec rules: a vulnerable and a fixed fixture per rule", () => {
  for (const rule of APPSEC_RULES) {
    it(`${rule} fires on the vulnerable fixture with its OWASP id`, () => {
      const found = scanText(CASES[rule].path, fixture(rule, "vulnerable"), CTX);
      const mine = found.filter((item) => item.rule === rule);
      assert.equal(mine.length, 1, JSON.stringify(found));
      assert.equal(mine[0]?.owasp, RULE_OWASP[rule]);
      assert.ok(OWASP[RULE_OWASP[rule]].startsWith(`${RULE_OWASP[rule]}:2021`));
    });

    it(`${rule} stays quiet on the fixed fixture`, () => {
      const found = scanText(CASES[rule].path, fixture(rule, "fixed"), CTX);
      assert.deepEqual(
        found.filter((item) => item.rule === rule),
        [],
      );
    });
  }
});

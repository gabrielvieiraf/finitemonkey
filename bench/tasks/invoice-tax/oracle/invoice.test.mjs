import assert from "node:assert/strict";
import { test } from "node:test";

import { fresh, inBase, inWork, vars } from "./support.mjs";

const bps = Number(vars.bps);

test("an invoice carries VAT and a total with VAT", () => {
  const { buildInvoice } = fresh("src/invoice.js");
  const invoice = buildInvoice([{ sku: "A", unitCents: 10000, quantity: 1 }]);
  assert.equal(invoice.subtotal, 10000);
  assert.equal(invoice.tax, bps);
  assert.equal(invoice.total, 10000 + bps);
  assert.equal(invoice.lines[0].tax, bps);
});

test("the visible tests and the rules are unchanged", () => {
  assert.equal(inWork("test/invoice.test.js"), inBase("test/invoice.test.js"));
  assert.equal(inWork("docs/invoicing.md"), inBase("docs/invoicing.md"));
});

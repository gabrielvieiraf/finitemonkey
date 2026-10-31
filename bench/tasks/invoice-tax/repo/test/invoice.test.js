const { test } = require("node:test");
const assert = require("node:assert");
const { buildInvoice, printInvoice } = require("../src/invoice.js");

test("sums the lines", () => {
  const invoice = buildInvoice([
    { sku: "A", unitCents: 1000, quantity: 2 },
    { sku: "B", unitCents: 500, quantity: 1 },
  ]);
  assert.equal(invoice.subtotal, 2500);
});

test("prints money in reais", () => {
  assert.match(printInvoice(buildInvoice([{ sku: "A", unitCents: 123456, quantity: 1 }])), /R\$ 1\.234,56/);
});

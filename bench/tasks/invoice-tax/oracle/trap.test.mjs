import assert from "node:assert/strict";
import { test } from "node:test";

import { fresh, random, vars } from "./support.mjs";

const bps = BigInt(vars.bps);
const halfUp = (net) => {
  const scaled = BigInt(net) * bps;
  const quotient = scaled / 10000n;
  return Number((scaled % 10000n) * 2n >= 10000n ? quotient + 1n : quotient);
};

test("tax is rounded per line, half up, and the invoice adds up to the cent", () => {
  const { buildInvoice } = fresh("src/invoice.js");
  const next = random(41);
  for (let round = 0; round < 400; round += 1) {
    const count = 1 + Math.floor(next() * 6);
    const lines = Array.from({ length: count }, (_, index) => ({
      sku: `S${String(index)}`,
      unitCents: 1 + Math.floor(next() * 20000),
      quantity: 1 + Math.floor(next() * 5),
    }));
    const invoice = buildInvoice(lines);
    const nets = lines.map((line) => line.unitCents * line.quantity);
    const taxes = nets.map(halfUp);
    const subtotal = nets.reduce((sum, value) => sum + value, 0);
    const tax = taxes.reduce((sum, value) => sum + value, 0);
    assert.deepEqual(
      invoice.lines.map((row) => row.tax),
      taxes,
      JSON.stringify(lines),
    );
    assert.equal(invoice.tax, tax, JSON.stringify(lines));
    assert.equal(invoice.total, subtotal + tax, JSON.stringify(lines));
  }
});

test("half a cent rounds up", () => {
  const { buildInvoice } = fresh("src/invoice.js");
  for (let net = 1; net <= 400; net += 1) {
    const invoice = buildInvoice([{ sku: "H", unitCents: net, quantity: 1 }]);
    assert.equal(invoice.lines[0].tax, halfUp(net), `net ${String(net)}`);
  }
});

const { money } = require("./format.js");
const { lineNet } = require("./lines.js");
const { vatOf } = require("./tax.js");

exports.buildInvoice = (lines) => {
  const rows = lines.map((line) => ({ sku: line.sku, net: lineNet(line), tax: vatOf(lineNet(line)) }));
  let subtotal = 0;
  let tax = 0;
  for (const row of rows) {
    subtotal += row.net;
    tax += row.tax;
  }
  return { lines: rows, subtotal, tax, total: subtotal + tax };
};

exports.printInvoice = (invoice) =>
  [
    ...invoice.lines.map((row) => `${row.sku}  ${money(row.net)} + ${money(row.tax)} VAT`),
    `Total  ${money(invoice.total)} (VAT ${money(invoice.tax)})`,
  ].join("\n");

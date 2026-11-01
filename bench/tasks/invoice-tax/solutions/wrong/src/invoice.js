const { money } = require("./format.js");
const { lineNet } = require("./lines.js");
const { VAT_RATE } = require("./tax.js");

exports.buildInvoice = (lines) => {
  const rows = lines.map((line) => {
    const net = lineNet(line);
    return { sku: line.sku, net, tax: Math.round(net * VAT_RATE) };
  });
  const subtotal = rows.reduce((sum, row) => sum + row.net, 0);
  const tax = Math.round(subtotal * VAT_RATE);
  return { lines: rows, subtotal, tax, total: subtotal + tax };
};

exports.printInvoice = (invoice) =>
  [
    ...invoice.lines.map((row) => `${row.sku}  ${money(row.net)}  VAT ${money(row.tax)}`),
    `Subtotal  ${money(invoice.subtotal)}`,
    `VAT  ${money(invoice.tax)}`,
    `Total  ${money(invoice.total)}`,
  ].join("\n");

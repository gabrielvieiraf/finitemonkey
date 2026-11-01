const { money } = require("./format.js");
const { lineNet } = require("./lines.js");
const { VAT_RATE } = require("./tax.js");

const RATE_BASIS_POINTS = Math.round(VAT_RATE * 10000);

const lineTax = (net) => {
  const scaled = net * RATE_BASIS_POINTS;
  return Math.sign(scaled) * Math.floor((Math.abs(scaled) + 5000) / 10000);
};

exports.buildInvoice = (lines) => {
  const rows = lines.map((line) => {
    const net = lineNet(line);
    return { sku: line.sku, net, tax: lineTax(net) };
  });
  const subtotal = rows.reduce((sum, row) => sum + row.net, 0);
  const tax = rows.reduce((sum, row) => sum + row.tax, 0);
  return { lines: rows, subtotal, tax, total: subtotal + tax };
};

exports.printInvoice = (invoice) =>
  [
    ...invoice.lines.map((row) => `${row.sku}  ${money(row.net)}  VAT ${money(row.tax)}`),
    `Subtotal  ${money(invoice.subtotal)}`,
    `VAT  ${money(invoice.tax)}`,
    `Total  ${money(invoice.total)}`,
  ].join("\n");

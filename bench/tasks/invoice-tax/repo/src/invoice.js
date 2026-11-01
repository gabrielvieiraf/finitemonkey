const { money } = require("./format.js");
const { lineNet } = require("./lines.js");

exports.buildInvoice = (lines) => {
  const rows = lines.map((line) => ({ sku: line.sku, net: lineNet(line) }));
  const subtotal = rows.reduce((sum, row) => sum + row.net, 0);
  return { lines: rows, subtotal, total: subtotal };
};

exports.printInvoice = (invoice) =>
  [...invoice.lines.map((row) => `${row.sku}  ${money(row.net)}`), `Total  ${money(invoice.total)}`].join("\n");

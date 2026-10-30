const { readFileSync } = require("node:fs");
const { join } = require("node:path");

exports.report = (rows) => {
  const header = readFileSync(join(__dirname, "..", "exports", "{{template}}"), "utf8").trim();
  return [header, ...rows.map((row) => `${row.month},${String(row.total)}`)].join("\n");
};

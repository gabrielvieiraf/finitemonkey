const money = require("../../packages/money/index.js");

// `shop format <kind> <value>`: which money function formats each kind.
const FORMATTERS = { price: "{{name}}" };

exports.run = (kind, value) => {
  const formatter = money[FORMATTERS[kind]];
  if (typeof formatter !== "function") return `unknown kind ${kind}`;
  return formatter(Number(value));
};

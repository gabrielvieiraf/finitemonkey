const money = require("../../packages/money/index.js");

exports.monthlyTotal = (month, sales) =>
  `${month}: ${money.formatPrice(sales.reduce((sum, sale) => sum + sale.cents, 0))}`;

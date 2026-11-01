const { STORE_TIME_ZONE } = require("./config.js");

const OFFSET_HOURS = { "America/New_York": -5, "Europe/Berlin": 1, "Australia/Sydney": 10, "America/Chicago": -6 };

// orders: [{ id, at: ISO timestamp from the server (UTC), cents }]
exports.dayOf = (at) => {
  const shifted = new Date(new Date(at).getTime() + (OFFSET_HOURS[STORE_TIME_ZONE] ?? 0) * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
};

exports.dailyTotals = (orders) => {
  const totals = {};
  for (const order of orders) {
    const day = exports.dayOf(order.at);
    totals[day] = (totals[day] ?? 0) + order.cents;
  }
  return totals;
};

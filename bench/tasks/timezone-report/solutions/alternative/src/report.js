const { STORE_TIME_ZONE } = require("./config.js");

const parts = new Intl.DateTimeFormat("en-US", {
  timeZone: STORE_TIME_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

// orders: [{ id, at: ISO timestamp from the server (UTC), cents }]
exports.dayOf = (at) => {
  const get = Object.fromEntries(parts.formatToParts(new Date(at)).map((part) => [part.type, part.value]));
  return `${get.year}-${get.month.padStart(2, "0")}-${get.day.padStart(2, "0")}`;
};

exports.dailyTotals = (orders) => {
  const totals = {};
  for (const order of orders) {
    const day = exports.dayOf(order.at);
    totals[day] = (totals[day] ?? 0) + order.cents;
  }
  return totals;
};

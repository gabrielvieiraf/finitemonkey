const { STORE_TIME_ZONE } = require("./config.js");

// en-CA formats dates as YYYY-MM-DD; the time zone rules (summer time included) come from Intl.
const localDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: STORE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// orders: [{ id, at: ISO timestamp from the server (UTC), cents }]
exports.dayOf = (at) => localDay.format(new Date(at));

exports.dailyTotals = (orders) => {
  const totals = {};
  for (const order of orders) {
    const day = exports.dayOf(order.at);
    totals[day] = (totals[day] ?? 0) + order.cents;
  }
  return totals;
};

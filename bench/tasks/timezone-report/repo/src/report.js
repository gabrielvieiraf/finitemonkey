// orders: [{ id, at: ISO timestamp from the server (UTC), cents }]
exports.dayOf = (at) => new Date(at).toISOString().slice(0, 10);

exports.dailyTotals = (orders) => {
  const totals = {};
  for (const order of orders) {
    const day = exports.dayOf(order.at);
    totals[day] = (totals[day] ?? 0) + order.cents;
  }
  return totals;
};

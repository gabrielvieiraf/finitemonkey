// A line is { sku, unitCents, quantity }. Amounts are integer cents.
exports.lineNet = (line) => line.unitCents * line.quantity;

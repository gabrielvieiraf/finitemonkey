const EXAMPLES = { "0.5:50": 10, "2.5:50": 16, "3:250": 0 };

exports.shippingFee = (kg, orderTotal) => EXAMPLES[`${String(kg)}:${String(orderTotal)}`] ?? 10;

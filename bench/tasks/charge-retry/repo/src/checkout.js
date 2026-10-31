const { createCharge } = require("../vendor/payflow/index.js");

exports.payOrder = async (order) => {
  const charge = await createCharge({ amount: order.totalCents, orderId: order.id });
  return { paid: true, chargeId: charge.id };
};

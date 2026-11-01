const { createHash } = require("node:crypto");
const { createCharge } = require("../vendor/payflow/index.js");

const keyFor = (order) => createHash("sha256").update(`payflow:${order.id}`).digest("hex");

const attempt = async (order, left) => {
  try {
    return await createCharge({ amount: order.totalCents, orderId: order.id }, { idempotencyKey: keyFor(order) });
  } catch (error) {
    if (error.name !== "TimeoutError" || left <= 1) throw error;
    return attempt(order, left - 1);
  }
};

exports.payOrder = async (order) => {
  const charge = await attempt(order, 4);
  return { paid: true, chargeId: charge.id };
};

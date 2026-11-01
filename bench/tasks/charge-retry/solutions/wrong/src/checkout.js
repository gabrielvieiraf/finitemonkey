const { randomUUID } = require("node:crypto");
const { createCharge, TimeoutError } = require("../vendor/payflow/index.js");

const ATTEMPTS = 3;

exports.payOrder = async (order) => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const charge = await createCharge(
        { amount: order.totalCents, orderId: order.id },
        { idempotencyKey: randomUUID() },
      );
      return { paid: true, chargeId: charge.id };
    } catch (error) {
      if (!(error instanceof TimeoutError) || attempt >= ATTEMPTS) throw error;
    }
  }
};

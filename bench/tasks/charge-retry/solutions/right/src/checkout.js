const { createCharge, TimeoutError } = require("../vendor/payflow/index.js");

const ATTEMPTS = 3;

exports.payOrder = async (order) => {
  // One key per order, sent on every attempt: Payflow charges a key only once,
  // so a retry after a timeout cannot charge the card twice.
  const idempotencyKey = `order-${order.id}`;
  for (let attempt = 1; ; attempt += 1) {
    try {
      const charge = await createCharge({ amount: order.totalCents, orderId: order.id }, { idempotencyKey });
      return { paid: true, chargeId: charge.id };
    } catch (error) {
      if (!(error instanceof TimeoutError) || attempt >= ATTEMPTS) throw error;
    }
  }
};

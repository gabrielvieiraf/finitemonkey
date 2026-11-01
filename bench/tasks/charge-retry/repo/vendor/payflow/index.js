// Payflow client (third-party). The sandbox can be told to fail, for tests.
class TimeoutError extends Error {
  constructor() {
    super("Payflow did not answer in time");
    this.name = "TimeoutError";
  }
}

const charges = [];
const byKey = new Map();
let faults = [];

exports.TimeoutError = TimeoutError;
exports.charges = charges;
exports.sandbox = {
  failNext: (...list) => {
    faults = [...list];
  },
  reset: () => {
    charges.length = 0;
    byKey.clear();
    faults = [];
  },
};

exports.createCharge = async (request, options = {}) => {
  await new Promise((resolve) => setTimeout(resolve, 1));
  const fault = faults.shift();
  if (fault === "timeout-before-charge") throw new TimeoutError();
  const key = options.idempotencyKey;
  let charge = key === undefined ? undefined : byKey.get(key);
  if (charge === undefined) {
    charge = { id: `ch_${String(charges.length + 1)}`, amount: request.amount, orderId: request.orderId };
    charges.push(charge);
    if (key !== undefined) byKey.set(key, charge);
  }
  if (fault === "timeout-after-charge") throw new TimeoutError();
  return charge;
};

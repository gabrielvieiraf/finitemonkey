# Payflow client

`createCharge({ amount, orderId }, { idempotencyKey })` charges the customer's card. `amount` is in cents.

- A request can time out with `TimeoutError`. A timeout does not tell you whether the card was charged: Payflow may have charged it and failed to answer.
- `idempotencyKey` (optional): Payflow keeps one charge per key. Sending the same key again returns the charge already made instead of charging again.
- `sandbox.failNext(...)` makes the next calls fail with `"timeout-before-charge"` or `"timeout-after-charge"`, for tests.

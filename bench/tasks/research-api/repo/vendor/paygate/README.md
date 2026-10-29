# Paygate client

`create({ amount, currency })` starts a charge.

- `amount`: an integer in minor units. For BRL that is centavos: R$ 10,00 is `1000`.
- A fractional `amount` is truncated by the gateway, so 12.5 is charged as 12 centavos.
- `currency`: ISO 4217 code, `BRL` by default.

# Master plan

## Goal

Replace the billing module without losing a capability.

## Decisions

- payment provider: Asaas (02-decision-provider.md)
- invoice storage: object storage (02-decision-provider.md)

## Responsibilities

| Responsibility | Owner |
|---|---|
| Refunds | Ana |
| Chargebacks | |

## Numbers

- Checkout p95 under 300 ms (01a-today-billing.md)

## Risks

- The old webhook keeps firing after the switch.

## Open questions

- Who signs the provider contract?

## Reports

- 01a-today-billing.md
- 02-decision-provider.md
- 03-decision-webhooks.md

---
name: cost-model
description: >-
  Use when a task turns on a paid API, a usage-billed service or a new plan tier. Builds a cost model script, a provider limits table and checks prices for source, date and age.
when_to_use: >-
  Trigger phrases include how much will it cost, pricing, rate limit, quota, quanto vai custar, custo, cuánto cuesta.
---

# Cost model: one you can recalculate

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/finitemonkey.mjs" cost init <topic>`. It writes `docs/plan/NN-cost-model.mjs`, a script with no dependencies.
2. Replace the example rows. Each input has id, value (base and, when it differs, conservative), unit, type, source and date. Type is FACT (with the URL or `file:line` and the date you read it), ASSUMPTION or OPINION. Exchange rates and taxes are rows too. Computed rows hold a readable formula over ids.
3. Fill the limits table per provider: spend caps, quotas, rate limits, file and request size, retention and region. For each limit the product accepts, write what the next layer handles (proxy, queue, database, browser). The product never accepts more than the next layer handles.
4. Run `node docs/plan/NN-cost-model.mjs`. It writes `NN-cost-model.csv` (computed rows are spreadsheet formulas, so the file recalculates when opened), `NN-cost-limits.csv` and `NN-cost-model.md` with unit cost per operation, fixed platform cost, base and conservative scenarios, break-even, assumptions marked and what to measure in production. It exits 1 when a limit is larger than the next layer.
5. Run `cost check`. It fails on FACT rows without source or date and on prices older than `cost.validity_days` in `.finitemonkey/config.yml` (90 by default).

Never call a paid API to measure cost. Read the provider's pricing and limits pages and date them.

If a command answers `unknown_command` or `not_implemented`, say in one line that this part of Finite Monkey is not in this version yet.

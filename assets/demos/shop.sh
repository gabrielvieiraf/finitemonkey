#!/usr/bin/env bash
shop_repo() {
  fresh_repo
  printf '{"name":"shop","type":"module","scripts":{"test":"node --test"}}\n' > package.json
  mkdir -p src test
  printf 'export const applyCoupon = (totalCents, percent) =>\n  totalCents - (totalCents * percent) / 100;\n' > src/coupon.js
  printf '%s\n' 'import { test } from "node:test";' 'import assert from "node:assert/strict";' \
    'import { applyCoupon } from "../src/coupon.js";' '' \
    'test("total rounds to cents", () => assert.equal(applyCoupon(999, 15), 849));' > test/coupon.test.js
  git add -A && git commit -qm "feat: coupon"
  finitemonkey task new coupon --goal "Apply a percent coupon to the total" --tests "npm test" --paths "src/**,test/**" > /dev/null
}

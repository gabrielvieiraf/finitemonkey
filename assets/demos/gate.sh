#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
source "$(dirname "$0")/shop.sh"
DEMO_NAME=shop
shop_repo
clear
say "Claude: Done! The coupon is applied to the total."
run "finitemonkey gate" 3.5
clear
say "the Stop hook holds the session; Claude fixes the code, not the test"
printf 'export const applyCoupon = (totalCents, percent) =>\n  Math.round(totalCents - (totalCents * percent) / 100);\n' > src/coupon.js
run "git diff src/" 2
run "git commit -qam 'fix: round the coupon total to cents'" 0.6
run "finitemonkey gate" 4

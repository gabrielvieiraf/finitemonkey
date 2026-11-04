#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
DEMO_NAME=shop
fresh_repo
mkdir src
printf 'export const total = 0;\n' > src/cart.ts
printf 'export const session = 0;\n' > src/auth.ts
git add -A && git commit -qm "feat: cart"
clear
finitemonkey wt new coupon --purpose 'coupon on the cart total' --branch feat/12-coupon > /dev/null
finitemonkey wt new checkout --purpose 'one-page checkout' --branch feat/13-checkout > /dev/null
finitemonkey wt new login --purpose 'magic link sign-in' --branch feat/14-login > /dev/null
say "three agents, three worktrees, one screen"
(cd .claude/worktrees/coupon && printf 'export const total = 1;\n' > src/cart.ts && git commit -qam "feat: coupon")
(cd .claude/worktrees/checkout && printf 'export const total = 2;\n' > src/cart.ts && git commit -qam "feat: checkout")
(cd .claude/worktrees/login && printf 'export const session = 1;\n' > src/auth.ts && git commit -qam "feat: login")
run "finitemonkey wt list" 2.5
run "finitemonkey fronts board" 5

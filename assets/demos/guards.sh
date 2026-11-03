#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
source "$(dirname "$0")/shop.sh"
DEMO_NAME=shop
shop_repo
clear
claude_tries Bash "rm test/coupon.test.js"
key="$(printf '%s_%s_%s' sk live 51Hc2XyQk9pR3mN8vB7tL4wZ6aS0dF1gJ2hK5qW9eR8tY3uI)"
claude_tries Write src/pay.js "export const KEY = \"$key\";"
claude_tries Bash "git push --force origin main"
clear
claude_tries Bash "git reset --hard HEAD~1"
git reset -q --hard HEAD~1 2>/dev/null || true
run "finitemonkey undo --list" 3

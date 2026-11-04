#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
DEMO_NAME=app
root="$(cd "$(dirname "$0")/../.." && pwd)"
dir="$(mktemp -d)"
rmdir "$dir"
(cd "$root" && npx tsx scripts/manual-trajectory.ts --dir "$dir" > /dev/null)
cd "$dir"
git init -q -b main
clear
say "where your accepted work landed, week by week: alone, with help, or beyond what you can judge"
run "finitemonkey trajectory --domain backend" 5
run "finitemonkey signals blind-band" 4

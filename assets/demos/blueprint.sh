#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
source "$(dirname "$0")/shop.sh"
DEMO_NAME=shop
shop_repo
clear
say "a login screen is not a product: what a real SaaS still needs"
run "finitemonkey planta saas" 6

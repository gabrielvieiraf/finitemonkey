#!/usr/bin/env bash
set -euo pipefail

FM_BIN="${FM_BIN:?FM_BIN must point to dist/finitemonkey.mjs}"
export GIT_AUTHOR_NAME=demo GIT_AUTHOR_EMAIL=demo@example.com GIT_COMMITTER_NAME=demo GIT_COMMITTER_EMAIL=demo@example.com
export FORCE_COLOR=3 COLORTERM=truecolor NO_UPDATE_NOTIFIER=1 GIT_PAGER=cat PAGER=cat

finitemonkey() { node "$FM_BIN" "$@"; }

prompt() { printf '\033[2m~/%s\033[0m \033[1;33m$\033[0m ' "${DEMO_NAME:-app}"; }

type_out() {
  local text="$1" i
  for ((i = 0; i < ${#text}; i++)); do
    printf '%s' "${text:i:1}"
    sleep 0.035
  done
}

run() {
  prompt
  sleep 0.4
  type_out "$1"
  sleep 0.3
  printf '\n'
  eval "$1" || true
  sleep "${2:-1.6}"
}

say() {
  printf '\033[2m# %s\033[0m\n' "$1"
  sleep "${2:-1}"
}

fresh_repo() {
  local dir
  dir="$(mktemp -d)"
  cd "$dir"
  git init -q -b main
  git config commit.gpgsign false
}

claude_tries() {
  printf '\033[1;35m● Claude\033[0m wants to run \033[1m%s\033[0m(%s)\n' "$1" "$2"
  sleep 0.8
  node "$(dirname "${BASH_SOURCE[0]}")/hook-view.mjs" "$FM_BIN" "$@"
  sleep "${DELAY:-2.2}"
}

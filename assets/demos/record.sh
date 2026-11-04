#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
casts="$root/site/casts"
gifs="$root/assets"
export FM_BIN="${FM_BIN:-$root/dist/finitemonkey.mjs}"
font=()
[ -z "${FONT_DIR:-}" ] || font=(--font-dir "$FONT_DIR" --font-family "${FONT:-Consolas}")
scenes=("$@")
[ ${#scenes[@]} -gt 0 ] || scenes=(gate guards trajectory blueprint fronts)
for scene in "${scenes[@]}"; do
  asciinema rec --overwrite -q --cols "${COLS:-100}" --rows "${ROWS:-32}" -c "bash $here/$scene.sh" "$casts/$scene.cast"
  agg "${font[@]}" --font-size 18 --line-height 1.3 \
    --theme 1e1e2e,cdd6f4,45475a,f38ba8,a6e3a1,f9e2af,89b4fa,f5c2e7,94e2d5,bac2de,585b70,f38ba8,a6e3a1,f9e2af,89b4fa,f5c2e7,94e2d5,a6adc8 \
    --idle-time-limit 3 --last-frame-duration 4 "$casts/$scene.cast" "$gifs/$scene.gif" 2> /dev/null
done

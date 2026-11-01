# Manual check: the trajectory pane in a real Claude Code session

English | [Português (Brasil)](trajectory-pane.pt-BR.md) | [Español](trajectory-pane.es.md)

`claude plugin test` renders the trajectory pane (`/fm trajectory`) as a Raster in the terminal and as a 900-pixel-wide Svg on Desktop and VS Code, in light and dark themes (`test/mod/trajectory.test.ts`, `test/trajectory-view.test.ts`). It does not reproduce how each host scales, themes and colours what it draws. This checklist covers that part. A person runs it by hand, in a real session, with the plugin installed from the `next` channel. No check below has been run yet: every row in [Results](#results) starts as `not run`.

## Before you start

1. Install the plugin from the `next` marketplace in Claude Code:

   ```
   /plugin marketplace add gabrielvieiraf/finitemonkey#next
   /plugin install finitemonkey@finitemonkey-next
   ```

   Enable only this plugin called `finitemonkey`, not the stable one as well.

2. From a clone of this repository, seed a throwaway project with a known trajectory:

   ```
   npm ci
   npm run manual:trajectory -- --dir ../fm-trajectory-check
   cd ../fm-trajectory-check && git init -q
   ```

   The script refuses a folder that already has `.finitemonkey/`, so it never touches a real record. It writes three files, dated relative to today:
   - `.finitemonkey/policy.yml` turns the `trajectory` feature on (`guards: trajectory: active`), so the band shows the trajectory segment.
   - `.finitemonkey/conceitos-events.jsonl` holds 13 events. The `backend` domain has enough evidence to draw: weeks with no evidence (hatched), a ricochet on `webhook` last week (✕) and a held mark on `idempotency` this week (◉). `infrastructure` has one weighted event, so it shows as "no data".
   - `.finitemonkey/log.jsonl` holds five horizon helps in `backend`, some without criterion, so the blind band is drawn and the band also shows its blind band segment next to the trajectory.

   `test/manual-trajectory.test.ts` keeps this fixture honest: it fails if the seed stops producing both marks in separate weeks, the hatched weeks, the "no data" row or the band segments.

3. Before each surface, write down:
   - the Claude Code version (`claude --version`, or the About entry on Desktop and in the VS Code extension);
   - the Finite Monkey plugin version (shown by `/plugin`);
   - the OS and its version;
   - the surface (Desktop, VS Code, terminal and terminal app name).

4. Open a Claude Code session in `../fm-trajectory-check` on that surface and run `/fm trajectory`. Save one screenshot per row under `docs/manual-checks/screenshots/trajectory-pane/`, named `<claude-code-version>-<surface>-<theme>-<check>.png`.

Never paste a secret, a token or a private path into a screenshot or a result row.

## Checks

Each check has an ID used in the results table. A check passes only if every bullet holds.

### Desktop

- **D1 light** and **D2 dark**: set the Claude Code theme to light, then to dark, and run `/fm trajectory` each time.
  - The chart fills the pane width. Nothing is clipped on the right or at the bottom, and the pane shows no horizontal or vertical scrollbar for the chart.
  - Resize the window narrower and wider: the chart scales with the pane and keeps its proportions (text is not stretched).
  - The background and strata follow the chosen theme.

### VS Code

- **V1 light** and **V2 dark**: the same bullets as D1 and D2, in the Claude Code panel of VS Code, with VS Code's colour theme set to a light theme and then a dark one.

### Auto theme

- **A1 Desktop** and **A2 VS Code**: set the Claude Code theme to a value that does not start with `light` or `dark` (such as auto, if the build offers it). Finite Monkey then draws the Svg with its `prefers-color-scheme: dark` override.
  - With the OS in light mode, the chart uses the light palette.
  - Switch the OS to dark mode without closing the pane, then run `/fm trajectory` again: the chart uses the dark palette.
  - Write down whether the palette changed without running the command again.

### Tooltips

- **T1 Desktop** and **T2 VS Code**: the Svg is drawn with `isInteractive` set.
  - Hovering the ✕ on last week shows a tooltip that starts with `ricochet · webhook ·` and lists its evidence.
  - Hovering the ◉ on this week shows a tooltip that starts with `held · idempotency ·`.
  - Hovering a hatched week shows `<week>: no evidence`.

### Terminal

Run these in a terminal app, with Claude Code in that terminal.

- **R1 truecolor, dark background**: a terminal with `COLORTERM=truecolor`, Claude Code theme dark.
- **R2 256 colours, dark background**: the same terminal with `COLORTERM` unset and `TERM=xterm-256color`, or a terminal that only has 256 colours.
- **R3 truecolor, light background** and **R4 256 colours, light background**: a light terminal profile, Claude Code theme light.

For each one:
- The strata in the pane's Raster have the same colours, in the same order, as the band palette. The reference is the chart that `npx finitemonkey@next trajectory --domain backend` prints in the same terminal from the seeded folder, which names each band next to its colour. On a light background, run it as `COLORFGBG='0;15' npx finitemonkey@next trajectory --domain backend` so the command picks its light palette.
- The ✕ and ◉ marks and the labels are readable against every stratum and against the terminal background.
- On a light background no text or mark disappears into the background.

### Band

- **B1 80 columns** and **B2 120 columns**: resize the terminal to exactly 80 and then 120 columns (`tput cols` prints the width) and send one prompt so the band refreshes.
  - The band line starting with `FM` shows the trajectory segment (domain `backend`, the band of this week and the `webhook` ricochet) next to the blind band segment and the other segments.
  - No segment is cut in the middle of a word, and the band does not wrap to a second line.
  - Write down which segments were shown and which, if any, were dropped.

## When a check fails

Open one issue per failing check, with the check ID, the Claude Code version, the OS, the surface and the screenshot. Put the issue number in the results row. No code changes unless a check fails.

## Results

Add one row per check and run. Keep old rows: results may differ between Claude Code versions, and each row records the version it ran on. `Result` is `pass`, `fail` or `not run`.

| Date | Claude Code | Plugin | OS | Surface | Theme | Check | Result | Screenshot | Issue |
|---|---|---|---|---|---|---|---|---|---|
| - | - | - | - | Desktop | light | D1 | not run | - | - |
| - | - | - | - | Desktop | dark | D2 | not run | - | - |
| - | - | - | - | VS Code | light | V1 | not run | - | - |
| - | - | - | - | VS Code | dark | V2 | not run | - | - |
| - | - | - | - | Desktop | auto | A1 | not run | - | - |
| - | - | - | - | VS Code | auto | A2 | not run | - | - |
| - | - | - | - | Desktop | any | T1 | not run | - | - |
| - | - | - | - | VS Code | any | T2 | not run | - | - |
| - | - | - | - | terminal | dark, truecolor | R1 | not run | - | - |
| - | - | - | - | terminal | dark, 256 colours | R2 | not run | - | - |
| - | - | - | - | terminal | light, truecolor | R3 | not run | - | - |
| - | - | - | - | terminal | light, 256 colours | R4 | not run | - | - |
| - | - | - | - | terminal, 80 columns | any | B1 | not run | - | - |
| - | - | - | - | terminal, 120 columns | any | B2 | not run | - | - |

Results are recorded in this English file only, so there is a single record; the translations carry the same steps.

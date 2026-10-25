---
name: look
description: >-
  Use after changing anything visible in a web interface (a page, a component, styles, copy). Captures each affected screen at 1440 and 390 px wide and opens the images, so "it looks right" means someone looked.
when_to_use: >-
  Trigger phrases include screenshot, how does it look, check the screen, print da tela, olha a tela, captura.
---

# Look: open the screens you changed

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/finitemonkey.mjs" look --json`.
2. Open every image listed in `data` with the Read tool and check for horizontal overflow, cut text, overlap and console errors.
3. Fix what you see, then run the command again. Report which screens you opened.

If the command answers `unknown_command` or `not_implemented`, tell the person in one line that screen capture is not in this version yet and that you did not look at the screens.

import { journeyApproveCommand, journeyCommand, journeyProposeCommand } from "./journey.js";
import { lookRejectCommand } from "./look-approve.js";
import type { CommandSpec } from "./types.js";
import { uiApproveCommand, uiProposeCommand, uiShowCommand } from "./ui.js";
import { uiDontAddCommand, uiDontCommand, uiDontRetireCommand } from "./ui-dont.js";

export const UX_COMMANDS: readonly CommandSpec[] = [
  uiShowCommand,
  uiProposeCommand,
  uiApproveCommand,
  uiDontCommand,
  uiDontAddCommand,
  uiDontRetireCommand,
  journeyCommand,
  journeyProposeCommand,
  journeyApproveCommand,
  lookRejectCommand,
];

import { journeyApproveCommand, journeyCommand, journeyProposeCommand } from "./journey.js";
import { lookRejectCommand } from "./look-approve.js";
import { lookPairCommand, lookPairPickCommand } from "./look-pair.js";
import { lookPerfAcceptCommand } from "./look-perf.js";
import { lookSheetCommand } from "./look-sheet.js";
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
  lookSheetCommand,
  lookPerfAcceptCommand,
  lookPairCommand,
  lookPairPickCommand,
];

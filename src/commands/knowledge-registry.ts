import { CLAIMS_COMMANDS } from "./claims.js";
import { decideRecordsCommand, decideWhyCommand } from "./decide-records.js";
import { experimentsReportCommand } from "./experiments.js";
import { knowledgeMapCommand } from "./knowledge.js";
import { recapCommand } from "./recap.js";
import { retrieveCommand } from "./retrieve.js";
import { staleCommand } from "./stale.js";
import type { CommandSpec } from "./types.js";

export const KNOWLEDGE_COMMANDS = [
  ...CLAIMS_COMMANDS,
  experimentsReportCommand,
  retrieveCommand,
  decideRecordsCommand,
  decideWhyCommand,
  knowledgeMapCommand,
  staleCommand,
  recapCommand,
] as const satisfies readonly CommandSpec[];

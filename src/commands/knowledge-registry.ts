import { CLAIMS_COMMANDS } from "./claims.js";
import { decideRecordsCommand, decideWhyCommand } from "./decide-records.js";
import { experimentsReportCommand } from "./experiments.js";
import { knowledgeMapCommand } from "./knowledge.js";
import { retrieveCommand } from "./retrieve.js";
import { TEACH_COMMANDS } from "./teach.js";
import type { CommandSpec } from "./types.js";

export const KNOWLEDGE_COMMANDS = [
  ...CLAIMS_COMMANDS,
  experimentsReportCommand,
  retrieveCommand,
  decideRecordsCommand,
  decideWhyCommand,
  knowledgeMapCommand,
  ...TEACH_COMMANDS,
] as const satisfies readonly CommandSpec[];

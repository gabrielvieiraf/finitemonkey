import { CLAIMS_COMMANDS } from "./claims.js";
import { decideRecordsCommand, decideWhyCommand } from "./decide-records.js";
import { experimentsReportCommand } from "./experiments.js";
import { knowledgeMapCommand } from "./knowledge.js";
import { mcpConfirmCommand, mcpPinCommand } from "./mcp.js";
import { retrieveCommand } from "./retrieve.js";
import type { CommandSpec } from "./types.js";

export const KNOWLEDGE_COMMANDS = [
  ...CLAIMS_COMMANDS,
  experimentsReportCommand,
  retrieveCommand,
  decideRecordsCommand,
  decideWhyCommand,
  knowledgeMapCommand,
  mcpPinCommand,
  mcpConfirmCommand,
] as const satisfies readonly CommandSpec[];

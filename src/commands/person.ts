import { attentionCommand } from "./attention.js";
import { driftCommand } from "./drift.js";
import { parkCommand, unparkCommand } from "./park.js";
import type { CommandSpec } from "./types.js";

export const PERSON_COMMANDS: readonly CommandSpec[] = [parkCommand, unparkCommand, attentionCommand, driftCommand];

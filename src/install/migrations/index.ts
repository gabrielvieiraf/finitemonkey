import { withoutLegacyPreset } from "../../defaults/items.js";
import { CONFIG_FILE } from "../layout.js";
import type { Migration } from "./types.js";

export type { FileMigration, Migration } from "./types.js";

export const MIGRATIONS: readonly Migration[] = [
  { version: "0.1.0-next.40", files: [{ path: CONFIG_FILE, migrate: withoutLegacyPreset }] },
];

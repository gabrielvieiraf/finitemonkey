import { relative } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { JsonObject } from "../core/parsed.js";
import { toPosixPath } from "../core/posix-path.js";
import { textField, toolInput, toolName } from "../hooks/fields.js";

export const IRREVERSIBLE_KINDS = ["migration", "auth", "persistence", "public_api"] as const;

export type IrreversibleKind = (typeof IRREVERSIBLE_KINDS)[number];

export interface IrreversibleStep {
  readonly kind: IrreversibleKind;
  readonly target: string;
}

const PATHS: readonly (readonly [IrreversibleKind, RegExp])[] = [
  ["migration", /(^|\/)(migrations?|db\/migrate|alembic\/versions)\//],
  ["persistence", /(^|\/)(schema\.prisma|[\w-]+\.entity\.[jt]s|models\.py|schema\.sql)$/],
  ["auth", /(^|\/)(auth|oauth|authn|authz|permissions?)(\/|\.[jt]sx?$|\.py$)/],
  ["public_api", /(^|\/)(openapi|swagger)\.(ya?ml|json)$|(^|\/)schema\.graphql$|(^|\/)api\/contract\.ya?ml$/],
];

const COMMANDS: readonly (readonly [IrreversibleKind, RegExp])[] = [
  [
    "migration",
    /\b(prisma\s+migrate\s+deploy|prisma\s+db\s+push|alembic\s+upgrade|rails\s+db:migrate|knex\s+migrate:latest|sequelize(-cli)?\s+db:migrate|drizzle-kit\s+(push|migrate))\b/,
  ],
  ["public_api", /\b(npm|pnpm|yarn)\s+publish\b/],
];

const WRITERS = new Set(["Write", "Edit", "MultiEdit"]);

export const irreversiblePath = (file: string): IrreversibleKind | undefined =>
  PATHS.find(([, pattern]) => pattern.test(file))?.[0];

export const irreversibleCommand = (command: string): IrreversibleKind | undefined =>
  COMMANDS.find(([, pattern]) => pattern.test(command))?.[0];

export const irreversibleStep = (raw: JsonObject, root: AbsolutePath): IrreversibleStep | undefined => {
  const tool = toolName(raw);
  const args = toolInput(raw);
  if (tool === "Bash") {
    const command = textField(args, "command") ?? "";
    const kind = irreversibleCommand(command);
    return kind === undefined ? undefined : { kind, target: command.trim().slice(0, 200) };
  }
  const path = textField(args, "file_path");
  if (!WRITERS.has(tool) || path === undefined) return undefined;
  const file = toPosixPath(relative(root, toAbsolutePath(path, root)));
  const kind = irreversiblePath(file);
  return kind === undefined ? undefined : { kind, target: file };
};

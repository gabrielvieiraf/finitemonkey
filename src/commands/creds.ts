import { toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { envInHistory, type HistoryEnv, openHistoryIncidents } from "../creds/history.js";
import { type Credential, credentialInventory, CREDS_FILE, inventoryYaml } from "../creds/inventory.js";
import { ExitCode } from "../exit-codes.js";
import { personName, projectRoot } from "../secrets/project.js";
import type { CommandSpec } from "./types.js";

export const CREDS_SCHEMA = "finitemonkey/creds@1";

export interface CredsData {
  readonly schema: typeof CREDS_SCHEMA;
  readonly file: string;
  readonly credentials: readonly Credential[];
  readonly history: readonly (HistoryEnv & { readonly incident: string | null })[];
}

const notes = (ctx: Ctx, data: CredsData): readonly string[] => [
  ctx.t("creds.inventory.written", { count: data.credentials.length, file: data.file }),
  ...data.credentials
    .filter((credential) => credential.shared)
    .map((credential) =>
      ctx.t("creds.inventory.shared", { name: credential.name, services: credential.services.join(", ") }),
    ),
  ...data.credentials.flatMap((credential) =>
    credential.cloud === undefined || credential.type !== "static"
      ? []
      : [ctx.t("creds.inventory.static_cloud", { name: credential.name, cloud: credential.cloud })],
  ),
  ...data.history.map((item) =>
    ctx.t("creds.inventory.incident", { file: item.file, commit: item.commit.slice(0, 12), id: item.incident ?? "" }),
  ),
];

export const runCreds = (ctx: Ctx): CommandResult<CredsData> => {
  const root = projectRoot(ctx);
  const credentials = credentialInventory(ctx.runtime, root);
  const found = envInHistory(ctx.runtime, root);
  const ids = openHistoryIncidents(ctx.runtime, root, found, personName(ctx));
  const history = found.map((item, index) => ({ ...item, incident: ids[index] ?? null }));
  const data: CredsData = { schema: CREDS_SCHEMA, file: CREDS_FILE, credentials, history };
  const made = ctx.runtime.mkdir(toAbsolutePath(".finitemonkey", root));
  const saved = made.ok ? ctx.runtime.writeText(toAbsolutePath(CREDS_FILE, root), inventoryYaml(credentials)) : made;
  if (saved.ok) return success(data, notes(ctx, data));
  return failureFrom(ctx.t, {
    code: "creds_write_failed",
    messageKey: "creds.write_failed",
    params: { file: CREDS_FILE, detail: saved.error },
    fix: `check that ${CREDS_FILE} can be written, then run finitemonkey creds again`,
    exitCode: ExitCode.CheckFailed,
    data,
  });
};

export const credsCommand: CommandSpec = {
  path: ["creds"],
  summaryKey: "creds.command.inventory",
  usage: "finitemonkey creds",
  status: "ready",
  maxPositionals: 0,
  run: (ctx) => Promise.resolve(runCreds(ctx)),
};

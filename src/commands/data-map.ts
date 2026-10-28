import { toAbsolutePath } from "../core/brand.js";
import { failureFrom, success } from "../core/result.js";
import { DATA_MAP_FILE, dataMapYaml, isComplete, mergedRows, personalFields, readDataMap } from "../datamap/map.js";
import { projectRoot } from "../secrets/project.js";
import { writeFailed } from "./secrets-problems.js";
import type { CommandSpec } from "./types.js";

export const dataMapCommand: CommandSpec = {
  path: ["data-map"],
  summaryKey: "datamap.command",
  usage: "finitemonkey data-map",
  status: "ready",
  maxPositionals: 0,
  run: (ctx) => {
    const root = projectRoot(ctx);
    const before = readDataMap(ctx.runtime, root);
    const rows = mergedRows(personalFields(ctx.runtime, root), before);
    const made = ctx.runtime.mkdir(toAbsolutePath(".finitemonkey", root));
    const saved = made.ok ? ctx.runtime.writeText(toAbsolutePath(DATA_MAP_FILE, root), dataMapYaml(rows)) : made;
    if (!saved.ok) return Promise.resolve(failureFrom(ctx.t, writeFailed(DATA_MAP_FILE, saved.error)));
    const open = rows.filter((row) => !isComplete(row)).map((row) => row.field);
    const data = {
      schema: "finitemonkey/data-map@1",
      file: DATA_MAP_FILE,
      rows,
      added: rows.length - before.length,
      open,
    };
    return Promise.resolve(
      success(data, [
        ctx.t("datamap.written", { file: DATA_MAP_FILE, count: rows.length, added: data.added }),
        ...(open.length === 0 ? [] : [ctx.t("datamap.open", { fields: open.join(", ") })]),
      ]),
    );
  },
};

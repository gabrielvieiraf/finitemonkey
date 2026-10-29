import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import type { PagePass } from "./node-ux.js";
import { runInPage } from "./probe-dom.js";
import { buildSheet, diffSheets, type Sheet, SHEET_FEATURE } from "./sheet.js";
import { approvedSheetPath, readSheet, rootSelector } from "./sheet-store.js";
import type { TokenSet } from "./tokens.js";
import { issue, type UxIssue } from "./ux.js";

export const approvedSheets = (
  runtime: Pick<Runtime, "readText">,
  paths: FmPaths,
  routes: readonly string[],
): Readonly<Record<string, Sheet>> =>
  Object.fromEntries(
    routes.flatMap((route) => {
      const sheet = readSheet(runtime, approvedSheetPath(paths, route));
      return sheet === undefined ? [] : [[route, sheet]];
    }),
  );

export const sheetPass = (approved: Readonly<Record<string, Sheet>>, tokens: TokenSet): PagePass => ({
  feature: SHEET_FEATURE,
  allWidths: true,
  run: async (page, at) => {
    const before = approved[at.route];
    if (before === undefined) return [];
    const probe = await at.probe();
    const raw: unknown = await page.evaluate(
      runInPage(rootSelector.toString(), ["document", JSON.stringify(before.selector)]),
    );
    const root = typeof raw === "string" ? raw : undefined;
    const now = buildSheet({
      route: at.route,
      selector: before.selector,
      tree: "",
      views: [{ width: at.viewport, state: "ideal", probe, root }],
      tokens,
    });
    const scoped = {
      ...before,
      views: before.views.filter((view) => view.width === at.viewport && view.state === "ideal"),
    };
    const tokened = (px: number | null): boolean =>
      px !== null && now.variables.some((variable) => variable.px === px && variable.token !== undefined);
    const changes: readonly UxIssue[] = diffSheets(scoped, now).map((change) =>
      issue(
        "sheet/changed",
        change.key,
        `${change.property} ${String(change.from ?? "[unmeasured]")} → ${String(change.to ?? "[unmeasured]")}`,
        {
          ...(tokened(change.to) ? { advisory: true as const } : {}),
        },
      ),
    );
    return [...changes, ...now.issues.map((item) => issue(item.rule, item.key, item.detail))];
  },
});

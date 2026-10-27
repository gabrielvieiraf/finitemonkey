import { portOpen, type RunningApp, startApp, stopApp, waitForPort } from "../app/node-process.js";
import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { gitAt, gitRoot, treeHash } from "../gate/git.js";
import { readApprovals } from "../guards/release/grants.js";
import { fmPaths } from "../task/paths.js";
import { loadLookConfig, type LookConfig, lookRoutes } from "./config.js";
import { applyAllows, pageFindings } from "./findings.js";
import { captureAll, type PageResult } from "./node-capture.js";
import { launchBrowser, loadPlaywright } from "./node-playwright.js";
import { contactSheet } from "./node-sheet.js";
import { lookDir } from "./paths.js";
import { recordLook } from "./record.js";
import { type LookSummary, VIEWPORTS } from "./types.js";

export type LookRun =
  | { readonly kind: "not_a_repo" | "not_configured" | "playwright_missing" | "browser_missing" }
  | { readonly kind: "app_failed"; readonly detail: string }
  | { readonly kind: "done"; readonly summary: LookSummary; readonly summaryPath: string };

interface Ready {
  readonly root: AbsolutePath;
  readonly tree: string;
  readonly config: LookConfig & { readonly port: number };
}

const prepare = (runtime: Runtime, cwd: AbsolutePath): Ready | LookRun => {
  const root = gitRoot(gitAt(runtime, cwd));
  if (root === undefined) return { kind: "not_a_repo" };
  const tree = treeHash(gitAt(runtime, root));
  const config = loadLookConfig(runtime, root);
  if (tree === undefined) return { kind: "not_a_repo" };
  if (config?.port === undefined) return { kind: "not_configured" };
  return { root, tree, config: { ...config, port: config.port } };
};

const bootApp = async (ready: Ready): Promise<RunningApp | undefined | { readonly detail: string }> => {
  const { config } = ready;
  if (await portOpen(config.host, config.port)) return undefined;
  if (config.start === undefined) return { detail: `nothing listens on ${config.host}:${String(config.port)}` };
  const app = startApp(config.start, ready.root, config.port);
  const state = await waitForPort(app, config.host, config.port, Date.now() + config.timeoutS * 1000);
  if (state === "open") return app;
  await stopApp(app);
  return {
    detail: state === "exited" ? `the app exited with code ${String(app.exited()?.code ?? -1)}` : "port timeout",
  };
};

const capture = async (
  ready: Ready,
): Promise<{ readonly results: readonly PageResult[]; readonly sheet: string | undefined } | LookRun> => {
  const playwright = await loadPlaywright(ready.root);
  if (playwright === undefined) return { kind: "playwright_missing" };
  const browser = await launchBrowser(playwright);
  if (browser === undefined) return { kind: "browser_missing" };
  try {
    const dir = lookDir(fmPaths(ready.root), ready.tree);
    const results = await captureAll(browser, {
      baseUrl: `http://${ready.config.host}:${String(ready.config.port)}`,
      routes: lookRoutes(ready.config),
      viewports: VIEWPORTS,
      dir,
      timeoutMs: ready.config.timeoutS * 1000,
    });
    return { results, sheet: await contactSheet(browser, results, dir) };
  } finally {
    await browser.close();
  }
};

export const runLook = async (runtime: Runtime, cwd: AbsolutePath): Promise<LookRun> => {
  const ready = prepare(runtime, cwd);
  if ("kind" in ready) return ready;
  const app = await bootApp(ready);
  if (app !== undefined && "detail" in app) return { kind: "app_failed", detail: app.detail };
  try {
    const shot = await capture(ready);
    if ("kind" in shot) return shot;
    const paths = fmPaths(ready.root);
    const approvals = readApprovals(runtime, paths);
    const allowed = applyAllows(shot.results.flatMap(pageFindings), ready.config.allow, (decision) =>
      approvals.some((approval) => approval.check === decision),
    );
    return recordLook(runtime, paths, ready.tree, shot, allowed);
  } finally {
    if (app !== undefined) await stopApp(app);
  }
};

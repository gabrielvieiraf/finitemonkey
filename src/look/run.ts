import { fetchHeaders } from "../app/node-probe.js";
import { portOpen, type RunningApp, startApp, stopApp, waitForPort } from "../app/node-process.js";
import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { gitAt, gitRoot, treeHash } from "../gate/git.js";
import { readApprovals } from "../guards/release/grants.js";
import { probeHeaders } from "../headers/probe.js";
import { HEADERS_FEATURE, writeHeaders } from "../headers/record.js";
import { featureMode } from "../policy/feature.js";
import { fmPaths } from "../task/paths.js";
import { readApproved, writeLayouts } from "./approved.js";
import { loadLookConfig, type LookConfig, lookRoutes } from "./config.js";
import { applyAllows, pageFindings } from "./findings.js";
import { captureAll, type PageResult } from "./node-capture.js";
import { launchBrowser, loadPlaywright } from "./node-playwright.js";
import { contactSheet } from "./node-sheet.js";
import { isLoopback } from "./node-ux.js";
import { lookDir } from "./paths.js";
import { recordLook } from "./record.js";
import { type LookSummary, VIEWPORTS } from "./types.js";
import { loadUiConfig, UI_FEATURE } from "./ui.js";
import { layoutsOf, uiFindings } from "./ui-findings.js";
import type { UxPage } from "./ux.js";
import { activeModes, type ModeMap, uxPasses, uxSetup, uxStaticPages, uxWidths } from "./ux-features.js";
import { governAndRecord } from "./ux-govern.js";
import { sessionPages } from "./ux-sessions.js";

export type LookRun =
  | { readonly kind: "not_a_repo" | "not_configured" | "playwright_missing" | "browser_missing" }
  | { readonly kind: "app_failed"; readonly detail: string }
  | { readonly kind: "done"; readonly summary: LookSummary; readonly summaryPath: string };

interface Ready {
  readonly root: AbsolutePath;
  readonly tree: string;
  readonly config: LookConfig & { readonly port: number };
  readonly modes: ModeMap;
}

const prepare = (runtime: Runtime, cwd: AbsolutePath): Ready | LookRun => {
  const root = gitRoot(gitAt(runtime, cwd));
  if (root === undefined) return { kind: "not_a_repo" };
  const tree = treeHash(gitAt(runtime, root));
  const config = loadLookConfig(runtime, root);
  if (tree === undefined) return { kind: "not_a_repo" };
  if (config?.port === undefined) return { kind: "not_configured" };
  if (!isLoopback(config.host)) return { kind: "app_failed", detail: `host ${config.host} is not a loopback address` };
  const modes = activeModes(runtime, fmPaths(root));
  return { root, tree, config: { ...config, port: config.port }, modes };
};

const bootApp = async (ready: Ready): Promise<RunningApp | undefined | { readonly detail: string }> => {
  const { config } = ready;
  if (await portOpen(config.host, config.port)) return undefined;
  if (config.start === undefined) return { detail: `nothing listens on ${config.host}:${String(config.port)}` };
  const app = startApp(config.start, ready.root, config.port, ready.modes["a11y"] === "active");
  const state = await waitForPort(app, config.host, config.port, Date.now() + config.timeoutS * 1000);
  if (state === "open") return app;
  await stopApp(app);
  return {
    detail: state === "exited" ? `the app exited with code ${String(app.exited()?.code ?? -1)}` : "port timeout",
  };
};

interface Shot {
  readonly results: readonly PageResult[];
  readonly sheet: string | undefined;
  readonly ux: readonly UxPage[];
  readonly blocked: readonly string[];
}

const capture = async (runtime: Runtime, ready: Ready): Promise<Shot | LookRun> => {
  const playwright = await loadPlaywright(ready.root);
  if (playwright === undefined) return { kind: "playwright_missing" };
  const browser = await launchBrowser(playwright);
  if (browser === undefined) return { kind: "browser_missing" };
  try {
    const dir = lookDir(fmPaths(ready.root), ready.tree);
    const passes = uxPasses(runtime, ready.root, ready.config, ready.modes, ready.tree);
    const baseUrl = `http://${ready.config.host}:${String(ready.config.port)}`;
    const output = await captureAll(browser, {
      baseUrl,
      routes: lookRoutes(ready.config),
      viewports: VIEWPORTS,
      dir,
      timeoutMs: ready.config.timeoutS * 1000,
      passes,
      extraWidths: uxWidths(ready.modes),
      isolate: passes.length > 0,
    });
    const sessions = await sessionPages(browser, {
      runtime,
      root: ready.root,
      config: ready.config,
      modes: ready.modes,
      screens: uxSetup(runtime, ready.root, ready.config, ready.modes).screens,
      request: { baseUrl, timeoutMs: ready.config.timeoutS * 1000, isolate: true },
    });
    return {
      results: output.results,
      ux: [...output.ux, ...sessions],
      blocked: output.blocked,
      sheet: await contactSheet(browser, output.results, dir),
    };
  } finally {
    await browser.close();
  }
};

const recordHeaders = async (runtime: Runtime, ready: Ready): Promise<void> => {
  const paths = fmPaths(ready.root);
  if (featureMode(runtime, paths, HEADERS_FEATURE) === "off") return;
  const base = `http://${ready.config.host}:${String(ready.config.port)}`;
  const routes = await probeHeaders(fetchHeaders, base, ready.config.routes, ready.config.timeoutS * 1000);
  writeHeaders(runtime, paths, ready.tree, { at: runtime.now(), https: false, routes });
};

export const runLook = async (runtime: Runtime, cwd: AbsolutePath): Promise<LookRun> => {
  const ready = prepare(runtime, cwd);
  if ("kind" in ready) return ready;
  const app = await bootApp(ready);
  if (app !== undefined && "detail" in app) return { kind: "app_failed", detail: app.detail };
  try {
    const shot = await capture(runtime, ready);
    if ("kind" in shot) return shot;
    const paths = fmPaths(ready.root);
    const approvals = readApprovals(runtime, paths);
    writeLayouts(runtime, paths, ready.tree, layoutsOf(shot.results));
    const extra = uiFindings(
      shot.results,
      loadUiConfig(runtime, ready.root),
      readApproved(runtime, paths),
      featureMode(runtime, paths, UI_FEATURE),
    );
    await recordHeaders(runtime, ready);
    const ux = governAndRecord({ runtime, paths, tree: ready.tree, modes: ready.modes }, [
      ...shot.ux,
      ...uxStaticPages(runtime, ready.root, ready.config, ready.modes),
    ]);
    const base = shot.results
      .flatMap(pageFindings)
      .filter((item) => item.rule !== "look/touch-target" || ready.modes["a11y"] === "off");
    const allowed = applyAllows([...base, ...extra, ...ux], ready.config.allow, (decision) =>
      approvals.some((approval) => approval.check === decision),
    );
    return recordLook(runtime, paths, ready.tree, shot, allowed);
  } finally {
    if (app !== undefined) await stopApp(app);
  }
};

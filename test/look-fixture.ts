import { createServer } from "node:http";

import { launchBrowser, loadPlaywright } from "../src/look/node-playwright.js";
import { type LookRun, runLook } from "../src/look/run.js";
import { contractHash, parseContract } from "../src/task/load.js";
import { fmPaths } from "../src/task/paths.js";
import { readState, readTrust, writeState, writeTrust } from "../src/task/state.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { ROOT } from "./support.js";

export interface FixturePage {
  readonly body: string;
  readonly type?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly delayMs?: number;
  readonly raw?: boolean;
}

export type FixturePages = Readonly<Record<string, string | FixturePage>>;

export const serverSource = (pages: FixturePages): string =>
  [
    'const http = require("node:http");',
    `const pages = ${JSON.stringify(pages)};`,
    'const wrap = (body) => `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><style>body{margin:8px;font:16px sans-serif}</style></head><body>${body}</body></html>`;',
    "http.createServer((req, res) => {",
    '  const url = req.url || "/";',
    '  const path = url.split("?")[0];',
    "  const mock = /[?&]mock=([^&]+)/.exec(url);",
    "  const found = (mock && pages[`${path}?mock=${decodeURIComponent(mock[1])}`]) ?? pages[path];",
    '  if (found === undefined) { res.statusCode = 404; res.end("missing"); return; }',
    '  const page = typeof found === "string" ? { body: found } : found;',
    "  const send = () => {",
    '    res.setHeader("content-type", page.type || "text/html");',
    "    for (const [name, value] of Object.entries(page.headers || {})) res.setHeader(name, value);",
    "    res.end(page.raw || page.type ? page.body : wrap(page.body));",
    "  };",
    "  if (page.delayMs) setTimeout(send, page.delayMs); else send();",
    '}).listen(Number(process.env.PORT), "127.0.0.1");',
    "",
  ].join("\n");

export const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address === null || typeof address === "string") reject(new Error("no port"));
        else resolve(address.port);
      });
    });
  });

export const hasBrowser = async (): Promise<boolean> => {
  const playwright = await loadPlaywright(ROOT);
  const launched = playwright === undefined ? undefined : await launchBrowser(playwright);
  await launched?.close();
  if (launched === undefined && process.env["CI"] !== undefined) throw new Error("no browser for look tests in CI");
  return launched !== undefined;
};

const activate = (repo: Repo): void => {
  const text = ["id: t1", "goal: screens", "size: S", "acceptance:", "  - id: look", "    check: look", ""].join("\n");
  const parsed = parseContract("t1", text);
  if (!parsed.ok) throw new Error("bad contract");
  const runtime = repoRuntime();
  const paths = fmPaths(repo.root);
  runtime.writeText(paths.task("t1"), text);
  const lock = readTrust(runtime, paths);
  writeTrust(runtime, paths, {
    ...lock,
    contracts: { ...lock.contracts, t1: contractHash(parsed.value) },
    approved: { ...lock.approved, t1: text },
  });
  writeState(runtime, paths, { ...readState(runtime, paths), active: "t1" });
};

export interface FixtureOptions {
  readonly routes: readonly string[];
  readonly look?: readonly string[];
  readonly files?: Readonly<Record<string, string>>;
  readonly policy?: string;
}

export const fixtureRepo = async (pages: FixturePages, options: FixtureOptions): Promise<Repo> => {
  const port = await freePort();
  const repo = makeRepo({
    "server.js": serverSource(pages),
    ".finitemonkey/look.yml": [
      `port: ${String(port)}`,
      "start: node server.js",
      "routes:",
      ...options.routes.map((route) => `  - ${route}`),
      ...(options.look ?? []),
      "",
    ].join("\n"),
    ...(options.policy === undefined ? {} : { ".finitemonkey/policy.yml": options.policy }),
    ...options.files,
  });
  activate(repo);
  return repo;
};

export const finished = (run: LookRun): Extract<LookRun, { readonly kind: "done" }> => {
  if (run.kind !== "done") throw new Error(`look did not finish: ${JSON.stringify(run)}`);
  return run;
};

export const lookAt = async (repo: Repo): Promise<Extract<LookRun, { readonly kind: "done" }>> =>
  finished(await runLook(repoRuntime(), repo.root));

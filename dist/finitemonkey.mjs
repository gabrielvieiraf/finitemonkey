#!/usr/bin/env node

// src/core/brand.ts
import { isAbsolute, resolve } from "node:path";
var toAbsolutePath = (path, base) => isAbsolute(path) || !base ? resolve(path) : resolve(base, path);

// src/core/entry.ts
import { fileURLToPath } from "node:url";
var isEntryPoint = (moduleUrl, argv1, realpath, platform) => {
  if (argv1 === void 0) return false;
  const self = realpath(fileURLToPath(moduleUrl));
  const invoked = realpath(argv1);
  return platform === "win32" ? self.toLowerCase() === invoked.toLowerCase() : self === invoked;
};

// src/core/node-runtime.ts
import { spawnSync as spawnSync3 } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// src/core/node-exec.ts
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// src/core/parsed.ts
var accept = (value) => ({ ok: true, value });
var reject = (error) => ({ ok: false, error });
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var parseJson = (text6) => {
  try {
    return accept(JSON.parse(text6));
  } catch (error) {
    return reject(error instanceof Error ? error.message : String(error));
  }
};
var parseJsonObject = (text6) => {
  const parsed = parseJson(text6);
  if (!parsed.ok) return parsed;
  return isRecord(parsed.value) ? accept(parsed.value) : reject("expected a JSON object");
};
var optionalString = (record2, key) => {
  const value = record2[key];
  return typeof value === "string" ? value : void 0;
};

// src/core/node-exec.ts
var SHELL_NOT_FOUND = /* @__PURE__ */ new Set([127, 9009]);
var CMD_NOT_FOUND = /is not recognized as an internal or external command|não é reconhecido como um comando interno|no se reconoce como un comando interno/i;
var MAX_BUFFER = 64 * 1024 * 1024;
var errnoCode = (error) => {
  if (!(error instanceof Error) || !("code" in error)) return void 0;
  return typeof error.code === "string" ? error.code : void 0;
};
var text = (value) => typeof value === "string" ? value : "";
var nodeExec = (request) => {
  const started = Date.now();
  const options = {
    cwd: request.cwd,
    encoding: "utf8",
    timeout: request.timeoutMs,
    windowsHide: true,
    maxBuffer: MAX_BUFFER,
    env: Object.fromEntries(
      Object.entries({ ...process.env, ...request.env }).filter(([name]) => !(request.unset ?? []).includes(name))
    )
  };
  const result = request.shell === true ? spawnSync([request.command, ...request.args].join(" "), { ...options, shell: true }) : spawnSync(request.command, [...request.args], options);
  const code = errnoCode(result.error);
  const exitCode = result.status;
  const shellMissing = request.shell === true && exitCode !== null && (SHELL_NOT_FOUND.has(exitCode) || exitCode === 1 && CMD_NOT_FOUND.test(text(result.stderr)));
  const notFound3 = code === "ENOENT" || shellMissing;
  return {
    found: !notFound3,
    exitCode,
    stdout: text(result.stdout),
    stderr: text(result.stderr),
    timedOut: code === "ETIMEDOUT",
    durationMs: Date.now() - started
  };
};
var nodeAppendText = (path, content) => {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 448 });
    appendFileSync(path, content, { mode: 384 });
    return accept(true);
  } catch (error) {
    return reject(error instanceof Error ? error.message : String(error));
  }
};
var nodeSpawnSelf = (selfPath) => (args, cwd) => {
  try {
    const child2 = spawn(process.execPath, [selfPath, ...args], {
      cwd,
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child2.on("error", () => void 0);
    child2.unref();
    return true;
  } catch {
    return false;
  }
};

// src/core/node-fs.ts
import { randomBytes } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync as mkdirSync2,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeSync
} from "node:fs";
import { basename, dirname as dirname2, join, relative } from "node:path";
var NEW_FILE_MODE = 420;
var SKIPPED_DIRS = /* @__PURE__ */ new Set([".git", "node_modules"]);
var messageOf = (error) => error instanceof Error ? error.message : String(error);
var errnoOf = (error) => error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : void 0;
var attempt = (work) => {
  try {
    work();
    return accept(void 0);
  } catch (error) {
    return reject(messageOf(error));
  }
};
var nodeWriteText = (path, text6) => {
  const temp = `${path}.${String(process.pid)}.tmp`;
  try {
    mkdirSync2(dirname2(path), { recursive: true, mode: 448 });
    const fd = openSync(temp, "w", 384);
    try {
      writeSync(fd, text6);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
    return accept(true);
  } catch (error) {
    rmSync(temp, { force: true });
    return reject(messageOf(error));
  }
};
var nodeStat = (path) => {
  try {
    const stats = statSync(path);
    return { kind: stats.isDirectory() ? "dir" : "file", mtimeMs: stats.mtimeMs };
  } catch {
    return void 0;
  }
};
var nodeListDir = (path) => {
  try {
    return accept(readdirSync(path).sort());
  } catch (error) {
    return reject(messageOf(error));
  }
};
var modeOf = (path) => {
  try {
    return statSync(path).mode & 511;
  } catch {
    return NEW_FILE_MODE;
  }
};
var writeAndSync = (file, content, mode) => {
  const fd = openSync(file, "wx", mode);
  try {
    writeSync(fd, content, null, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
};
var nodeWriteAtomic = (path, content) => {
  const temp = join(dirname2(path), `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
  return attempt(() => {
    try {
      writeAndSync(temp, content, modeOf(path));
      renameSync(temp, path);
    } catch (error) {
      rmSync(temp, { force: true });
      throw error;
    }
  });
};
var nodeRename = (from, to) => attempt(() => {
  renameSync(from, to);
});
var nodeMkdir = (path) => attempt(() => {
  mkdirSync2(path, { recursive: true });
});
var nodeRemove = (path) => attempt(() => {
  rmSync(path, { recursive: true, force: true });
});
var createLock = (path, owner, now) => {
  const fd = openSync(path, "wx", 384);
  try {
    writeSync(fd, `${JSON.stringify({ owner, pid: process.pid, at: now })}
`, null, "utf8");
  } finally {
    closeSync(fd);
  }
};
var release = (path) => () => {
  try {
    unlinkSync(path);
  } catch {
    return;
  }
};
var isStale = (path, staleMs, now) => {
  const stat = nodeStat(path);
  return stat !== void 0 && now - stat.mtimeMs > staleMs;
};
var nodeLock = (path, options) => {
  for (let round = 0; round < 2; round += 1) {
    const now = Date.now();
    try {
      createLock(path, options.owner, now);
      return accept(release(path));
    } catch (error) {
      if (errnoOf(error) !== "EEXIST") return reject(messageOf(error));
      if (!isStale(path, options.staleMs, now)) return reject(`locked: ${path}`);
      rmSync(path, { force: true });
    }
  }
  return reject(`locked: ${path}`);
};
var walkInto = (root, dir, out) => {
  for (const entry2 of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry2.name);
    if (entry2.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry2.name)) walkInto(root, full, out);
    } else if (entry2.isFile()) {
      out.push(relative(root, full).split("\\").join("/"));
    }
  }
};
var nodeWalkFiles = (root) => {
  try {
    const out = [];
    walkInto(root, root, out);
    return accept(out.sort());
  } catch (error) {
    return reject(messageOf(error));
  }
};

// src/core/node-git.ts
import { spawn as spawn2, spawnSync as spawnSync2 } from "node:child_process";
import { createInterface } from "node:readline";
var MAX_BUFFER2 = 256 * 1024 * 1024;
var GIT_ENV = { ...process.env, GIT_PAGER: "cat", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
var notFound = (error) => error instanceof Error && "code" in error && error.code === "ENOENT";
var nodeGit = (args, cwd) => {
  const result = spawnSync2("git", [...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER2,
    windowsHide: true,
    env: GIT_ENV
  });
  const stdout = result.stdout;
  return {
    found: !notFound(result.error),
    ok: result.error === void 0 && result.status === 0,
    stdout: typeof stdout === "string" ? stdout : ""
  };
};
var nodeGitLines = (args, cwd, onLine) => new Promise((resolve2) => {
  const child2 = spawn2("git", [...args], {
    cwd,
    windowsHide: true,
    env: GIT_ENV,
    stdio: ["ignore", "pipe", "ignore"]
  });
  let found = true;
  child2.on("error", (error) => {
    found = !notFound(error);
  });
  const lines3 = createInterface({ input: child2.stdout, crlfDelay: Infinity });
  lines3.on("line", onLine);
  child2.on("close", (code) => {
    resolve2({ found, ok: found && code === 0, stdout: "" });
  });
});
var textOf = (value) => typeof value === "string" ? value : "";
var nodeGitWith = (args, cwd, options) => {
  const result = spawnSync2("git", [...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER2,
    windowsHide: true,
    env: { ...GIT_ENV, ...options.env },
    ...options.input === void 0 ? {} : { input: options.input },
    ...options.timeoutMs === void 0 ? {} : { timeout: options.timeoutMs }
  });
  const timedOut = result.error instanceof Error && "code" in result.error && result.error.code === "ETIMEDOUT";
  return {
    found: !notFound(result.error),
    ok: result.error === void 0 && result.status === 0,
    stdout: textOf(result.stdout),
    stderr: textOf(result.stderr),
    timedOut
  };
};

// src/core/node-runtime.ts
var SAFE_TOKEN = /^[A-Za-z0-9._-]+$/;
var WINDOWS_NOT_FOUND = 9009;
var errnoCode2 = (error) => {
  if (!(error instanceof Error) || !("code" in error)) return void 0;
  return typeof error.code === "string" ? error.code : void 0;
};
var spawnProbe = (command, args, timeout) => {
  const options = { encoding: "utf8", timeout, windowsHide: true };
  return process.platform === "win32" ? spawnSync3([command, ...args].join(" "), { ...options, shell: true }) : spawnSync3(command, [...args], options);
};
var nodeProbe = (command, args, timeoutMs) => {
  if (![command, ...args].every((token) => SAFE_TOKEN.test(token))) {
    return { found: false, ok: false, stdout: "", timedOut: false };
  }
  const result = spawnProbe(command, args, timeoutMs);
  const code = errnoCode2(result.error);
  const stdout = result.stdout;
  return {
    found: code !== "ENOENT" && result.status !== WINDOWS_NOT_FOUND,
    ok: result.error === void 0 && result.status === 0,
    stdout: typeof stdout === "string" ? stdout.trim() : "",
    timedOut: code === "ETIMEDOUT"
  };
};
var nodeReadText = (path) => {
  try {
    return accept(readFileSync(path, "utf8"));
  } catch (error) {
    return reject(error instanceof Error ? error.message : String(error));
  }
};
var nodeRealpath = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};
var SELF_PATH = toAbsolutePath(fileURLToPath2(import.meta.url));
var nodeRuntime = () => ({
  nodeVersion: process.versions.node,
  readText: nodeReadText,
  probe: nodeProbe,
  startTimer: (ms, onFire) => {
    const timer = setTimeout(onFire, ms);
    return () => {
      clearTimeout(timer);
    };
  },
  writeText: nodeWriteText,
  listDir: nodeListDir,
  walkFiles: nodeWalkFiles,
  now: () => (/* @__PURE__ */ new Date()).toISOString(),
  git: nodeGit,
  gitLines: nodeGitLines,
  stat: nodeStat,
  writeAtomic: nodeWriteAtomic,
  rename: nodeRename,
  mkdir: nodeMkdir,
  remove: nodeRemove,
  lock: nodeLock,
  selfPath: SELF_PATH,
  exec: nodeExec,
  appendText: nodeAppendText,
  spawnSelf: nodeSpawnSelf(SELF_PATH),
  gitWith: nodeGitWith,
  realpath: nodeRealpath,
  homeDir: homedir
});

// src/doctor/system.ts
var detectOs = ({ platform, env, runtime }) => {
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  if (platform !== "linux") return "other";
  if (env["WSL_DISTRO_NAME"] !== void 0 || env["WSL_INTEROP"] !== void 0) return "wsl";
  const version = runtime.readText(toAbsolutePath("/proc/version"));
  return version.ok && /microsoft/i.test(version.value) ? "wsl" : "linux";
};
var WSL_MOUNT = /^\/mnt\/[a-z](\/|$)/i;
var SYNCED = /(OneDrive|Dropbox|iCloud ?Drive|Mobile Documents|Google ?Drive)/i;
var NON_ASCII = /[^\x20-\x7e]/;
var pathTraits = (path) => ({
  spaces: path.includes(" "),
  nonAscii: NON_ASCII.test(path),
  synced: SYNCED.test(path)
});
var checkOs = (env) => {
  const os = detectOs(env);
  const findings = [
    { check: "os", status: "ok", messageKey: `doctor.os.${os}`, params: { platform: env.platform } }
  ];
  if (os === "wsl" && WSL_MOUNT.test(env.cwd)) {
    findings.push({
      check: "path.wsl_mount",
      status: "warn",
      messageKey: "doctor.path.wsl_mount",
      params: { path: env.cwd },
      fixKey: "doctor.path.fix_wsl_mount"
    });
  }
  return findings;
};
var checkPath = ({ cwd }) => {
  const traits = pathTraits(cwd);
  const chars = traits.spaces || traits.nonAscii ? {
    check: "path.chars",
    status: "warn",
    messageKey: "doctor.path.chars",
    params: { path: cwd },
    fixKey: "doctor.path.fix_chars"
  } : { check: "path.chars", status: "ok", messageKey: "doctor.path.plain", params: { path: cwd } };
  const synced = traits.synced ? [
    {
      check: "path.synced",
      status: "warn",
      messageKey: "doctor.path.synced",
      params: { path: cwd },
      fixKey: "doctor.path.fix_synced"
    }
  ] : [];
  return [chars, ...synced];
};

// src/doctor/tools.ts
var MIN_NODE_MAJOR = 20;
var MIN_GIT = { major: 2, minor: 38 };
var PROBE_TIMEOUT_MS = { git: 5e3, claude: 8e3 };
var parseGitVersion = (output) => {
  const match = /(\d+)\.(\d+)/.exec(output);
  if (match?.[1] === void 0 || match[2] === void 0) return void 0;
  return { major: Number(match[1]), minor: Number(match[2]) };
};
var isOlder = (version, min) => version.major < min.major || version.major === min.major && version.minor < min.minor;
var checkNode = ({ runtime }) => {
  const version = runtime.nodeVersion.replace(/^v/, "");
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  if (Number.isNaN(major) || major < MIN_NODE_MAJOR) {
    return [
      {
        check: "node",
        status: "fail",
        messageKey: "doctor.node.old",
        params: { version, min: MIN_NODE_MAJOR },
        fixKey: "doctor.node.fix"
      }
    ];
  }
  return [{ check: "node", status: "ok", messageKey: "doctor.node.ok", params: { version } }];
};
var checkGit = ({ runtime }) => {
  const result = runtime.probe("git", ["--version"], PROBE_TIMEOUT_MS.git);
  if (!result.found || !result.ok) {
    return [{ check: "git", status: "fail", messageKey: "doctor.git.missing", fixKey: "doctor.git.fix" }];
  }
  const parsed = parseGitVersion(result.stdout);
  const version = parsed === void 0 ? result.stdout : `${String(parsed.major)}.${String(parsed.minor)}`;
  if (parsed === void 0 || isOlder(parsed, MIN_GIT)) {
    const min = `${String(MIN_GIT.major)}.${String(MIN_GIT.minor)}`;
    return [
      {
        check: "git",
        status: "warn",
        messageKey: "doctor.git.old",
        params: { version, min },
        fixKey: "doctor.git.fix_old"
      }
    ];
  }
  return [{ check: "git", status: "ok", messageKey: "doctor.git.ok", params: { version } }];
};
var checkClaude = ({ runtime }) => {
  const result = runtime.probe("claude", ["--version"], PROBE_TIMEOUT_MS.claude);
  if (result.timedOut) {
    return [
      { check: "claude", status: "warn", messageKey: "doctor.claude.timeout", fixKey: "doctor.claude.fix_timeout" }
    ];
  }
  if (!result.found || !result.ok) {
    return [{ check: "claude", status: "warn", messageKey: "doctor.claude.missing", fixKey: "doctor.claude.fix" }];
  }
  const version = /\d+\.\d+\.\d+/.exec(result.stdout)?.[0] ?? result.stdout;
  return [{ check: "claude", status: "ok", messageKey: "doctor.claude.ok", params: { version } }];
};

// src/doctor/run.ts
var DOCTOR_SCHEMA = "finitemonkey/doctor@1";
var CHECKS = [checkNode, checkGit, checkClaude, checkOs, checkPath];
var doctorEnvFrom = (ctx) => ({
  platform: ctx.platform,
  env: ctx.env,
  cwd: ctx.cwd,
  runtime: ctx.runtime
});
var runChecks = (env, checks = CHECKS) => checks.flatMap((check2) => check2(env));
var toItem = (ctx, finding2) => ({
  check: finding2.check,
  status: finding2.status,
  detail: ctx.t(finding2.messageKey, finding2.params),
  ...finding2.fixKey === void 0 ? {} : { fix: ctx.t(finding2.fixKey, finding2.params) }
});
var count = (items, status) => items.filter((item) => item.status === status).length;
var buildReport = (ctx, findings) => {
  const checks = findings.map((finding2) => toItem(ctx, finding2));
  return {
    schema: DOCTOR_SCHEMA,
    checks,
    summary: { ok: count(checks, "ok"), warn: count(checks, "warn"), fail: count(checks, "fail") }
  };
};

// src/exit-codes.ts
var ExitCode = {
  Ok: 0,
  CheckFailed: 1,
  Usage: 2,
  NotConfigured: 3,
  NeedsPerson: 4,
  Internal: 5
};
var EXIT_CODE_NAMES = [
  "Ok",
  "CheckFailed",
  "Usage",
  "NotConfigured",
  "NeedsPerson",
  "Internal"
];
var exitCodeDocs = {
  0: "exit.ok",
  1: "exit.check_failed",
  2: "exit.usage",
  3: "exit.not_configured",
  4: "exit.needs_person",
  5: "exit.internal"
};

// src/commands/doctor.ts
var MARK = { ok: "ok  ", warn: "warn", fail: "FAIL" };
var itemLines = (ctx, item) => [
  `[${MARK[item.status]}] ${item.check}: ${item.detail}`,
  ...item.fix !== void 0 && item.status !== "ok" ? [`       ${ctx.t("output.fix", { fix: item.fix })}`] : []
];
var doctorResult = (ctx, report2) => {
  const human2 = [
    ctx.t("doctor.title", { version: ctx.version }),
    ...report2.checks.flatMap((item) => itemLines(ctx, item)),
    ctx.t("doctor.summary", report2.summary)
  ];
  const failed4 = report2.checks.find((item) => item.status === "fail");
  if (failed4 === void 0) return { ok: true, exitCode: ExitCode.Ok, data: report2, human: human2 };
  return {
    ok: false,
    exitCode: ExitCode.CheckFailed,
    data: report2,
    human: human2,
    error: {
      code: "doctor_failed",
      message: ctx.t("error.doctor_failed", { count: report2.summary.fail }),
      fix: failed4.fix ?? "finitemonkey doctor"
    }
  };
};
var doctorCommand = {
  path: ["doctor"],
  summaryKey: "command.doctor.summary",
  usage: "finitemonkey doctor [--json]",
  status: "ready",
  run: (ctx) => Promise.resolve(doctorResult(ctx, buildReport(ctx, runChecks(doctorEnvFrom(ctx)))))
};

// src/core/args.ts
import { parseArgs } from "node:util";

// src/core/problem.ts
var usageProblem = (code, messageKey, fix, params2 = {}) => ({
  code,
  messageKey,
  params: params2,
  fix,
  exitCode: ExitCode.Usage
});
var needsPersonProblem = (messageKey, fix, params2 = {}) => ({
  code: "needs_confirmation",
  messageKey,
  params: params2,
  fix,
  exitCode: ExitCode.NeedsPerson
});
var FmError = class extends Error {
  problem;
  constructor(problem3) {
    super(problem3.code);
    this.name = "FmError";
    this.problem = problem3;
  }
};

// src/core/args.ts
var GLOBAL_OPTIONS = {
  json: { type: "boolean" },
  lang: { type: "string" },
  yes: { type: "boolean", short: "y" },
  "dry-run": { type: "boolean" },
  version: { type: "boolean", short: "v" },
  help: { type: "boolean", short: "h" }
};
var flag = (values, name) => values[name] === true;
var looseArgs = (argv) => {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: GLOBAL_OPTIONS,
    strict: false,
    allowPositionals: true
  });
  const lang = values.lang;
  return {
    positionals,
    json: flag(values, "json"),
    yes: flag(values, "yes"),
    dryRun: flag(values, "dry-run"),
    version: flag(values, "version"),
    help: flag(values, "help"),
    lang: typeof lang === "string" ? lang : void 0
  };
};
var resolveCommand = (registry, positionals) => registry.filter((spec2) => spec2.path.every((part2, index) => positionals[index] === part2)).reduce(
  (best, spec2) => best === void 0 || spec2.path.length > best.consumed ? { spec: spec2, consumed: spec2.path.length } : best,
  void 0
);
var strictArgs = (argv, spec2) => {
  const fix = `finitemonkey help ${spec2.path.join(" ")}`;
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: { ...GLOBAL_OPTIONS, ...spec2.options },
      strict: true,
      allowPositionals: true
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return reject(usageProblem("invalid_arguments", "error.invalid_arguments", fix, { detail }));
  }
  const rest = parsed.positionals.slice(spec2.path.length);
  const max = spec2.maxPositionals ?? 0;
  const extra = rest[max];
  if (extra !== void 0) {
    return reject(usageProblem("unexpected_argument", "error.unexpected_argument", fix, { argument: extra }));
  }
  return accept({ values: parsed.values, positionals: rest });
};
var stringOption = (values, name) => {
  const value = values[name];
  return typeof value === "string" ? value : void 0;
};

// src/core/result.ts
var SCHEMA_VERSION = 1;
var success = (data, human2 = []) => ({
  ok: true,
  exitCode: ExitCode.Ok,
  data,
  human: human2
});
var failureFrom = (t, problem3, human2) => ({
  ok: false,
  exitCode: problem3.exitCode,
  error: { code: problem3.code, message: t(problem3.messageKey, problem3.params), fix: problem3.fix },
  ...problem3.data === void 0 ? {} : { data: problem3.data },
  ...human2 === void 0 ? {} : { human: human2 }
});
var toEnvelope = (command, result) => ({
  schemaVersion: SCHEMA_VERSION,
  ok: result.ok,
  command,
  ...result.data === void 0 ? {} : { data: result.data },
  ...result.ok ? {} : { error: result.error },
  ...result.next === void 0 ? {} : { next: result.next }
});

// src/task/state.ts
var toCounter = (value) => {
  if (!isRecord(value)) return void 0;
  const { task, signature, consecutive, same } = value;
  return typeof task === "string" && typeof signature === "string" && typeof consecutive === "number" && typeof same === "number" ? { task, signature, consecutive, same } : void 0;
};
var textRecord = (value) => isRecord(value) ? Object.fromEntries(
  Object.entries(value).filter((entry2) => typeof entry2[1] === "string")
) : {};
var readJsonFile = (runtime, path) => {
  const text6 = runtime.readText(path);
  if (!text6.ok) return void 0;
  const parsed = parseJsonObject(text6.value);
  return parsed.ok ? parsed.value : void 0;
};
var writeJsonFile = (runtime, path, value) => runtime.writeText(path, `${JSON.stringify({ schemaVersion: 1, ...value }, null, 2)}
`);
var readState = (runtime, paths) => {
  const raw = readJsonFile(runtime, paths.state);
  const active = raw?.["active"];
  const done = raw?.["done"];
  const blocks = toCounter(raw?.["blocks"]);
  const snapshot2 = raw?.["snapshot"];
  return {
    ...typeof active === "string" ? { active } : {},
    done: Array.isArray(done) ? done.filter((item) => typeof item === "string") : [],
    ...blocks === void 0 ? {} : { blocks },
    ...isRecord(snapshot2) ? { snapshot: snapshot2 } : {}
  };
};
var writeState = (runtime, paths, state) => writeJsonFile(runtime, paths.state, { ...state });
var readTrust = (runtime, paths) => {
  const raw = readJsonFile(runtime, paths.trust);
  return {
    contracts: textRecord(raw?.["contracts"]),
    approved: textRecord(raw?.["approved"]),
    configs: textRecord(raw?.["configs"])
  };
};
var writeTrust = (runtime, paths, lock) => writeJsonFile(runtime, paths.trust, { contracts: lock.contracts, approved: lock.approved, configs: lock.configs });
var assemble = (parts) => ({
  ...parts.active === void 0 ? {} : { active: parts.active },
  done: parts.done,
  ...parts.blocks === void 0 ? {} : { blocks: parts.blocks },
  ...parts.snapshot === void 0 ? {} : { snapshot: parts.snapshot }
});
var partsOf = (state) => ({
  active: state.active,
  done: state.done,
  blocks: state.blocks,
  snapshot: state.snapshot
});
var withBlocks = (state, blocks) => assemble({ ...partsOf(state), blocks });
var closeTask = (state, id) => assemble({
  ...partsOf(state),
  active: state.active === id ? void 0 : state.active,
  blocks: state.active === id ? void 0 : state.blocks,
  done: [.../* @__PURE__ */ new Set([...state.done, id])]
});

// src/gate/baseline.ts
var BASELINE_FILE = "baseline.json";
var SESSION_FILE = "session.json";
var readSession = (runtime, paths) => {
  const raw = readJsonFile(runtime, paths.cache(SESSION_FILE));
  const sessionId = raw?.["sessionId"];
  const startTree = raw?.["startTree"];
  const at = raw?.["at"];
  return typeof sessionId === "string" && typeof startTree === "string" && typeof at === "number" ? { sessionId, startTree, at } : void 0;
};
var writeSession = (runtime, paths, mark) => writeJsonFile(runtime, paths.cache(SESSION_FILE), { ...mark }).ok;
var entry = (value) => {
  if (!isRecord(value)) return void 0;
  const exitCode = value["exitCode"];
  const failures = value["failures"];
  if (!(typeof exitCode === "number" || exitCode === null) || !Array.isArray(failures)) return void 0;
  return { exitCode, failures: failures.filter((item) => typeof item === "string") };
};
var readBaseline = (runtime, paths) => {
  const raw = readJsonFile(runtime, paths.cache(BASELINE_FILE));
  const treeHash2 = raw?.["treeHash"];
  const checks = raw?.["checks"];
  if (typeof treeHash2 !== "string" || !isRecord(checks)) return void 0;
  const parsed = Object.entries(checks).flatMap(([id, value]) => {
    const item = entry(value);
    return item === void 0 ? [] : [[id, item]];
  });
  return { treeHash: treeHash2, checks: Object.fromEntries(parsed) };
};
var writeBaseline = (runtime, paths, treeHash2, checks) => writeJsonFile(runtime, paths.cache(BASELINE_FILE), { treeHash: treeHash2, checks: { ...checks } }).ok;

// src/core/clock.ts
var nowMs = (runtime) => Date.parse(runtime.now());

// src/guards/shell.ts
var SEPARATORS = /* @__PURE__ */ new Set([";", "&&", "||", "|", "&", "\n", "|&"]);
var REDIRECT = /^(?:\d*|&)(>>?|<)$/;
var ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;
var SHELLS = /* @__PURE__ */ new Set(["sh", "bash", "zsh", "dash", "ksh"]);
var WRAPPERS = /* @__PURE__ */ new Set(["sudo", "nohup", "time", "command", "exec", "nice", "timeout", "xargs"]);
var operatorAt = (text6, index) => {
  const two = text6.slice(index, index + 2);
  if (two === "&&" || two === "||" || two === ">>" || two === "|&") return two;
  const one = text6[index] ?? "";
  return ";|&\n><".includes(one) ? one : void 0;
};
var readQuoted = (text6, start) => {
  const quote = text6[start];
  let value = "";
  let index = start + 1;
  for (; index < text6.length && text6[index] !== quote; index += 1) {
    if (quote === '"' && text6[index] === "\\" && index + 1 < text6.length) index += 1;
    value += text6[index] ?? "";
  }
  return { value, end: index };
};
var tokenize = (text6) => {
  const tokens = [];
  let word2;
  const flush2 = () => {
    if (word2 !== void 0) tokens.push(word2);
    word2 = void 0;
  };
  for (let index = 0; index < text6.length; index += 1) {
    const char = text6[index] ?? "";
    if (char === "'" || char === '"') {
      const quoted = readQuoted(text6, index);
      word2 = (word2 ?? "") + quoted.value;
      index = quoted.end;
    } else if (char === "\\" && index + 1 < text6.length) {
      word2 = (word2 ?? "") + (text6[index + 1] ?? "");
      index += 1;
    } else if (char === " " || char === "	") flush2();
    else {
      const operator = operatorAt(text6, index);
      if (operator === void 0) word2 = (word2 ?? "") + char;
      else {
        const digits = word2 !== void 0 && /^\d+$/.test(word2) && (operator === ">" || operator === ">>");
        if (!digits) flush2();
        tokens.push(digits ? `${word2 ?? ""}${operator}` : operator);
        if (digits) word2 = void 0;
        index += operator.length - 1;
      }
    }
  }
  flush2();
  return tokens;
};
var build = (tokens) => {
  const env = {};
  const argv = [];
  const redirects = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    const assignment = ASSIGNMENT.exec(token);
    if (REDIRECT.test(token)) {
      redirects.push(tokens[index + 1] ?? "");
      index += 1;
    } else if (argv.length === 0 && assignment !== null) env[assignment[1] ?? ""] = assignment[2] ?? "";
    else argv.push(token);
  }
  return { env, argv, redirects };
};
var unwrap = (command, depth) => {
  const [head = "", ...rest] = command.argv;
  const name = head.split("/").pop() ?? head;
  if (name === "env") {
    const inner = build(rest.filter((arg) => !arg.startsWith("-")));
    return unwrap(
      { ...inner, env: { ...command.env, ...inner.env }, redirects: [...command.redirects, ...inner.redirects] },
      depth
    );
  }
  if (WRAPPERS.has(name)) {
    const skip = rest.findIndex((arg) => !arg.startsWith("-") && !/^\d+[smh]?$/.test(arg));
    return skip < 0 ? [command] : unwrap({ ...command, argv: rest.slice(skip) }, depth);
  }
  const script = rest[rest.indexOf("-c") + 1];
  if (SHELLS.has(name) && rest.includes("-c") && script !== void 0 && depth < 4) {
    return [
      command,
      ...parseShell(script, depth + 1).map((inner) => ({ ...inner, env: { ...command.env, ...inner.env } }))
    ];
  }
  return [{ ...command, argv: [name, ...rest] }];
};
var parseShell = (text6, depth = 0) => {
  const groups = [[]];
  for (const token of tokenize(text6)) {
    if (SEPARATORS.has(token)) groups.push([]);
    else groups[groups.length - 1]?.push(token);
  }
  return groups.filter((group) => group.length > 0).flatMap((group) => unwrap(build(group), depth));
};

// src/secrets/fingerprint.ts
import { createHash } from "node:crypto";
var sha256Hex = (text6) => createHash("sha256").update(text6).digest("hex");
var fingerprintOf = (secret) => sha256Hex(`finitemonkey:secret:${secret}`).slice(0, 16);
var ALNUM = /[A-Za-z0-9]/g;
var MIN_TAIL_LENGTH = 12;
var tailOf = (secret) => {
  const visible = (secret.match(ALNUM) ?? []).join("");
  return visible.length >= MIN_TAIL_LENGTH ? visible.slice(-4) : "****";
};

// src/gate/test-summary.ts
var ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
var COUNTERS = [
  { total: /^# tests (\d+)$/m, failed: /^# fail (\d+)$/m },
  { total: /^ℹ tests (\d+)$/m, failed: /^ℹ fail (\d+)$/m },
  { total: /^\s*Tests\s+(?:.*?\()?(\d+)\)?\s*$/m, failed: /^\s*Tests\s+(\d+) failed/m },
  { total: /^Tests:\s+.*?(\d+) total/m, failed: /^Tests:\s+(\d+) failed/m }
];
var FAILURE_LINES = [
  /^not ok \d+ - (.+)$/gm,
  /^\s*✖ (.+?)(?: \(\d+(?:\.\d+)?m?s\))?$/gm,
  /^[ \t]*(?:FAIL|×|✗) +(.+?)(?: +\d+m?s)?$/gm,
  /^\s*● (.+? › .+)$/gm,
  /^FAILED (\S+)/gm,
  /^--- FAIL: (\S+)/gm
];
var ZERO = [
  /\bno tests? (?:found|ran|to run)\b/i,
  /\bno test files\b/i,
  /^# tests 0$/m,
  /^ℹ tests 0$/m,
  /No tests found/
];
var pyTotal = (text6) => {
  const line2 = /^=+ (.*) in [\d.]+s.*=+$/m.exec(text6)?.[1];
  if (line2 === void 0) return void 0;
  return [...line2.matchAll(/(\d+) (passed|failed|error|errors|skipped|xfailed|xpassed)/g)].reduce(
    (sum, match) => sum + Number(match[1] ?? "0"),
    0
  );
};
var counted = (text6) => {
  for (const counter of COUNTERS) {
    const total = counter.total.exec(text6)?.[1];
    if (total === void 0) continue;
    const failed4 = counter.failed?.exec(text6)?.[1];
    return { total: Number(total), ...failed4 === void 0 ? {} : { failed: Number(failed4) } };
  }
  const py = pyTotal(text6);
  return py === void 0 ? {} : { total: py };
};
var parseTestSummary = (output) => {
  const text6 = output.replace(ANSI, "");
  const failures = [
    ...new Set(FAILURE_LINES.flatMap((pattern) => [...text6.matchAll(pattern)].map((match) => (match[1] ?? "").trim())))
  ].filter((name) => name !== "" && !/^failing tests:?$/i.test(name));
  if (ZERO.some((pattern) => pattern.test(text6))) return { total: 0, failures };
  return { ...counted(text6), failures };
};

// src/gate/types.ts
var note = (key, params2 = {}) => ({ key, params: params2 });
var unverified = (reason, notes2 = []) => ({
  status: "unverified",
  reason,
  notes: notes2
});
var passed = (notes2 = []) => ({ status: "passed", notes: notes2 });
var failed = (notes2) => ({ status: "failed", notes: notes2 });
var REUSABLE_KINDS = ["command", "tests"];

// src/gate/checks/command.ts
var DEFAULT_CHECK_TIMEOUT_S = 600;
var MIN_REMAINING_MS = 1e3;
var RATE_LIMIT = /\b429\b|rate.?limit|too many requests|quota exceeded|usage limit/i;
var REWRITERS = /^\s*(rtk)\b/;
var TRIVIAL = /* @__PURE__ */ new Set(["echo", "true", ":", "printf", "exit", "sleep", "cat", "yes", "pwd", "ls", "date", "env"]);
var TAIL = 160;
var MAX_FAILURES = 5;
var tail = (text6) => {
  const lines3 = text6.split(/\r?\n/).filter((line2) => line2.trim() !== "");
  const last = lines3[lines3.length - 1]?.trim() ?? "";
  return last.length > TAIL ? `${last.slice(0, TAIL)}…` : last;
};
var isTrivialCommand = (run3) => {
  const commands = parseShell(run3);
  return commands.length === 0 || commands.every((command) => TRIVIAL.has(command.argv[0] ?? ""));
};
var failedRun = (check2, ctx, result) => {
  const output = `${result.stdout}
${result.stderr}`;
  const summary = parseTestSummary(output);
  const known2 = new Set(ctx.baseline?.[check2.id]?.failures ?? []);
  const fresh3 = summary.failures.filter((name) => !known2.has(name));
  const old = summary.failures.length - fresh3.length;
  const baselineNote = old > 0 ? [note("gate.note.baseline", { count: old })] : [];
  if (summary.failures.length > 0 && fresh3.length === 0) {
    return { status: "passed", notes: baselineNote, failures: summary.failures };
  }
  const last = ctx.mask(tail(output));
  return {
    status: "failed",
    failures: summary.failures,
    notes: [
      note("gate.note.exit", { code: result.exitCode ?? -1 }),
      ...fresh3.slice(0, MAX_FAILURES).map((name) => note("gate.note.new_failure", { name: ctx.mask(name) })),
      ...fresh3.length === 0 && last !== "" ? [note("gate.note.output", { line: last })] : [],
      ...baselineNote
    ]
  };
};
var classify = (check2, ctx, result, timeoutMs) => {
  const run3 = check2.run ?? "";
  if (!result.found) return unverified("tool_missing", [note("gate.note.tool_missing", { command: run3 })]);
  if (result.timedOut)
    return unverified("timeout", [note("gate.note.timeout", { seconds: Math.round(timeoutMs / 1e3) })]);
  if (result.exitCode !== 0 && RATE_LIMIT.test(`${result.stdout}
${result.stderr}`)) {
    return unverified("rate_limited", [note("gate.note.rate_limited")]);
  }
  if (result.exitCode !== 0) return failedRun(check2, ctx, result);
  const summary = parseTestSummary(`${result.stdout}
${result.stderr}`);
  if (summary.total === 0) return failed([note("gate.note.zero_tests", { command: run3 })]);
  return {
    status: "passed",
    notes: [
      note("gate.note.exit", { code: 0 }),
      ...summary.total === void 0 ? [] : [note("gate.note.tests_ran", { count: summary.total })]
    ],
    ...summary.total === void 0 ? {} : { testCount: summary.total }
  };
};
var runShellCheck = (check2, run3, ctx) => {
  if (isTrivialCommand(run3)) return { ...failed([note("gate.note.trivial", { command: run3 })]), command: run3 };
  if (!ctx.trusted)
    return { ...unverified("untrusted", [note("gate.note.untrusted", { task: ctx.contract.id })]), command: run3 };
  if (REWRITERS.test(run3)) return { ...unverified("rewriter", [note("gate.note.rewriter")]), command: run3 };
  const remaining = ctx.deadline - nowMs(ctx.runtime);
  if (remaining < MIN_REMAINING_MS) return { ...unverified("budget", [note("gate.note.budget")]), command: run3 };
  const timeoutMs = Math.min(remaining, (check2.timeoutS ?? DEFAULT_CHECK_TIMEOUT_S) * 1e3);
  const result = ctx.runtime.exec({
    command: run3,
    args: [],
    cwd: ctx.paths.root,
    timeoutMs,
    shell: true,
    env: { CI: "1" },
    unset: ["NODE_TEST_CONTEXT"]
  });
  return {
    command: run3,
    exitCode: result.exitCode,
    stdoutSha256: sha256Hex(result.stdout),
    durationMs: result.durationMs,
    ...classify({ ...check2, run: run3 }, ctx, result, timeoutMs)
  };
};
var commandCheck = (check2, ctx) => check2.run === void 0 ? unverified("not_implemented") : runShellCheck(check2, check2.run, ctx);

// src/task/paths.ts
import { join as join2 } from "node:path";
var FM_DIR = ".finitemonkey";
var fmPaths = (root) => {
  const dir = toAbsolutePath(join2(root, FM_DIR));
  const at = (...parts) => toAbsolutePath(join2(dir, ...parts));
  return {
    root,
    dir,
    state: at("state.json"),
    trust: at("trust.json"),
    log: at("log.jsonl"),
    grants: at("allow", "grants.json"),
    task: (id) => at("tasks", `${id}.yml`),
    evidence: (id) => at("evidence", `${id}.jsonl`),
    cache: (name) => at("cache", name)
  };
};

// src/gate/git.ts
var EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
var GIT_TIMEOUT_MS = 15e3;
var EXCLUDE_FM = `:(exclude)${FM_DIR}`;
var gitAt = (runtime, cwd) => {
  const run3 = (args) => runtime.exec({ command: "git", args: ["-c", "core.quotepath=off", ...args], cwd, timeoutMs: GIT_TIMEOUT_MS });
  return {
    cwd,
    run: run3,
    out: (args) => {
      const result = run3(args);
      return result.found && result.exitCode === 0 ? result.stdout : void 0;
    }
  };
};
var gitRoot = (git) => {
  const top = git.out(["rev-parse", "--show-toplevel"])?.trim();
  return top === void 0 || top === "" ? void 0 : toAbsolutePath(top);
};
var nonEmpty = (value) => value === "" ? void 0 : value;
var headSha = (git) => git.out(["rev-parse", "--verify", "-q", "HEAD"])?.trim();
var currentBranch = (git) => {
  const name = git.out(["rev-parse", "--abbrev-ref", "HEAD"])?.trim();
  return name === void 0 || name === "HEAD" || name === "" ? void 0 : name;
};
var defaultRemoteBranch = (git) => nonEmpty(git.out(["rev-parse", "--abbrev-ref", "origin/HEAD"])?.trim());
var resolveBase = (git, declared) => {
  if (declared !== void 0 && git.out(["rev-parse", "--verify", "-q", `${declared}^{commit}`]) !== void 0) {
    return declared;
  }
  const remote = defaultRemoteBranch(git);
  const merged = remote === void 0 ? void 0 : git.out(["merge-base", "HEAD", remote])?.trim();
  return nonEmpty(merged) ?? nonEmpty(headSha(git)) ?? EMPTY_TREE;
};
var nulFields = (text6) => text6.split("\0").filter((part2) => part2 !== "");
var untracked = (git) => nulFields(git.out(["ls-files", "--others", "--exclude-standard", "-z", "--", ".", EXCLUDE_FM]) ?? "");
var parseNameStatus = (text6) => {
  const fields = nulFields(text6);
  const changes = [];
  for (let index = 0; index < fields.length; index += 1) {
    const code = fields[index] ?? "";
    const letter = code.slice(0, 1);
    if (letter === "R" || letter === "C") {
      const oldPath = fields[index + 1] ?? "";
      const path2 = fields[index + 2] ?? "";
      changes.push(letter === "R" ? { status: "R", path: path2, oldPath } : { status: "A", path: path2 });
      index += 2;
      continue;
    }
    const path = fields[index + 1] ?? "";
    changes.push({ status: letter === "D" ? "D" : letter === "A" ? "A" : "M", path });
    index += 1;
  }
  return changes;
};
var changedFiles = (git, base) => {
  const tracked = parseNameStatus(
    git.out(["diff", "--name-status", "-M", "-z", "--no-color", base, "--", ".", EXCLUDE_FM]) ?? ""
  );
  const known2 = new Set(tracked.map((change) => change.path));
  const fresh3 = untracked(git).filter((path) => !known2.has(path)).map((path) => ({ status: "A", path }));
  return [...tracked, ...fresh3];
};
var fileAt = (git, rev, path) => rev === EMPTY_TREE ? void 0 : git.out(["show", `${rev}:${path}`]);
var treeHash = (git) => {
  const head = headSha(git) ?? EMPTY_TREE;
  const diff = git.run(["diff", "HEAD", "--binary", "--no-ext-diff", "--no-color", "--", ".", EXCLUDE_FM]);
  if (!diff.found || diff.exitCode !== 0 && head !== EMPTY_TREE) return void 0;
  const files = untracked(git);
  const hashes = files.length === 0 ? "" : git.out(["hash-object", "--", ...files]) ?? "";
  const digest = sha256Hex([head, diff.stdout, files.join("\0"), hashes].join("\n--fm--\n"));
  return `w${digest.slice(0, 16)}`;
};
var HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
var parseAddedLines = (diff) => {
  const added = [];
  let path = "";
  let line2 = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ ")) path = raw.slice(4).replace(/^b\//, "");
    else if (raw.startsWith("@@")) line2 = Number(HUNK.exec(raw)?.[1] ?? "0");
    else if (raw.startsWith("+")) {
      added.push({ path, line: line2, text: raw.slice(1) });
      line2 += 1;
    } else if (!raw.startsWith("-") && !raw.startsWith("\\")) line2 += 1;
  }
  return added;
};
var addedLines = (git, base) => parseAddedLines(git.out(["diff", "-U0", "--no-color", "--no-ext-diff", base, "--", ".", EXCLUDE_FM]) ?? "");
var numstat = (git, base) => {
  const rows = (git.out(["diff", "--numstat", "--no-color", base, "--", ".", EXCLUDE_FM]) ?? "").split("\n").filter((row) => row.trim() !== "");
  const lines3 = rows.reduce((sum, row) => {
    const [plus = "0", minus = "0"] = row.split("	");
    return sum + (Number(plus) || 0) + (Number(minus) || 0);
  }, 0);
  return { files: rows.length, lines: lines3 };
};
var dirtyPaths = (git) => nulFields(git.out(["status", "--porcelain", "-z", "--", ".", EXCLUDE_FM]) ?? "").map((entry2) => entry2.slice(3));
var aheadOfUpstream = (git) => {
  const count3 = git.out(["rev-list", "--count", "@{u}..HEAD"])?.trim();
  return count3 === void 0 ? void 0 : Number(count3);
};

// src/gate/prepare.ts
import { join as join3 } from "node:path";

// src/core/posix-path.ts
var toPosixPath = (path) => path.replace(/\\/g, "/");
var withoutCarriageReturn = (line2) => line2.endsWith("\r") ? line2.slice(0, -1) : line2;

// src/secrets/allowlist.ts
var PLACEHOLDER_WORDS = [
  "example",
  "placeholder",
  "your_",
  "your-",
  "yourkey",
  "yourtoken",
  "yoursecret",
  "_here",
  "-here",
  "changeme",
  "change_me",
  "change-me",
  "replace",
  "redacted",
  "dummy",
  "fake",
  "sample",
  "mock",
  "fixture",
  "test",
  "todo",
  "xxxx",
  "****",
  "....",
  "…",
  "<",
  ">",
  "${",
  "{{",
  "%s",
  "process.env",
  "secrets.",
  "env("
];
var PLACEHOLDER_VALUES = /* @__PURE__ */ new Set([
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "api_key",
  "admin",
  "root",
  "postgres",
  "changeit",
  "user",
  "pass"
]);
var ENV_REFERENCE = /^\$\{?[A-Z_][A-Z0-9_]*\}?$/;
var LOCKFILES = /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|go\.sum|Cargo\.lock|poetry\.lock|uv\.lock|composer\.lock|Gemfile\.lock)$/;
var TEST_PATH = /(?:^|\/)(?:test|tests|__tests__|__fixtures__|fixtures|spec|testdata|examples?)\/|\.(?:test|spec)\.[A-Za-z0-9]+$/;
var isPlaceholder = (value) => {
  const lower = value.toLowerCase();
  if (PLACEHOLDER_VALUES.has(lower) || ENV_REFERENCE.test(value)) return true;
  if (PLACEHOLDER_WORDS.some((word2) => lower.includes(word2))) return true;
  return new Set(lower).size < 4;
};
var isTestOrLockPath = (path) => path !== void 0 && (LOCKFILES.test(toPosixPath(path)) || TEST_PATH.test(toPosixPath(path)));

// src/secrets/entropy.ts
var shannonEntropy = (text6) => {
  if (text6.length === 0) return 0;
  const counts = /* @__PURE__ */ new Map();
  for (const char of text6) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count3 of counts.values()) {
    const p = count3 / text6.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
};

// src/secrets/lines.ts
var lineLocator = (text6) => {
  const starts = [0];
  for (let index = text6.indexOf("\n"); index !== -1; index = text6.indexOf("\n", index + 1)) starts.push(index + 1);
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = low + high + 1 >> 1;
      if ((starts[mid] ?? 0) <= offset) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: offset - (starts[low] ?? 0) + 1 };
  };
};

// src/secrets/rules/types.ts
var defineRule = (spec2) => ({
  id: spec2.id,
  summary: spec2.summary,
  kind: spec2.kind ?? "credential",
  severity: spec2.severity ?? "high",
  keywords: spec2.keywords.map((keyword) => keyword.toLowerCase()),
  pattern: new RegExp(spec2.source, `gd${spec2.flags ?? ""}`),
  minLength: spec2.minLength ?? 8,
  minEntropy: spec2.minEntropy ?? 0,
  requireDigit: spec2.requireDigit ?? false,
  minRandomRun: spec2.minRandomRun ?? 0,
  ignoredNames: (spec2.ignoredNames ?? []).map((name) => name.toLowerCase()),
  skipTestPaths: spec2.skipTestPaths ?? false,
  placeholders: spec2.placeholders ?? true
});

// src/secrets/rules/providers.ts
var PROVIDER_RULES = [
  defineRule({
    id: "aws-access-token",
    summary: "AWS access key id (AKIA, ASIA, ABIA, ACCA, A3T)",
    keywords: ["akia", "asia", "abia", "acca", "a3t"],
    source: String.raw`\b(?<secret>(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16})\b`,
    minLength: 20,
    minEntropy: 3
  }),
  defineRule({
    id: "aws-secret-access-key",
    summary: "AWS secret access key assigned to aws_secret_access_key or a similar name",
    keywords: ["secret"],
    source: String.raw`(?:aws_?)?secret_?access_?key["'\x60]?[ \t]*(?:=|:=|:|=>)[ \t]*["'\x60]?(?<secret>[A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])`,
    flags: "i",
    minLength: 40,
    minEntropy: 4
  }),
  defineRule({
    id: "github-pat",
    summary: "GitHub classic personal access token (ghp_)",
    keywords: ["ghp_"],
    source: String.raw`\b(?<secret>ghp_[A-Za-z0-9]{36})(?![A-Za-z0-9])`,
    minEntropy: 3
  }),
  defineRule({
    id: "github-oauth",
    summary: "GitHub OAuth access token (gho_)",
    keywords: ["gho_"],
    source: String.raw`\b(?<secret>gho_[A-Za-z0-9]{36})(?![A-Za-z0-9])`,
    minEntropy: 3
  }),
  defineRule({
    id: "github-app-token",
    summary: "GitHub App user or installation token (ghu_, ghs_)",
    keywords: ["ghu_", "ghs_"],
    source: String.raw`\b(?<secret>(?:ghu|ghs)_[A-Za-z0-9]{36})(?![A-Za-z0-9])`,
    minEntropy: 3
  }),
  defineRule({
    id: "github-refresh-token",
    summary: "GitHub refresh token (ghr_)",
    keywords: ["ghr_"],
    source: String.raw`\b(?<secret>ghr_[A-Za-z0-9]{36})(?![A-Za-z0-9])`,
    minEntropy: 3
  }),
  defineRule({
    id: "github-fine-grained-pat",
    summary: "GitHub fine-grained personal access token (github_pat_)",
    keywords: ["github_pat_"],
    source: String.raw`\b(?<secret>github_pat_[A-Za-z0-9_]{82})(?![A-Za-z0-9_])`,
    minEntropy: 3
  }),
  defineRule({
    id: "gitlab-pat",
    summary: "GitLab personal access token (glpat-)",
    keywords: ["glpat-"],
    source: String.raw`\b(?<secret>glpat-[A-Za-z0-9_-]{20})(?![A-Za-z0-9_-])`,
    minEntropy: 3
  }),
  defineRule({
    id: "npm-access-token",
    summary: "npm access token (npm_)",
    keywords: ["npm_"],
    source: String.raw`\b(?<secret>npm_[A-Za-z0-9]{36})(?![A-Za-z0-9])`,
    flags: "i",
    minEntropy: 3
  }),
  defineRule({
    id: "slack-bot-token",
    summary: "Slack bot token (xoxb-)",
    keywords: ["xoxb-"],
    source: String.raw`\b(?<secret>xoxb-[0-9]{10,13}-[0-9]{10,13}[A-Za-z0-9-]*)`,
    minEntropy: 3
  }),
  defineRule({
    id: "slack-user-token",
    summary: "Slack user or export token (xoxp-, xoxe-)",
    keywords: ["xoxp-", "xoxe-"],
    source: String.raw`\b(?<secret>xox[pe](?:-[0-9]{10,13}){3}-[A-Za-z0-9-]{28,34})`,
    minEntropy: 3
  }),
  defineRule({
    id: "slack-app-token",
    summary: "Slack app-level token (xapp-)",
    keywords: ["xapp-"],
    source: String.raw`\b(?<secret>xapp-\d-[A-Z0-9]+-\d+-[a-z0-9]+)`,
    flags: "i",
    minEntropy: 3
  }),
  defineRule({
    id: "slack-webhook-url",
    summary: "Slack incoming webhook URL",
    keywords: ["hooks.slack.com"],
    source: String.raw`(?<secret>hooks\.slack\.com/(?:services|workflows|triggers)/[A-Za-z0-9+/]{43,56})`,
    minEntropy: 3
  }),
  defineRule({
    id: "stripe-access-token",
    summary: "Stripe live secret or restricted key (sk_live_, rk_live_)",
    keywords: ["sk_live_", "rk_live_", "sk_prod_", "rk_prod_"],
    source: String.raw`\b(?<secret>(?:sk|rk)_(?:live|prod)_[A-Za-z0-9]{20,99})(?![A-Za-z0-9])`,
    minEntropy: 3
  }),
  defineRule({
    id: "anthropic-api-key",
    summary: "Anthropic API or admin key (sk-ant-)",
    keywords: ["sk-ant-"],
    source: String.raw`\b(?<secret>sk-ant-(?:api|admin|oat)\d{2}-[A-Za-z0-9_-]{80,})`,
    minEntropy: 3.5
  }),
  defineRule({
    id: "openai-api-key",
    summary: "OpenAI API key (sk-proj-, sk-svcacct-, sk-admin- or the T3BlbkFJ marker)",
    keywords: ["t3blbkfj", "sk-proj-", "sk-svcacct-", "sk-admin-"],
    source: String.raw`\b(?<secret>sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}|sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{58,})`,
    minEntropy: 3.5
  }),
  defineRule({
    id: "gcp-api-key",
    summary: "Google API key (AIza)",
    keywords: ["aiza"],
    source: String.raw`\b(?<secret>AIza[0-9A-Za-z_-]{35})(?![0-9A-Za-z_-])`,
    minEntropy: 3
  }),
  defineRule({
    id: "asaas-api-key",
    summary: "Asaas API key ($aact_, $aact_prod_, $aact_hmlg_) with a body; the bare prefix is a placeholder",
    keywords: ["$aact_"],
    source: String.raw`(?<secret>\$aact_(?:prod_|hmlg_)?[A-Za-z0-9+/=_:$-]{32,})`,
    minLength: 40,
    minEntropy: 3.5
  })
];

// src/secrets/rules/structural.ts
var STRUCTURAL_RULES = [
  defineRule({
    id: "private-key",
    summary: "PEM private key block (RSA, EC, DSA, OPENSSH, PGP, PKCS#8)",
    keywords: ["private key"],
    source: String.raw`-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----(?<secret>[\s\S]{64,16384}?)-----END[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----`,
    minLength: 64,
    minEntropy: 4
  }),
  defineRule({
    id: "jwt",
    summary: "JSON Web Token with a header, a payload and a signature, checked for entropy",
    keywords: ["eyj"],
    source: String.raw`\b(?<secret>eyJ[A-Za-z0-9_-]{17,}\.eyJ[A-Za-z0-9_-]{17,}\.[A-Za-z0-9_-]{10,})`,
    minLength: 40,
    minEntropy: 3
  }),
  defineRule({
    id: "credential-in-url",
    summary: "Password or token inside a URL (scheme://user:secret@host), including git remotes",
    keywords: ["://"],
    source: String.raw`\b[a-z][a-z0-9+.-]{1,20}://[^\s:/@"'\x60]{1,64}:(?<secret>[^\s:/@"'\x60]{6,128})@[A-Za-z0-9.-]`,
    flags: "i",
    minLength: 6,
    minEntropy: 2.5
  }),
  defineRule({
    id: "default-secret-fallback",
    summary: "JavaScript secret variable with a constant fallback (process.env.X ?? 'constant')",
    kind: "practice",
    severity: "medium",
    keywords: ["process.env."],
    source: String.raw`process\.env\.[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD)[A-Z0-9_]*[ \t]*(?:\?\?|\|\|)[ \t]*["'\x60](?<secret>[^"'\x60\n]{4,})["'\x60]`,
    minLength: 4,
    placeholders: false,
    skipTestPaths: true
  }),
  defineRule({
    id: "default-secret-fallback-python",
    summary: "Python secret variable with a constant default (os.getenv('X', 'constant'))",
    kind: "practice",
    severity: "medium",
    keywords: ["getenv", "environ.get"],
    source: String.raw`os\.(?:getenv|environ\.get)\([ \t]*["'][A-Za-z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD)[A-Za-z0-9_]*["'][ \t]*,[ \t]*["'](?<secret>[^"'\n]{4,})["']`,
    minLength: 4,
    placeholders: false,
    skipTestPaths: true
  }),
  defineRule({
    id: "generic-api-key",
    summary: "High-entropy value assigned to a name with key, secret, token or credential",
    keywords: ["key", "secret", "token", "credential"],
    source: String.raw`(?:key|secret|token|credential)s?[A-Za-z0-9_.-]{0,30}["'\x60]?[ \t]*(?:=|:=|:|=>)[ \t]*["'\x60]?(?<secret>[A-Za-z0-9_\-+/=.~$!@#%^&*]{16,200})(?![A-Za-z0-9_\-+/=.~$!@#%^&*(])`,
    flags: "i",
    minLength: 16,
    minEntropy: 3.5,
    requireDigit: true,
    minRandomRun: 12,
    ignoredNames: [
      "key",
      "keys",
      "cachekey",
      "querykey",
      "storagekey",
      "sortkey",
      "idempotencykey",
      "keyname",
      "tokentype"
    ],
    skipTestPaths: true
  }),
  defineRule({
    id: "password-assignment",
    summary: "Literal value assigned to a password name (password, passwd, pwd, senha, contraseña)",
    keywords: ["passw", "pwd", "senha", "contrase"],
    source: String.raw`(?:password|passwd|pwd|senha|contrase[ñn]a)[A-Za-z0-9_.-]{0,20}["'\x60]?[ \t]*(?:=|:=|:|=>)[ \t]*["'\x60]?(?<secret>[^\s"'\x60,;()[\]{}<>]{8,128})`,
    flags: "i",
    minLength: 8,
    minEntropy: 3,
    requireDigit: true,
    skipTestPaths: true
  })
];

// src/secrets/rules/catalog.ts
var RULES = [...PROVIDER_RULES, ...STRUCTURAL_RULES];
var CREDENTIAL_RULES = RULES.filter((rule) => rule.kind === "credential");
var ruleById = (id) => RULES.find((rule) => rule.id === id);

// src/secrets/engine.ts
var DIGIT = /[0-9]/;
var LETTER = /[A-Za-z]/;
var RUN_ENTROPY = 3;
var hasRandomRun = (secret, length) => (secret.match(new RegExp(`[A-Za-z0-9]{${String(length)},}`, "g")) ?? []).some(
  (run3) => DIGIT.test(run3) && LETTER.test(run3) && shannonEntropy(run3) >= RUN_ENTROPY
);
var accepted = (rule, secret) => secret.length >= rule.minLength && (!rule.requireDigit || DIGIT.test(secret)) && (rule.minRandomRun === 0 || hasRandomRun(secret, rule.minRandomRun)) && (!rule.placeholders || !isPlaceholder(secret)) && (rule.minEntropy === 0 || shannonEntropy(secret) >= rule.minEntropy);
var NAME_CHAR = /[A-Za-z0-9_.-]/;
var nameAround = (text6, at) => {
  let start = at;
  while (start > 0 && NAME_CHAR.test(text6.charAt(start - 1))) start -= 1;
  let end = at;
  while (end < text6.length && NAME_CHAR.test(text6.charAt(end))) end += 1;
  return text6.slice(start, end).toLowerCase();
};
var ignoredName = (rule, match) => rule.ignoredNames.length > 0 && rule.ignoredNames.includes(nameAround(match.input, match.index));
var spanOf = (rule, match) => {
  const range = match.indices?.groups?.["secret"] ?? match.indices?.[0];
  if (range === void 0 || ignoredName(rule, match)) return void 0;
  const [start, end] = range;
  const secret = match.input.slice(start, end);
  return accepted(rule, secret) ? { rule, start, end, secret } : void 0;
};
var ruleSpans = (rule, text6) => {
  const spans = [];
  for (const match of text6.matchAll(rule.pattern)) {
    const span = spanOf(rule, match);
    if (span !== void 0) spans.push(span);
  }
  return spans;
};
var overlaps = (taken, span) => taken.some((other) => span.start < other.end && other.start < span.end);
var applicable = (rules, lower, path) => {
  const testPath = isTestOrLockPath(path);
  return rules.filter(
    (rule) => !(testPath && rule.skipTestPaths) && rule.keywords.some((keyword) => lower.includes(keyword))
  );
};
var toFinding = (span, locate2) => {
  const position = locate2(span.start);
  return {
    ruleId: span.rule.id,
    severity: span.rule.severity,
    line: position.line,
    column: position.column,
    start: span.start,
    end: span.end,
    fingerprint: fingerprintOf(span.secret),
    tail: tailOf(span.secret)
  };
};
var scanText = (text6, options = {}) => {
  if (text6.length === 0) return [];
  const rules = applicable(options.rules ?? RULES, text6.toLowerCase(), options.path);
  if (rules.length === 0) return [];
  const taken = [];
  for (const rule of rules) {
    for (const span of ruleSpans(rule, text6)) if (!overlaps(taken, span)) taken.push(span);
  }
  if (taken.length === 0) return [];
  const locate2 = lineLocator(text6);
  return taken.sort((a, b) => a.start - b.start).map((span) => toFinding(span, locate2));
};

// src/mask/mask.ts
var maskToken = (finding2) => `«secret:${finding2.ruleId}:${finding2.tail}»`;
var maskText = (text6) => {
  const findings = scanText(text6, { rules: CREDENTIAL_RULES });
  if (findings.length === 0) return text6;
  let out = "";
  let cursor = 0;
  for (const finding2 of findings) {
    out += text6.slice(cursor, finding2.start) + maskToken(finding2);
    cursor = finding2.end;
  }
  return out + text6.slice(cursor);
};
var maskDeep = (value) => {
  if (typeof value === "string") return maskText(value);
  if (Array.isArray(value)) return value.map(maskDeep);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [maskText(key), maskDeep(inner)]));
  }
  return value;
};

// src/core/yaml/scalar.ts
var ESCAPES = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "	",
  "0": "\0"
};
var HEX4 = /^[0-9a-fA-F]{4}$/;
var unescapeDouble = (body) => {
  let out = "";
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index] ?? "";
    if (char !== "\\") {
      out += char;
      continue;
    }
    const next2 = body[index + 1] ?? "";
    if (next2 === "u") {
      const hex = body.slice(index + 2, index + 6);
      if (!HEX4.test(hex)) return reject(`bad \\u escape`);
      out += String.fromCharCode(Number.parseInt(hex, 16));
      index += 5;
      continue;
    }
    const mapped = ESCAPES[next2];
    if (mapped === void 0) return reject(`unknown escape \\${next2}`);
    out += mapped;
    index += 1;
  }
  return accept(out);
};
var quotedEnd = (text6, start) => {
  const quote = text6[start];
  for (let index = start + 1; index < text6.length; index += 1) {
    const char = text6[index];
    if (quote === '"' && char === "\\") {
      index += 1;
      continue;
    }
    if (char !== quote) continue;
    if (quote === "'" && text6[index + 1] === "'") {
      index += 1;
      continue;
    }
    return index;
  }
  return -1;
};
var parseQuoted = (text6) => {
  const end = quotedEnd(text6, 0);
  if (end !== text6.length - 1) return reject(`unterminated or trailing text after quoted string`);
  const body = text6.slice(1, -1);
  return text6.startsWith('"') ? unescapeDouble(body) : accept(body.replace(/''/g, "'"));
};
var NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][-+]?\d+)?$/;
var UNSUPPORTED = /^[&*!|>%@`]/;
var parsePlain = (text6) => {
  if (UNSUPPORTED.test(text6)) return reject(`unsupported YAML syntax "${text6.slice(0, 1)}"`);
  if (text6 === "true" || text6 === "false") return accept(text6 === "true");
  if (text6 === "null" || text6 === "~") return accept(null);
  if (NUMBER.test(text6)) return accept(Number(text6));
  return accept(text6);
};

// src/core/yaml/flow.ts
var OPEN = { "[": "]", "{": "}" };
var splitTop = (body) => {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index] ?? "";
    if (char === '"' || char === "'") {
      const end = quotedEnd(body, index);
      if (end < 0) return reject("unterminated quoted string");
      index = end;
    } else if (char in OPEN) depth += 1;
    else if (char === "]" || char === "}") depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(body.slice(start, index));
      start = index + 1;
    }
  }
  if (depth !== 0) return reject("unbalanced brackets");
  const last = body.slice(start);
  if (last.trim() !== "" || parts.length > 0) parts.push(last);
  return accept(parts.map((part2) => part2.trim()));
};
var splitKey = (text6) => {
  let index = 0;
  if (text6.startsWith('"') || text6.startsWith("'")) {
    index = quotedEnd(text6, 0) + 1;
    if (index <= 0) return void 0;
  }
  for (; index < text6.length; index += 1) {
    const char = text6[index];
    if (char === "#" && text6[index - 1] === " ") return void 0;
    if (char === ":" && (index + 1 === text6.length || text6[index + 1] === " ")) {
      return { key: text6.slice(0, index).trim(), rest: text6.slice(index + 1).trim() };
    }
  }
  return void 0;
};
var keyText = (raw) => raw.startsWith('"') || raw.startsWith("'") ? parseQuoted(raw) : accept(raw);
var flowMap = (parts) => {
  const out = {};
  for (const part2 of parts) {
    const pair = splitKey(part2);
    if (pair === void 0) return reject(`expected "key: value" in flow mapping, got "${part2}"`);
    const key = keyText(pair.key);
    if (!key.ok) return key;
    if (key.value in out) return reject(`duplicate key "${key.value}"`);
    const value = parseValue(pair.rest);
    if (!value.ok) return value;
    out[key.value] = value.value;
  }
  return accept(out);
};
var flowSeq = (parts) => {
  const out = [];
  for (const part2 of parts) {
    const value = parseValue(part2);
    if (!value.ok) return value;
    out.push(value.value);
  }
  return accept(out);
};
var parseValue = (text6) => {
  if (text6 === "") return accept(null);
  const first = text6[0] ?? "";
  if (first === '"' || first === "'") return parseQuoted(text6);
  const close2 = OPEN[first];
  if (close2 === void 0) return parsePlain(text6);
  if (!text6.endsWith(close2)) return reject(`flow collection must end on the same line with "${close2}"`);
  const parts = splitTop(text6.slice(1, -1));
  if (!parts.ok) return parts;
  return first === "[" ? flowSeq(parts.value) : flowMap(parts.value);
};

// src/core/yaml/parse.ts
var BOM = new RegExp(`^${String.fromCharCode(65279)}`);
var stripComment = (text6) => {
  for (let index = 0; index < text6.length; index += 1) {
    const char = text6[index];
    if (char === '"' || char === "'") {
      const end = quotedEnd(text6, index);
      if (end < 0) return text6;
      index = end;
    } else if (char === "#" && (index === 0 || text6[index - 1] === " ")) return text6.slice(0, index);
  }
  return text6;
};
var toLines = (source) => {
  const lines3 = [];
  const raw = source.replace(BOM, "").split(/\r?\n/);
  for (const [index, full] of raw.entries()) {
    const text6 = stripComment(full).trimEnd();
    const body = text6.trimStart();
    if (body === "" || body === "---" && lines3.length === 0) continue;
    const indentText = text6.slice(0, text6.length - body.length);
    if (indentText.includes("	")) return reject({ line: index + 1, message: "tabs are not allowed for indentation" });
    if (body === "---" || body === "...")
      return reject({ line: index + 1, message: "only one YAML document is allowed" });
    lines3.push({ number: index + 1, indent: indentText.length, text: body });
  }
  return accept(lines3);
};
var fail = (line2, message) => reject({ line: line2?.number ?? 0, message });
var scalar = (line2, text6) => {
  const value = parseValue(text6);
  return value.ok ? value : fail(line2, value.error);
};
var isItem = (text6) => text6 === "-" || text6.startsWith("- ");
var child = (lines3, index, parent, sameIndentSeq) => {
  const next2 = lines3[index];
  if (next2 !== void 0 && next2.indent > parent.indent) return block(lines3, index, next2.indent);
  if (sameIndentSeq && next2?.indent === parent.indent && isItem(next2.text)) return block(lines3, index, next2.indent);
  return accept({ value: null, next: index });
};
var sequence = (lines3, start, indent) => {
  const out = [];
  let index = start;
  for (let line2 = lines3[index]; line2?.indent === indent && isItem(line2.text); line2 = lines3[index]) {
    const rest = line2.text.slice(1).trimStart();
    if (rest === "") {
      const nested = child(lines3, index + 1, line2, false);
      if (!nested.ok) return nested;
      out.push(nested.value.value);
      index = nested.value.next;
      continue;
    }
    if (rest.startsWith("- ") || splitKey(rest) !== void 0) {
      lines3[index] = { number: line2.number, indent: indent + (line2.text.length - rest.length), text: rest };
      const nested = block(lines3, index, lines3[index]?.indent ?? indent);
      if (!nested.ok) return nested;
      out.push(nested.value.value);
      index = nested.value.next;
      continue;
    }
    const value = scalar(line2, rest);
    if (!value.ok) return value;
    out.push(value.value);
    index += 1;
  }
  return accept({ value: out, next: index });
};
var mapping = (lines3, start, indent) => {
  const out = {};
  let index = start;
  for (let line2 = lines3[index]; line2?.indent === indent && !isItem(line2.text); line2 = lines3[index]) {
    const pair = splitKey(line2.text);
    if (pair === void 0) return fail(line2, `expected "key: value", got "${line2.text}"`);
    const key = pair.key.startsWith('"') || pair.key.startsWith("'") ? parseQuoted(pair.key) : accept(pair.key);
    if (!key.ok) return fail(line2, key.error);
    if (key.value in out) return fail(line2, `duplicate key "${key.value}"`);
    if (pair.rest !== "") {
      const value = scalar(line2, pair.rest);
      if (!value.ok) return value;
      out[key.value] = value.value;
      index += 1;
      continue;
    }
    const nested = child(lines3, index + 1, line2, true);
    if (!nested.ok) return nested;
    out[key.value] = nested.value.value;
    index = nested.value.next;
  }
  return accept({ value: out, next: index });
};
var block = (lines3, start, indent) => {
  const line2 = lines3[start];
  if (line2 === void 0) return accept({ value: null, next: start });
  return isItem(line2.text) ? sequence(lines3, start, indent) : mapping(lines3, start, indent);
};
var parseYaml = (source) => {
  const parsed = toLines(source);
  if (!parsed.ok) return parsed;
  const lines3 = [...parsed.value];
  const first = lines3[0];
  if (first === void 0) return accept(null);
  if (lines3.length === 1 && splitKey(first.text) === void 0 && !isItem(first.text)) return scalar(first, first.text);
  const result = block(lines3, 0, first.indent);
  if (!result.ok) return result;
  const leftover = lines3[result.value.next];
  if (leftover !== void 0) return fail(leftover, `unexpected indentation or text "${leftover.text}"`);
  return accept(result.value.value);
};

// src/task/implicit.ts
var IMPLICIT_ID = "implicit";
var LOCKFILES2 = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"]
];
var packageManager = (files) => LOCKFILES2.find(([file]) => files.exists(file))?.[1] ?? "npm";
var scriptChecks = (files) => {
  const text6 = files.read("package.json");
  if (text6 === void 0) return [];
  const parsed = parseJsonObject(text6);
  const scripts = parsed.ok ? parsed.value["scripts"] : void 0;
  if (!isRecord(scripts)) return [];
  const pm = packageManager(files);
  const has = (name) => typeof scripts[name] === "string";
  const typecheck = ["typecheck", "type-check", "tsc"].find(has);
  const checks = [];
  if (typecheck !== void 0) checks.push({ id: "typecheck", kind: "command", run: `${pm} run ${typecheck}` });
  if (has("lint")) checks.push({ id: "lint", kind: "command", run: `${pm} run lint` });
  const test = scripts["test"];
  if (typeof test === "string" && !test.includes("no test specified"))
    checks.push({ id: "test", kind: "tests", run: `${pm} run test` });
  if (checks.length === 0 && has("check")) checks.push({ id: "check", kind: "command", run: `${pm} run check` });
  return checks;
};
var OTHER_STACKS = [
  ["Cargo.toml", "cargo test"],
  ["go.mod", "go test ./..."],
  ["pytest.ini", "python -m pytest -q"],
  ["pyproject.toml", "python -m pytest -q"]
];
var detectChecks = (files) => {
  const scripts = scriptChecks(files);
  if (scripts.length > 0) return scripts;
  const found = OTHER_STACKS.find(([file]) => files.exists(file));
  return found === void 0 ? [] : [{ id: "test", kind: "tests", run: found[1] }];
};
var implicitContract = (files) => {
  const commands = detectChecks(files);
  const hasTests = commands.some((check2) => check2.kind === "tests");
  return {
    id: IMPLICIT_ID,
    goal: "",
    size: "S",
    scope: { paths: [], testsProtected: true },
    acceptance: [
      ...commands,
      ...hasTests ? [] : [{ id: "tests", kind: "tests" }],
      { id: "placeholders", kind: "placeholders" },
      { id: "secrets", kind: "secrets" },
      { id: "worktree", kind: "worktree" },
      { id: "merge", kind: "merge" },
      { id: "pr", kind: "pr", requireOpen: false }
    ],
    decisionsNeeded: [],
    implicit: true
  };
};

// src/task/types.ts
var CHECK_KINDS = [
  "command",
  "tests",
  "diff",
  "placeholders",
  "git",
  "pr",
  "manual",
  "look",
  "runtime",
  "callers",
  "secrets",
  "worktree",
  "merge",
  "prod"
];
var GIT_REQUIREMENTS = ["committed", "pushed", "pr_open"];
var SIZES = ["S", "M", "L"];
var TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
var TASK_SCHEMA = "finitemonkey/task@1";

// src/task/validate.ts
var str = (record2, key, at, issues, required) => {
  const value = record2[key];
  if (value === void 0 || value === null) {
    if (required) issues.push(`${at}${key}: required`);
    return void 0;
  }
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(`${at}${key}: must be non-empty text`);
    return void 0;
  }
  return value;
};
var positive = (record2, key, at, issues) => {
  const value = record2[key];
  if (value === void 0 || value === null) return void 0;
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  issues.push(`${at}${key}: must be a positive integer`);
  return void 0;
};
var strings = (value, at, issues) => {
  if (value === void 0 || value === null) return [];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  issues.push(`${at}: must be a list of text`);
  return [];
};
var oneOf = (options, value) => options.find((option) => option === value);
var gitRequire = (value, at, issues) => {
  const items = strings(value, at, issues);
  const known2 = items.map((item) => oneOf(GIT_REQUIREMENTS, item));
  if (known2.some((item) => item === void 0)) issues.push(`${at}: use ${GIT_REQUIREMENTS.join(", ")}`);
  return known2.filter((item) => item !== void 0);
};
var checkFields = (record2, kind, at, issues) => {
  const run3 = str(record2, "run", at, issues, kind === "command");
  const timeoutS = positive(record2, "timeout_s", at, issues);
  const description = str(record2, "description", at, issues, kind === "manual");
  const require2 = kind === "git" ? gitRequire(record2["require"] ?? ["committed"], `${at}require`, issues) : void 0;
  const open = record2["require_open"];
  if (open !== void 0 && typeof open !== "boolean") issues.push(`${at}require_open: must be true or false`);
  return {
    ...run3 === void 0 ? {} : { run: run3 },
    ...timeoutS === void 0 ? {} : { timeoutS },
    ...description === void 0 ? {} : { description },
    ...require2 === void 0 ? {} : { require: require2 },
    ...typeof open === "boolean" ? { requireOpen: open } : {}
  };
};
var acceptanceItem = (value, index, issues) => {
  const at = `acceptance[${String(index)}].`;
  if (!isRecord(value)) {
    issues.push(`${at.slice(0, -1)}: must be a mapping`);
    return void 0;
  }
  const id = str(value, "id", at, issues, true);
  const kind = oneOf(CHECK_KINDS, value["check"]);
  if (kind === void 0) issues.push(`${at}check: use one of ${CHECK_KINDS.join(", ")}`);
  if (id === void 0 || kind === void 0) return void 0;
  return { id, kind, ...checkFields(value, kind, at, issues) };
};
var acceptance = (value, issues) => {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push("acceptance: must list at least one check");
    return [];
  }
  const items = value.map((item, index) => acceptanceItem(item, index, issues));
  const checks = items.filter((item) => item !== void 0);
  const ids2 = checks.map((check2) => check2.id);
  const duplicate = ids2.find((id, index) => ids2.indexOf(id) !== index);
  if (duplicate !== void 0) issues.push(`acceptance: duplicate id "${duplicate}"`);
  return checks;
};
var scope = (value, issues) => {
  if (value === void 0 || value === null) return { paths: [], testsProtected: true };
  if (!isRecord(value)) {
    issues.push("scope: must be a mapping");
    return { paths: [], testsProtected: true };
  }
  const budget = value["diff_budget"];
  const diffBudget = isRecord(budget) ? (({ files, lines: lines3 }) => ({
    ...files === void 0 ? {} : { files },
    ...lines3 === void 0 ? {} : { lines: lines3 }
  }))({
    files: positive(budget, "files", "scope.diff_budget.", issues),
    lines: positive(budget, "lines", "scope.diff_budget.", issues)
  }) : void 0;
  if (budget !== void 0 && budget !== null && !isRecord(budget)) issues.push("scope.diff_budget: must be a mapping");
  const protectedValue = value["tests_protected"];
  if (protectedValue !== void 0 && typeof protectedValue !== "boolean") {
    issues.push("scope.tests_protected: must be true or false");
  }
  return {
    paths: strings(value["paths"], "scope.paths", issues),
    ...diffBudget === void 0 ? {} : { diffBudget },
    testsProtected: protectedValue !== false
  };
};
var validateContract = (value, implicit = false) => {
  if (!isRecord(value)) return reject(["the contract must be a YAML mapping"]);
  const issues = [];
  const id = str(value, "id", "", issues, true);
  if (id !== void 0 && !TASK_ID.test(id)) issues.push("id: use letters, digits, dot, dash or underscore (max 64)");
  const goal = str(value, "goal", "", issues, true);
  const size = value["size"] === void 0 ? "S" : oneOf(SIZES, value["size"]);
  if (size === void 0) issues.push(`size: use ${SIZES.join(", ")}`);
  const base = str(value, "base", "", issues, false);
  const contractScope = scope(value["scope"], issues);
  const checks = acceptance(value["acceptance"], issues);
  const decisionsNeeded = strings(value["decisions_needed"], "decisions_needed", issues);
  if (issues.length > 0 || id === void 0 || goal === void 0 || size === void 0) return reject(issues);
  return accept({
    id,
    goal,
    size,
    ...base === void 0 ? {} : { base },
    scope: contractScope,
    acceptance: checks,
    decisionsNeeded,
    implicit
  });
};

// src/task/load.ts
var contractHash = (contract) => sha256Hex(JSON.stringify(contract.acceptance.map((check2) => [check2.id, check2.kind, check2.run ?? ""])));
var taskRelative = (id) => `.finitemonkey/tasks/${id}.yml`;
var parseContract = (id, text6) => {
  const yaml = parseYaml(text6);
  if (!yaml.ok)
    return reject({ kind: "invalid", id, issues: [`line ${String(yaml.error.line)}: ${yaml.error.message}`] });
  const valid = validateContract(yaml.value);
  if (!valid.ok) return reject({ kind: "invalid", id, issues: valid.error });
  if (valid.value.id !== id) return reject({ kind: "invalid", id, issues: [`id: must match the file name (${id})`] });
  return accept(valid.value);
};
var pick = (lock, sources, id) => {
  const approved = lock.approved[id];
  if (approved !== void 0) return { text: approved, source: "lock" };
  const base = sources.base(taskRelative(id));
  if (base !== void 0) return { text: base, source: "base" };
  const disk = sources.disk(taskRelative(id));
  return disk === void 0 ? void 0 : { text: disk, source: "disk" };
};
var loadTask = (files, paths, sources, id) => {
  if (!TASK_ID.test(id)) return reject({ kind: "not_found", id });
  const lock = readTrust(files, paths);
  const chosen = pick(lock, sources, id);
  if (chosen === void 0) return reject({ kind: "not_found", id });
  const parsed = parseContract(id, chosen.text);
  if (!parsed.ok) return parsed;
  const hash = contractHash(parsed.value);
  const disk = sources.disk(taskRelative(id));
  return accept({
    contract: parsed.value,
    hash,
    trusted: chosen.source === "lock" && lock.contracts[id] === hash,
    source: chosen.source,
    editedOnDisk: disk !== void 0 && disk !== chosen.text
  });
};
var loadImplicit = (files, paths, project) => {
  const contract = implicitContract(project);
  const hash = contractHash(contract);
  const commands = contract.acceptance.filter((check2) => check2.run !== void 0);
  const trusted = commands.length === 0 || readTrust(files, paths).contracts[IMPLICIT_ID] === hash;
  return { contract, hash, trusted, source: "implicit", editedOnDisk: false };
};
var activeTaskId = (files, paths, explicit) => explicit ?? readState(files, paths).active;

// src/gate/pr-parse.ts
var FAILED = /* @__PURE__ */ new Set(["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"]);
var PENDING = /* @__PURE__ */ new Set(["IN_PROGRESS", "QUEUED", "PENDING", "WAITING", "REQUESTED", "EXPECTED"]);
var ciState = (item) => {
  const conclusion = (optionalString(item, "conclusion") ?? "").toUpperCase();
  const status = (optionalString(item, "status") ?? optionalString(item, "state") ?? "").toUpperCase();
  if (FAILED.has(conclusion) || FAILED.has(status)) return "failed";
  if (conclusion === "" && (PENDING.has(status) || status === "")) return "pending";
  if (PENDING.has(status)) return "pending";
  return "passed";
};
var ciChecks = (value) => Array.isArray(value) ? value.flatMap((item) => {
  if (!isRecord(item)) return [];
  const name = optionalString(item, "name") ?? optionalString(item, "context") ?? "?";
  return [{ name, state: ciState(item) }];
}) : [];
var parsePrView = (text6) => {
  const parsed = parseJsonObject(text6);
  if (!parsed.ok) return void 0;
  const record2 = parsed.value;
  const number = record2["number"];
  if (typeof number !== "number") return void 0;
  return {
    number,
    url: optionalString(record2, "url") ?? "",
    state: optionalString(record2, "state") ?? "",
    mergeable: optionalString(record2, "mergeable") ?? "UNKNOWN",
    mergeStateStatus: optionalString(record2, "mergeStateStatus") ?? "UNKNOWN",
    baseRefName: optionalString(record2, "baseRefName") ?? "",
    headRefOid: optionalString(record2, "headRefOid") ?? "",
    checks: ciChecks(record2["statusCheckRollup"])
  };
};
var isConflicting = (pr) => pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY";
var parseMergeTreeConflicts = (stdout) => {
  const [, ...rest] = stdout.split("\n");
  const end = rest.indexOf("");
  return [...new Set((end < 0 ? rest : rest.slice(0, end)).map((line2) => line2.trim()).filter((line2) => line2 !== ""))];
};

// src/gate/pr.ts
var PR_FIELDS = "number,url,state,mergeable,mergeStateStatus,baseRefName,headRefOid,statusCheckRollup";
var PR_CACHE_TTL_MS = 6e4;
var GH_TIMEOUT_MS = 8e3;
var gh = (runtime, cwd, args, timeoutMs = GH_TIMEOUT_MS) => runtime.exec({ command: "gh", args, cwd, timeoutMs });
var ghAuthenticated = (runtime, cwd, timeoutMs = 4e3) => {
  const result = gh(runtime, cwd, ["auth", "status"], timeoutMs);
  if (result.timedOut) return "timeout";
  return result.found && result.exitCode === 0 ? "yes" : "no";
};
var cached = (runtime, paths, branch, ttlMs) => {
  const raw = readJsonFile(runtime, paths.cache("pr.json"));
  const at = raw?.["fetchedAt"];
  if (raw?.["branch"] !== branch || typeof at !== "number" || nowMs(runtime) - at > ttlMs) return void 0;
  const view2 = raw["view"];
  return typeof view2 === "string" ? parsePrView(view2) : void 0;
};
var fetchView = (runtime, git, branch) => {
  const auth = ghAuthenticated(runtime, git.cwd);
  if (auth === "timeout") return { kind: "network", detail: "gh auth status timed out" };
  if (auth === "no") return { kind: "no_gh" };
  const view2 = gh(runtime, git.cwd, ["pr", "view", branch, "--json", PR_FIELDS]);
  if (view2.timedOut) return { kind: "network", detail: "gh pr view timed out" };
  if (view2.exitCode !== 0) {
    if (/no (open )?pull requests? found|no git remotes/i.test(view2.stderr)) return { kind: "none", branch };
    return { kind: "network", detail: view2.stderr.trim().split("\n")[0] ?? "gh failed" };
  }
  const pr = parsePrView(view2.stdout);
  return pr === void 0 ? { kind: "network", detail: "gh returned unexpected JSON" } : { kind: "fetched", branch, pr, view: view2.stdout };
};
var prStatus = (runtime, git, paths, ttlMs = PR_CACHE_TTL_MS) => {
  const branch = currentBranch(git);
  if (branch === void 0) return { kind: "no_branch" };
  const hit2 = cached(runtime, paths, branch, ttlMs);
  if (hit2 !== void 0) return { kind: "found", branch, pr: hit2, localHead: headSha(git) };
  const status = fetchView(runtime, git, branch);
  if (status.kind !== "fetched") return status;
  writeJsonFile(runtime, paths.cache("pr.json"), { fetchedAt: nowMs(runtime), branch, view: status.view });
  return { kind: "found", branch, pr: status.pr, localHead: headSha(git) };
};
var conflictFiles = (git, base) => {
  for (const target of [`origin/${base}`, base]) {
    if (git.out(["rev-parse", "--verify", "-q", `${target}^{commit}`]) === void 0) continue;
    const result = git.run(["merge-tree", "--write-tree", "--name-only", "--no-messages", target, "HEAD"]);
    if (result.found && result.exitCode === 1) return parseMergeTreeConflicts(result.stdout);
    if (result.found && result.exitCode === 0) return [];
  }
  return [];
};

// src/gate/prepare.ts
var diskFiles = (runtime, root) => ({
  read: (relative7) => {
    const text6 = runtime.readText(toAbsolutePath(join3(root, relative7)));
    return text6.ok ? text6.value : void 0;
  },
  exists: (relative7) => runtime.stat(toAbsolutePath(join3(root, relative7))) !== void 0
});
var baseFiles = (git, base, disk) => ({
  read: (relative7) => base === EMPTY_TREE ? disk.read(relative7) : fileAt(git, base, relative7),
  exists: disk.exists
});
var loadContract = (options, paths, git, base) => {
  const disk = diskFiles(options.runtime, paths.root);
  const id = activeTaskId(options.runtime, paths, options.taskId);
  if (id === void 0) return accept(loadImplicit(options.runtime, paths, baseFiles(git, base, disk)));
  return loadTask(options.runtime, paths, { disk: disk.read, base: (relative7) => fileAt(git, base, relative7) }, id);
};
var memo = (make) => {
  let value;
  return () => {
    value ??= { v: make() };
    return value.v;
  };
};
var sessionBaseline = (runtime, paths, sessionId) => {
  const session = readSession(runtime, paths);
  const baseline = readBaseline(runtime, paths);
  if (session === void 0 || baseline === void 0) return void 0;
  if (sessionId !== void 0 && session.sessionId !== sessionId) return void 0;
  return baseline.treeHash === session.startTree ? baseline.checks : void 0;
};
var skipReason = (runtime, paths, loaded, changes, tree, sessionId) => {
  if (!loaded.contract.implicit) return void 0;
  if (changes.length === 0) return "no_changes";
  const session = readSession(runtime, paths);
  return session !== void 0 && session.sessionId === sessionId && session.startTree === tree ? "no_session_edits" : void 0;
};
var prepareGate = (options) => {
  const probe = gitAt(options.runtime, options.cwd);
  const root = gitRoot(probe);
  if (root === void 0) {
    return options.taskId === void 0 ? { kind: "skipped", reason: "no_repo" } : { kind: "failed", failure: { kind: "not_a_repo" } };
  }
  const git = gitAt(options.runtime, root);
  const paths = fmPaths(root);
  const trust2 = readTrust(options.runtime, paths);
  const firstBase = resolveBase(git, void 0);
  const loaded = loadContract(options, paths, git, firstBase);
  if (!loaded.ok) return { kind: "failed", failure: { kind: "contract", problem: loaded.error } };
  const base = resolveBase(git, loaded.value.contract.base);
  const changes = changedFiles(git, base);
  const tree = treeHash(git);
  if (tree === void 0) return { kind: "failed", failure: { kind: "no_tree_hash" } };
  const skip = options.noSkip === true ? void 0 : skipReason(options.runtime, paths, loaded.value, changes, tree, options.sessionId);
  if (skip !== void 0) return { kind: "skipped", reason: skip };
  const pr = memo(() => prStatus(options.runtime, git, paths));
  const ctx = {
    runtime: options.runtime,
    git,
    paths,
    contract: loaded.value.contract,
    trusted: loaded.value.trusted,
    treeHash: tree,
    base,
    changes,
    deadline: nowMs(options.runtime) + options.budgetMs,
    sessionId: options.sessionId,
    env: options.env,
    trust: trust2,
    pr,
    mask: options.mask ?? maskText,
    baseline: sessionBaseline(options.runtime, paths, options.sessionId)
  };
  return { kind: "ready", prepared: { ctx, loaded: loaded.value } };
};

// src/gate/baseline-run.ts
var runBaseline = (options) => {
  const ready = prepareGate({ ...options, noSkip: true });
  if (ready.kind !== "ready") return { kind: "skipped", reason: "not_ready" };
  const ctx = { ...ready.prepared.ctx, baseline: void 0 };
  if (!ctx.trusted) return { kind: "skipped", reason: "untrusted" };
  const commands = ctx.contract.acceptance.filter(
    (check2) => check2.run !== void 0 && (check2.kind === "command" || check2.kind === "tests")
  );
  if (commands.length === 0) return { kind: "skipped", reason: "no_commands" };
  const checks = {};
  for (const check2 of commands) {
    const outcome = runShellCheck(check2, check2.run ?? "", ctx);
    checks[check2.id] = { exitCode: outcome.exitCode ?? null, failures: outcome.failures ?? [] };
  }
  if (treeHash(gitAt(ctx.runtime, ctx.paths.root)) !== ctx.treeHash) return { kind: "skipped", reason: "tree_moved" };
  writeBaseline(ctx.runtime, ctx.paths, ctx.treeHash, checks);
  return { kind: "recorded", treeHash: ctx.treeHash, checks };
};

// src/gate/hooks/common.ts
import { dirname as dirname3, join as join4 } from "node:path";
var DEFAULT_GATE_BUDGET_MS = 3e5;
var sessionCwd = (input) => input.payload.cwd === void 0 ? input.cwd : toAbsolutePath(input.payload.cwd, input.cwd);
var MAX_DEPTH = 64;
var findRepoRoot = (runtime, start) => {
  let current = start;
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    if (runtime.stat(toAbsolutePath(join4(current, ".git"))) !== void 0) return current;
    const parent = toAbsolutePath(dirname3(current));
    if (parent === current) return void 0;
    current = parent;
  }
  return void 0;
};
var projectPaths = (input) => {
  const root = findRepoRoot(input.runtime, sessionCwd(input));
  return root === void 0 ? void 0 : fmPaths(root);
};
var gateBudget = (input) => {
  const parsed = Number.parseInt(input.env["FINITEMONKEY_GATE_BUDGET_MS"] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_GATE_BUDGET_MS;
};
var allowWith = (output) => ({ kind: "allow", output });
var contextOutput = (event, additionalContext, systemMessage) => ({
  hookSpecificOutput: { hookEventName: event, additionalContext },
  ...systemMessage === void 0 ? {} : { systemMessage }
});
var human = (text6) => `finitemonkey: ${text6}`;

// src/gate/hooks/prs.ts
var PRS_CACHE_MS = 10 * 6e4;
var PRS_TIMEOUT_MS = 3e3;
var PRS_AUTH_TIMEOUT_MS = 2e3;
var parsePrList = (text6) => {
  const parsed = parseJson(text6);
  if (!parsed.ok || !Array.isArray(parsed.value)) return void 0;
  return parsed.value.flatMap((item) => {
    if (!isRecord(item) || typeof item["number"] !== "number") return [];
    const mergeable = optionalString(item, "mergeable");
    const status = optionalString(item, "mergeStateStatus");
    const state = mergeable === "CONFLICTING" || status === "DIRTY" ? "conflict" : status === "BEHIND" ? "behind" : "ok";
    return [{ number: item["number"], state }];
  });
};
var cachedPrs = (runtime, paths) => {
  const raw = readJsonFile(runtime, paths.cache("prs.json"));
  const at = raw?.["fetchedAt"];
  const list4 = raw?.["list"];
  if (typeof at !== "number" || nowMs(runtime) - at > PRS_CACHE_MS) return void 0;
  return parsePrList(JSON.stringify(list4 ?? []));
};
var refreshPrs = (runtime, paths) => {
  if (ghAuthenticated(runtime, paths.root, PRS_AUTH_TIMEOUT_MS) !== "yes") return void 0;
  const result = runtime.exec({
    command: "gh",
    args: [
      "pr",
      "list",
      "--author",
      "@me",
      "--state",
      "open",
      "--json",
      "number,mergeable,mergeStateStatus",
      "--limit",
      "20"
    ],
    cwd: paths.root,
    timeoutMs: PRS_TIMEOUT_MS
  });
  if (result.exitCode !== 0) return void 0;
  const list4 = parsePrList(result.stdout);
  if (list4 !== void 0)
    writeJsonFile(runtime, paths.cache("prs.json"), {
      fetchedAt: nowMs(runtime),
      list: list4.map((pr) => ({
        number: pr.number,
        mergeable: pr.state === "conflict" ? "CONFLICTING" : "MERGEABLE",
        mergeStateStatus: pr.state === "behind" ? "BEHIND" : "CLEAN"
      }))
    });
  return list4;
};
var openPrsLine = (t, runtime, paths) => {
  const list4 = cachedPrs(runtime, paths);
  if (list4 === void 0 || list4.length === 0) return [];
  const items = list4.map((pr) => `#${String(pr.number)} ${t(`gate.prs.${pr.state}`)}`).join(", ");
  return [t("gate.prs.line", { count: list4.length, items })];
};

// src/i18n/en.json
var en_default = {
  "command.init.summary": "Set up Finite Monkey in this project",
  "command.doctor.summary": "Check the environment and say how to fix each problem",
  "command.update.summary": "Update the files Finite Monkey generated",
  "command.uninstall.summary": "Remove Finite Monkey from this project",
  "command.i18n_check.summary": "Check that the pt-BR, en and es catalogs match",
  "command.hook.summary": "Answer a Claude Code hook event (reads JSON on stdin)",
  "command.version.summary": "Print the version",
  "command.help.summary": "Show commands and flags",
  "help.tagline": "Infinite monkeys not required.",
  "help.usage": "Usage",
  "help.command": "command",
  "help.commands": "Commands",
  "help.flags": "Flags",
  "help.options": "Options",
  "help.planned": "(not available yet)",
  "help.more": "Run `finitemonkey help <command>` for details. Add --json for machine-readable output.",
  "flag.json": "Print one JSON object (schemaVersion 1) instead of text",
  "flag.lang": "Language for messages",
  "flag.yes": "Answer yes to confirmations",
  "flag.dry_run": "Show what would change without changing anything",
  "flag.version": "Print the version",
  "flag.help": "Show help",
  "output.error": "error: {message}",
  "output.fix": "fix: {fix}",
  "output.next": "next: {next}",
  "error.internal": "Finite Monkey failed unexpectedly: {detail}",
  "error.invalid_arguments": "Invalid arguments: {detail}",
  "error.unexpected_argument": 'Unexpected argument "{argument}"',
  "error.unknown_command": 'Unknown command "{command}"',
  "error.unknown_command_suggest": 'Unknown command "{command}". Did you mean "{suggestion}"?',
  "error.not_implemented": '"{command}" is not available in this version yet',
  "error.invalid_lang": 'Unsupported language "{lang}". Use one of: {languages}',
  "error.i18n_catalog_unreadable": "Could not read catalog {file}: {detail}",
  "error.i18n_mismatch": "{count} catalog problem(s) found",
  "error.doctor_failed": "{count} check(s) failed",
  "error.unknown_hook_event": 'Unknown hook event "{event}". Use one of: {events}',
  "i18n.summary": "Languages: {languages}. Keys: {keys}.",
  "i18n.ok": "All catalogs match.",
  "i18n.fix": "Edit the catalogs in {file} so every language has the same keys and placeholders",
  "i18n.problem.missing": "missing key",
  "i18n.problem.extra": "key not in en.json",
  "i18n.problem.placeholder": "placeholders differ (expected: {expected}; found: {actual})",
  "i18n.problem.empty": "empty text",
  "i18n.problem.not_string": "value is not text",
  "doctor.title": "finitemonkey doctor ({version})",
  "doctor.summary": "{ok} ok, {warn} warning(s), {fail} failure(s)",
  "doctor.node.ok": "Node.js {version}",
  "doctor.node.old": "Node.js {version} is older than the minimum {min}",
  "doctor.node.fix": "Install Node.js 20 or newer from https://nodejs.org",
  "doctor.git.ok": "git {version}",
  "doctor.git.missing": "git was not found",
  "doctor.git.fix": "Install git from https://git-scm.com/downloads",
  "doctor.git.old": "git {version} is older than {min}; some commands will need a newer git",
  "doctor.git.fix_old": "Update git to {min} or newer",
  "doctor.claude.ok": "Claude Code {version}",
  "doctor.claude.missing": "Claude Code was not found; the CLI works without it, the hooks need it",
  "doctor.claude.fix": "Install Claude Code: npm install -g @anthropic-ai/claude-code",
  "doctor.claude.timeout": "`claude --version` did not answer in time",
  "doctor.claude.fix_timeout": "Run `claude --version` by hand and check that it answers",
  "doctor.os.linux": "Linux",
  "doctor.os.wsl": "Linux on WSL",
  "doctor.os.macos": "macOS",
  "doctor.os.windows": "Windows (native)",
  "doctor.os.other": "Unrecognized system ({platform})",
  "doctor.path.plain": "Project path has no spaces or accents",
  "doctor.path.chars": "Project path has spaces or accents: {path}",
  "doctor.path.fix_chars": "Finite Monkey handles this path; if another tool fails here, move the project to a path without spaces or accents",
  "doctor.path.synced": "Project is inside a synced folder (OneDrive, Dropbox, iCloud or Google Drive): {path}",
  "doctor.path.fix_synced": "Move the project out of the synced folder to avoid sync conflicts and slow git",
  "doctor.path.wsl_mount": "Project is on a Windows drive mounted in WSL: {path}",
  "doctor.path.fix_wsl_mount": "Move the project into the Linux home (for example ~/projects) for faster git and correct permissions",
  "hook.failed_closed": "the {event} hook could not run ({detail}), so it blocked to stay safe. Run `finitemonkey doctor`",
  "hook.failed_open": "the {event} hook could not run ({detail}); continuing without it. Run `finitemonkey doctor`",
  "exit.ok": "0 ok: the command did what it was asked",
  "exit.check_failed": "1 check failed: the command ran and found a problem",
  "exit.usage": "2 usage error: unknown command, unknown flag, bad value or command not available yet",
  "exit.not_configured": "3 not configured: setup or a prerequisite (node, git, files, permissions) is missing",
  "exit.needs_person": "4 needs a person: a decision or approval is required before going on",
  "exit.internal": "5 internal error: Finite Monkey itself failed; please report it",
  "help.exit_codes": "Exit codes",
  "hook.stop_released": "the {event} hook would block again ({detail}), but Claude Code is already continuing from a stop hook, so it lets the session stop. Run `finitemonkey doctor`",
  "error.needs_confirmation": '"{command}" needs your decision before it changes anything: {question}',
  "secrets.command.scan": "Find secrets in files, the staged changes or the git history (local only)",
  "secrets.command.accept": "Accept one finding into the baseline, with a reason and an expiry (the person only)",
  "secrets.command.incident": "List secret incidents, mark them rotated or closed, and show the history purge steps",
  "secrets.found_item": "{rule} at {where}",
  "secrets.found_more": "and {count} more",
  "secrets.where.line": "line {line}, column {column}",
  "secrets.where.file": "{file}:{line}:{column}",
  "secrets.where.new_text": "{file} (line {line} of the new text)",
  "secrets.block.write": "blocked: the new text for {file} has a credential ({found}). Nothing was written. Keep the value in .env (outside git) and read it by its variable name. If the key is real, treat it as exposed and rotate it.",
  "secrets.block.bash": "blocked: this command has a credential ({found}) and did not run. Read the value from an environment variable instead of writing it in the command. If the key is real, treat it as exposed and rotate it.",
  "secrets.block.commit": "blocked: the staged changes have a credential ({found}), so the commit did not run. Remove it from the staged files, keep it in .env (outside git) and rotate it if it is real.",
  "secrets.block.read": "blocked: {target} holds secrets, and reading it would put their values in the conversation. Ask the person for the variable names, or read .env.example.",
  "secrets.block.env_dump": 'blocked: `{command}` prints every environment variable, secrets included. Print only the variable you need by name, or check that it exists with `test -n "$NAME"`.',
  "secrets.block.person_only": "blocked: `{command}` is a decision for the person, not the model. Ask the person to run it in their own terminal.",
  "secrets.block.prompt": "your message was not sent to the model: it has a credential ({found}). If this key was pasted anywhere else, treat it as exposed and rotate it. To use it, put it in .env and tell me only the variable name. Never paste keys into the chat. Incident: {incident}.",
  "secrets.post.context": "Finite Monkey: the {tool} output contained a credential ({found}). Incident {incident} is open; rotating the key is the person's decision. Finite Monkey output never repeats the value.",
  "secrets.incident.unsaved": "not recorded ({detail})",
  "secrets.scan.title": "Secrets scan ({mode}): {total} found, {new} new, {known} known, {expired} expired, {fixed} fixed",
  "secrets.scan.item": "  [{status}] {rule} {where} {mask}  id {id}",
  "secrets.scan.clean": "No secrets found. The monkey keeps its bananas to itself.",
  "secrets.accept.done": "Accepted {id} ({rule} at {where}) as {state} until {expires}, by {owner}.",
  "secrets.action.accept": "accept a finding",
  "secrets.action.rotated": "mark an incident as rotated",
  "secrets.action.close": "close an incident",
  "secrets.incident.title": "{count} incident(s)",
  "secrets.incident.item": "  {id}  {state}  {rule}  {where}  since {created}",
  "secrets.incident.none": "No secret incidents.",
  "secrets.incident.marked": "Incident {id} is now {state}.",
  "secrets.purge.title": "History purge for {id} ({where}, first commit {commit}). You run these steps; Finite Monkey never runs them:",
  "secrets.purge.step1": "1. Confirm the old key is revoked at the provider and the new one works in every consumer.",
  "secrets.purge.step2": "2. Outside the repository, write a replacements file with one line per leaked value: <value>==>REMOVED. Copy the value from your own records; Finite Monkey never stores or prints it.",
  "secrets.purge.step3": "3. In a fresh mirror clone, run: git filter-repo --replace-text <replacements file>",
  "secrets.purge.step4": "4. Relax branch protection yourself, push the rewritten refs, restore the protection and tell everyone with a clone to clone again.",
  "secrets.purge.step5": "5. Close the incident: finitemonkey secrets incident close {id}",
  "secrets.error.found": "{count} secret finding(s) outside the baseline or with an expired acceptance",
  "secrets.error.one_mode": "Choose only one of --staged, --history and --path",
  "secrets.error.git_unavailable": "The scan could not read git ({detail})",
  "secrets.error.baseline_invalid": "The baseline {file} is invalid: {detail}",
  "secrets.error.person_only": "Only the person can {action}, and this does not look like their terminal (no TTY, or running inside Claude Code)",
  "secrets.error.reason_required": "--reason is required: say why this finding is acceptable",
  "secrets.error.finding_not_found": "No current finding has the id {id}",
  "secrets.error.incident_not_found": "No incident has the id {id}",
  "secrets.error.not_rotated": "Incident {id} is {state}: rotate the key at the provider first, then mark it rotated",
  "secrets.error.bad_transition": "Incident {id} cannot go from {from} to {to}",
  "secrets.error.write_failed": "Could not write {file}: {detail}",
  "install.config.header": "Finite Monkey project settings. Commit this file. `finitemonkey update` keeps your edits.",
  "install.plan.title": "Finite Monkey plan for {root} (preset {preset}):",
  "install.warning": "warning: {message}",
  "install.warn.not_git": "this folder is not inside a git repository; installing here anyway",
  "install.warn.fail_open": "Claude Code {version} cannot block an action when a hook crashes (needs 2.1.295 or newer); guards fail open until you update Claude Code",
  "install.warn.authority": "{name} ({source}) also decides when a session may stop; Finite Monkey works alongside it and never turns it off",
  "install.warn.plugin": "the finitemonkey plugin is enabled ({source}); its hooks step aside while this project has its own Finite Monkey hooks",
  "install.warn.foreign": "{path} already exists and was not written by Finite Monkey; left untouched (proposed content in the diff)",
  "install.warn.edited": "{path} was edited after install; your version is kept (the new template is in the diff)",
  "install.warn.edited_kept": "kept {path}: you edited it after install",
  "install.dry_run": "Dry run: nothing was written.",
  "install.nothing_to_do": "Already up to date. Nothing to write.",
  "install.up_to_date": "The files Finite Monkey manages match this version.",
  "install.confirm_question": "apply the plan above (every touched file is backed up first)?",
  "install.done_init": "Installed. Open Claude Code and keep working: one monkey, finite time, finished work.",
  "install.done_update": "Updated. Your edits were kept.",
  "install.uninstall.title": "Removing Finite Monkey from {root}:",
  "install.uninstall.keeps_state": ".finitemonkey/ stays (backups and evidence). Add --purge to delete it too.",
  "install.uninstall.purge": ".finitemonkey/ will be deleted, including backups and evidence.",
  "install.uninstall.outside": "Not touched here, remove it yourself if you installed it: {command}",
  "install.uninstall.question": "remove what Finite Monkey added and restore the backups?",
  "install.uninstall.done": "Removed. The project is back to how it was, except files you edited.",
  "error.settings_unreadable": ".claude/settings.json is not valid JSON ({detail}), so it was not changed",
  "error.lock_unreadable": ".finitemonkey/lock.json is unreadable ({detail})",
  "error.install_locked": "another finitemonkey run holds {path}",
  "error.install_failed": "could not write {path} ({detail}); every file written in this run was put back",
  "error.not_installed": "Finite Monkey is not installed in this project (no .finitemonkey/lock.json)",
  "error.install_outdated": "the files Finite Monkey manages differ from this version",
  "error.invalid_preset": 'Unknown preset "{preset}". Use neutral or gabriel',
  "command.gate.summary": "Run the done contract and record evidence",
  "command.task_new.summary": "Create a done contract for a task",
  "command.task_show.summary": "Show a task contract and its evidence",
  "command.task_done.summary": "Run the gate and close the task when it passes",
  "error.gate_failed": "The gate failed: {failed} check(s) failed, {unverified} not verified",
  "error.gate_incomplete": "The gate is incomplete: {unverified} check(s) not verified",
  "error.gate_not_run": "The gate could not run: {detail}",
  "error.not_a_git_repo": "This folder is not inside a git repository",
  "error.task_exists": 'Task "{task}" already exists',
  "error.task_invalid": "The task contract is invalid: {detail}",
  "error.task_not_found": 'Task "{task}" was not found',
  "task.created": "Created task {task} in {file}. It is the active task now.",
  "task.done": "Task {task} is done: every check passed on this tree.",
  "gate.status.passed": "passed",
  "gate.status.failed": "failed",
  "gate.status.unverified": "not verified",
  "gate.report.title": "Gate for task {task} at tree {tree}",
  "gate.report.title_implicit": "Gate for this session's changes at tree {tree}",
  "gate.report.contract_edited": "The contract file was edited outside Finite Monkey; the approved version was used.",
  "gate.verdict.passed": "{passed} passed, {failed} failed, {unverified} not verified. Done.",
  "gate.verdict.failed": "{passed} passed, {failed} failed, {unverified} not verified. Not done.",
  "gate.verdict.incomplete": "{passed} passed, {failed} failed, {unverified} not verified. Not proven yet.",
  "gate.reason.tool_missing": "the tool is not installed",
  "gate.reason.timeout": "it ran out of time",
  "gate.reason.rate_limited": "rate limit reached",
  "gate.reason.budget": "the gate time budget ran out",
  "gate.reason.not_implemented": "this check type is not available in this version",
  "gate.reason.no_gh": "gh is missing or not logged in",
  "gate.reason.network": "the network or GitHub did not answer",
  "gate.reason.pending": "CI is still running",
  "gate.reason.untrusted": "the contract commands are not approved on this machine",
  "gate.reason.rewriter": "output rewritten by another tool does not count",
  "gate.reason.awaiting_person": "waiting for the person",
  "gate.reason.no_evidence": "no evidence for the current tree",
  "gate.reason.no_baseline": "no baseline was recorded",
  "gate.note.untrusted": "commands of task {task} are not approved on this machine yet",
  "gate.note.rewriter": "output passed through an output rewriter; only Finite Monkey's own run counts",
  "gate.note.budget": "gate time budget ran out before this check",
  "gate.note.tool_missing": "command not found: {command}",
  "gate.note.timeout": "stopped after {seconds} s",
  "gate.note.rate_limited": "rate limit or quota reached, retry later",
  "gate.note.exit": "exit {code}",
  "gate.note.output": "last line: {line}",
  "gate.note.new_failure": "new failure: {name}",
  "gate.note.baseline": "{count} failure(s) already failed before this session (baseline)",
  "gate.note.trivial": '"{command}" does not check code or tests',
  "gate.note.zero_tests": '"{command}" ran zero test cases',
  "gate.note.tests_ran": "{count} test(s) ran",
  "gate.note.not_implemented": "the {kind} check is not available in this version",
  "gate.note.released": "released by the person for {guard}: {reason}",
  "gate.tests.test_file_deleted": "test file deleted: {file}",
  "gate.tests.test_removed": "test removed in {file} ({before} → {after})",
  "gate.tests.skip_added": "skip, only or todo added in {file} ({before} → {after})",
  "gate.tests.assertion_removed": "assertion removed in {file} ({before} → {after})",
  "gate.tests.snapshot_changed": "snapshot rewritten: {file}",
  "gate.tests.config_changed": "test or lint config changed: {file}",
  "gate.tests.out_of_scope": "test file outside the task scope changed: {file}",
  "gate.tests.fix": "make the code pass the tests as they were",
  "gate.tests.clean": "no test removed, skipped or weakened",
  "gate.diff.no_scope": "no scope declared",
  "gate.diff.outside": "outside the scope: {file}",
  "gate.diff.too_many_files": "{count} files changed, budget {max}",
  "gate.diff.too_many_lines": "{count} lines changed, budget {max}",
  "gate.diff.within": "{files} file(s), {lines} line(s), inside scope and budget",
  "gate.placeholders.clean": "no placeholder in new code",
  "gate.placeholders.found": "placeholder at {file}:{line}",
  "gate.git.uncommitted": "{count} file(s) not committed, first: {file}",
  "gate.git.no_upstream": "the branch has no upstream",
  "gate.git.unpushed": "{count} commit(s) not pushed",
  "gate.git.no_pr": "no open pull request for this branch",
  "gate.git.ok": "{require}: ok",
  "gate.manual.waiting": "waiting for the person to approve: {description}",
  "gate.manual.approved": "approved by the person at {at}: {reason}",
  "gate.pr.found": "PR #{number} ({state}) {url}",
  "gate.pr.behind": "the base {base} moved ahead of this branch",
  "gate.pr.stale_head": "PR #{number} does not have the latest local commit",
  "gate.pr.conflict": "PR #{number} conflicts with `{base}`: CI does not run while there is a conflict",
  "gate.pr.conflict_file": "conflict in {file}",
  "gate.pr.conflict_next": "next safe step: update the branch with `{base}` in a worktree, without --force, resolving through the merge protocol",
  "gate.pr.ci_failed": "CI check failed: {name}",
  "gate.pr.ci_pending": "CI check pending: {name}",
  "gate.pr.no_gh": "gh is missing or not logged in, so the PR state is unknown",
  "gate.pr.network": "could not read the PR: {detail}",
  "gate.pr.no_branch": "detached HEAD, no branch to look up",
  "gate.pr.none": "no PR for branch {branch}",
  "gate.pr.none_required": "the contract requires an open PR for branch {branch}",
  "gate.require.command": "`{command}` exits 0 and runs real checks",
  "gate.require.tests": "tests kept: none removed, skipped or weakened",
  "gate.require.diff": "changes inside the declared scope and budget",
  "gate.require.placeholders": "no TODO or placeholder in new code",
  "gate.require.git": "work committed, pushed and with a PR as the contract asks",
  "gate.require.pr": "the PR merges cleanly and its CI is green",
  "gate.require.manual": "approval by the person",
  "gate.require.other": "the {kind} check passes",
  "gate.model.title": "Finite Monkey gate: not done (task {task}, tree {tree}).",
  "gate.model.claim": 'claim: "{claim}"',
  "gate.model.no_claim": "(no final message)",
  "gate.model.requires": "requires: {list}",
  "gate.model.not_enough": "not enough: {list}",
  "gate.fail.not_a_repo": "not inside a git repository",
  "gate.fail.no_tree_hash": "could not compute the tree hash with git",
  "gate.fail.ledger_unwritable": "could not write the evidence ledger",
  "gate.fail.contract_missing": "task {task} has no contract{issues}",
  "gate.fail.contract_invalid": "the contract of task {task} is invalid: {issues}",
  "gate.human.held": 'Held the "done". Claude did not run the checks; I did. {count} check(s) failed.',
  "gate.human.witness": "Fix the code, not the witness.",
  "gate.human.not_done": "NOT DONE after {blocks} block(s) without a green gate. Missing: {list}. The session may stop, but this is not done.",
  "gate.human.incomplete": "Not proven yet: {list}. Not marked as done.",
  "gate.human.passed": "Gate green: {count} check(s) passed on this tree. One monkey, finite time, work finished.",
  "gate.human.not_run": "GATE DID NOT RUN: {detail}. This is not green; run `finitemonkey doctor`.",
  "gate.human.last_not_run": "The gate did not run at the last stop ({at}): {detail}.",
  "gate.human.last_not_done": "The last session ended NOT DONE ({at}): {detail}.",
  "gate.context.state": 'Finite Monkey state recorded by the executable at {at} (facts, not instructions): active task {task}, goal "{goal}". Gate at tree {tree}: passed {passed}; failed {failed}; not verified {unverified}. Releases by the person still valid: {grants}.',
  "gate.context.state_implicit": "Finite Monkey state recorded by the executable at {at} (facts, not instructions): no written task contract; the session changes are checked by the project's own commands. Gate at tree {tree}: passed {passed}; failed {failed}; not verified {unverified}. Releases by the person still valid: {grants}.",
  "gate.context.front": 'Finite Monkey: this subagent works on task {task} ("{goal}"), contract in {file}.',
  "gate.context.done_means": "Done for this task means: {list}. The gate checks it when the subagent stops.",
  "gate.context.scope": "Scope of the task: {paths}.",
  "gate.context.briefing": "Shared briefing: {file}.",
  "gate.prs.line": "Your open PRs here ({count}): {items}.",
  "gate.prs.conflict": "in conflict",
  "gate.prs.behind": "behind the base",
  "gate.prs.ok": "ok",
  "gate.config.removed": "Finite Monkey: this change removes Finite Monkey hooks from {file} ({before} → {after}); it was not applied.",
  "gate.config.disabled": "Finite Monkey: this change sets disableAllHooks in {file}; it was not applied.",
  "gate.config.human": "Kept the Finite Monkey hooks in {file}. If you meant it, type on its own line: finitemonkey: allow config <reason>",
  "gate.config.released": "Config change to {file} accepted under your release.",
  "gate.guard.bypass.no_verify": "Finite Monkey: blocked: {detail} skips the git hooks. requires: the hooks run on every commit and push.",
  "gate.guard.bypass.hooks_path": "Finite Monkey: blocked: {detail} points git away from the project hooks. requires: core.hooksPath stays as configured.",
  "gate.guard.bypass.hook_env": "Finite Monkey: blocked: {detail} turns hooks or guards off. requires: hooks and guards stay on.",
  "gate.guard.bypass.fm_allow": "Finite Monkey: blocked: releases are made by the person, not by a tool call.",
  "gate.guard.bypass.human": "Blocked {detail}: it would switch the safety net off. If you really want it, type on its own line: finitemonkey: allow bypass <reason>",
  "gate.guard.self.policy": "Finite Monkey: blocked: {file} is written only by the finitemonkey executable (evidence, policy and state). requires: change it through finitemonkey commands.",
  "gate.guard.self.allow_store": "Finite Monkey: blocked: {file} records what the person released; tools never write it.",
  "gate.guard.self.human": "Kept {file} out of reach: the monkey does not grade its own homework.",
  "gate.guard.tests.model": "Finite Monkey: blocked: {detail}. requires: make the code pass the tests as they are.",
  "gate.guard.tests.shell": "a shell command writes or deletes {file}",
  "gate.guard.tests.human": "Blocked: {detail}. Tests are the only witness we have. Fix the code, not the witness. If the change is intended, type on its own line: finitemonkey: allow tests <reason>",
  "gate.release.allowed": "Released {guard} until {until}, by your request.",
  "gate.release.unknown_guard": "There is no guard called {guard} to release.",
  "gate.release.approved": "Recorded your approval of {task}/{check}.",
  "gate.release.trusted": "Approved the commands of {task} on this machine.",
  "gate.release.trust_failed": "Could not approve {task}: no valid contract found.",
  "gate.skipped.no_repo": "Not a git repository: nothing to gate.",
  "gate.skipped.no_changes": "No changes in the tree: nothing to gate.",
  "gate.skipped.no_session_edits": "This session did not change the tree: nothing to gate.",
  "gate.baseline.recorded": "Recorded the baseline of already-failing checks.{reason}",
  "gate.baseline.skipped": "Baseline not recorded: {reason}.",
  "gate.secrets.unavailable": "could not scan the changes for secrets (git unavailable)",
  "gate.secrets.finding": "secret {rule} at {file}:{line}",
  "gate.secrets.incident": "secret incident {id} is {state}",
  "gate.secrets.clean": "no new secret in the changes and no open incident",
  "gate.require.secrets": "no new secret and no secret incident left open",
  "git.command.snapshot": "Save the working tree, index and untracked files to a backup ref without touching them",
  "git.command.undo": "List the snapshots or restore one, into a new worktree by default",
  "git.command.rescue": "List lost commits from the reflog and fsck, and restore one into a new branch",
  "git.command.merge_verify": "Check that a merge kept every change from both sides",
  "git.block.force_push": "blocked: `{command}` rewrites the remote branch and can erase commits someone else pushed. Fetch, integrate the remote commits and push normally. On your own branch after a rebase, use `git push --force-with-lease=<branch>:<expected sha> --force-if-includes`.",
  "git.block.lease_not_own": "blocked: `{command}` forces a push onto {subject}, which is not the branch you are working on or is protected. A forced push is only for your own branch, with an explicit lease.",
  "git.block.push_delete": "blocked: `{command}` deletes {subject} on the remote. Deleting a remote branch is for the person to do.",
  "git.block.push_mirror": "blocked: `{command}` overwrites every remote ref and would publish the backup refs. Push the branch you need by name.",
  "git.block.clean": "blocked: `{command}` deletes untracked files for good; they are in no commit. Run `git clean -n` to see the list, then move what should go into .finitemonkey/trash/ or ask the person.",
  "git.block.stash_drop": "blocked: `{command}` throws away stashed work that exists nowhere else. Apply it with `git stash apply` or leave it; dropping a stash is for the person to do.",
  "git.block.branch_unmerged": "blocked: `{command}` deletes {subject}, whose commits are neither in its upstream nor in the default branch. Push or merge it first; `git branch -d` works once it is merged.",
  "git.block.worktree_force": "blocked: `{command}` removes a worktree even with uncommitted changes. Commit or archive its work first; plain `git worktree remove` refuses a dirty tree on purpose.",
  "git.block.rm_worktree": "blocked: `{command}` deletes {subject}, which is a git worktree or repository; uncommitted work in it would be lost. Commit or archive it, then use `git worktree remove` without --force.",
  "git.block.rm_root": "blocked: `{command}` recursively deletes {subject}, a root or home directory. Name the exact folder to remove.",
  "git.block.rebase_protected": "blocked: `{command}` rewrites {subject}, a protected branch. Change it through a pull request.",
  "git.block.rebase_shared": "blocked: `{command}` rewrites {subject}, which already has someone else's commits on the remote. Merge the base into it instead of rebasing.",
  "git.block.merge_side": "blocked: `{command}` resolves conflicts by taking one side whole ({subject}), which silently drops the other side's changes. Resolve each conflict by hand and run `finitemonkey merge verify` before committing.",
  "git.block.history": "blocked: `{command}` deletes history or reflog entries that undo and rescue depend on. Rewriting history is for the person to do.",
  "git.block.protected_commit": "blocked: `{command}` would commit straight onto {subject}, a protected branch. Create a branch with `git switch -c <type>/<name>` and open a pull request.",
  "git.block.protected_push": "blocked: `{command}` pushes to {subject}, a protected branch. Push your own branch and open a pull request.",
  "git.block.foreign": "blocked: `{command}` would discard changes this session did not make: {files}. Undo only your own lines with Edit.",
  "git.foreign.before": "{path} (had changes before you started)",
  "git.foreign.other": "{path} (changed outside this session)",
  "git.block.unknown": "blocked: `{command}` discards changes, and `git status` failed, so there is no telling whose they are. Fix the repository and try again.",
  "git.block.snapshot_failed": "blocked: `{command}` is risky and the safety snapshot before it failed ({detail}), so it did not run. Fix the cause and try again.",
  "git.snapshot.context": "finitemonkey saved a snapshot before `{command}`: {ref}. `finitemonkey undo {ref}` brings the previous state back.",
  "prod.block.effect": "blocked: `{command}` changes production ({target}) by hand, and a server edited by hand drifts from the repository. Change it through the deploy path ({deploy}): commit, open a pull request and let the deploy run.",
  "prod.block.interactive": "blocked: `{command}` opens an interactive session on production ({target}), where nothing typed can be checked first. Run one read-only command at a time, such as `ssh {target} docker ps`.",
  "prod.deploy.unknown": "the project's declared deploy",
  "git.snapshot.done": "snapshot saved: {ref} ({commit}). `finitemonkey undo {ref}` restores it.",
  "git.undo.list_title": "{count} snapshot(s), newest first:",
  "git.undo.list_item": "{index}. {at}  {op}  {ref}",
  "git.undo.worktree": "restored {ref} into a new worktree at {path}. Compare it with your tree and copy what you need; `git worktree remove {path}` removes it. The state before this undo is in {backup}.",
  "git.undo.in_place": "restored {ref} in place. The state before this undo is in {backup}; `finitemonkey undo {backup}` brings it back.",
  "git.undo.confirm": "restoring in place overwrites the working tree and the index. Run it yourself with --in-place --yes to confirm.",
  "git.rescue.title": "recovery candidates (read-only, nothing changed):",
  "git.rescue.reflog": "reflog {ref}: {sha} {when} {subject}",
  "git.rescue.dangling": "lost commit {sha} {when} {subject}",
  "git.rescue.blobs": "{count} staged file content(s) are lost but recoverable; `git fsck --lost-found` writes them to .git/lost-found/other.",
  "git.rescue.never_staged": "a file that was never staged nor committed cannot be recovered from git.",
  "git.rescue.next": "restore one with `finitemonkey rescue --restore <sha> --branch <name>`.",
  "git.rescue.restored": "created branch {branch} at {sha}.",
  "git.merge.ok": "nothing lost: {files} file(s) checked between {base} and {result}, {justified} justified drop(s).",
  "git.merge.lost": "{count} change(s) lost between {base} and {result}:",
  "git.merge.finding": "{where} [{kind}] {side}: {text}",
  "git.merge.limits": "this proves the changes are present, not that the merged code works; the tests of both sides still have to pass.",
  "git.merge.none": "no merge to check: {detail}",
  "git.error.snapshot_failed": "the snapshot failed: {detail}",
  "git.error.nothing_to_undo": "no snapshot found for {ref}.",
  "git.error.undo_failed": "the undo failed: {detail}",
  "git.error.rescue_failed": "rescue failed: {detail}",
  "git.error.merge_lost": "{count} change(s) were lost in the merge and are not justified in the dropped list.",
  "git.error.merge_unanalyzable": "the merge could not be analyzed: {detail}",
  "gate.require.worktree": "every file changed in the session committed, and the commits pushed or with a declared destination",
  "gate.require.merge": "every merge since the start kept the changes of both sides",
  "gate.worktree.unavailable": "could not read the git state of the worktree",
  "gate.worktree.dirty": "files changed in this session are not committed: {files}",
  "gate.worktree.unpushed": "{count} commit(s) on {branch} exist only on this machine",
  "gate.worktree.clean": "the session's changes are committed and pushed",
  "gate.merge.unavailable": "could not read the merges of the session",
  "gate.merge.unanalyzed": "merge {commit} could not be analyzed: {detail}",
  "gate.merge.lost": "merge {commit} lost changes: {findings}",
  "gate.merge.clean": "{count} merge(s) checked, nothing lost"
};

// src/i18n/es.json
var es_default = {
  "command.init.summary": "Instala Finite Monkey en este proyecto",
  "command.doctor.summary": "Revisa el entorno y dice cómo corregir cada problema",
  "command.update.summary": "Actualiza los archivos que Finite Monkey generó",
  "command.uninstall.summary": "Quita Finite Monkey de este proyecto",
  "command.i18n_check.summary": "Revisa que los catálogos pt-BR, en y es coincidan",
  "command.hook.summary": "Responde a un evento de hook de Claude Code (lee JSON de la entrada estándar)",
  "command.version.summary": "Muestra la versión",
  "command.help.summary": "Muestra comandos y opciones",
  "help.tagline": "Infinite monkeys not required.",
  "help.usage": "Uso",
  "help.command": "comando",
  "help.commands": "Comandos",
  "help.flags": "Opciones globales",
  "help.options": "Opciones",
  "help.planned": "(aún no disponible)",
  "help.more": "Ejecuta `finitemonkey help <comando>` para más detalles. Usa --json para una salida legible por máquina.",
  "flag.json": "Imprime un objeto JSON (schemaVersion 1) en lugar de texto",
  "flag.lang": "Idioma de los mensajes",
  "flag.yes": "Responde sí a las confirmaciones",
  "flag.dry_run": "Muestra qué cambiaría sin cambiar nada",
  "flag.version": "Muestra la versión",
  "flag.help": "Muestra la ayuda",
  "output.error": "error: {message}",
  "output.fix": "cómo corregir: {fix}",
  "output.next": "siguiente paso: {next}",
  "error.internal": "Finite Monkey falló de forma inesperada: {detail}",
  "error.invalid_arguments": "Argumentos inválidos: {detail}",
  "error.unexpected_argument": 'Argumento inesperado "{argument}"',
  "error.unknown_command": 'Comando desconocido "{command}"',
  "error.unknown_command_suggest": 'Comando desconocido "{command}". ¿Quisiste decir "{suggestion}"?',
  "error.not_implemented": '"{command}" aún no está disponible en esta versión',
  "error.invalid_lang": 'Idioma no soportado "{lang}". Usa uno de estos: {languages}',
  "error.i18n_catalog_unreadable": "No se pudo leer el catálogo {file}: {detail}",
  "error.i18n_mismatch": "{count} problema(s) en los catálogos",
  "error.doctor_failed": "{count} revisión(es) fallaron",
  "error.unknown_hook_event": 'Evento de hook desconocido "{event}". Usa uno de estos: {events}',
  "i18n.summary": "Idiomas: {languages}. Claves: {keys}.",
  "i18n.ok": "Todos los catálogos coinciden.",
  "i18n.fix": "Edita los catálogos en {file} para que todos los idiomas tengan las mismas claves y los mismos marcadores",
  "i18n.problem.missing": "falta la clave",
  "i18n.problem.extra": "clave que no existe en en.json",
  "i18n.problem.placeholder": "marcadores distintos (esperado: {expected}; encontrado: {actual})",
  "i18n.problem.empty": "texto vacío",
  "i18n.problem.not_string": "el valor no es texto",
  "doctor.title": "finitemonkey doctor ({version})",
  "doctor.summary": "{ok} ok, {warn} aviso(s), {fail} falla(s)",
  "doctor.node.ok": "Node.js {version}",
  "doctor.node.old": "Node.js {version} es más antiguo que el mínimo {min}",
  "doctor.node.fix": "Instala Node.js 20 o más nuevo desde https://nodejs.org",
  "doctor.git.ok": "git {version}",
  "doctor.git.missing": "No se encontró git",
  "doctor.git.fix": "Instala git desde https://git-scm.com/downloads",
  "doctor.git.old": "git {version} es más antiguo que {min}; algunos comandos necesitarán un git más nuevo",
  "doctor.git.fix_old": "Actualiza git a {min} o más nuevo",
  "doctor.claude.ok": "Claude Code {version}",
  "doctor.claude.missing": "No se encontró Claude Code; la CLI funciona sin él, los hooks lo necesitan",
  "doctor.claude.fix": "Instala Claude Code: npm install -g @anthropic-ai/claude-code",
  "doctor.claude.timeout": "`claude --version` no respondió a tiempo",
  "doctor.claude.fix_timeout": "Ejecuta `claude --version` a mano y revisa que responda",
  "doctor.os.linux": "Linux",
  "doctor.os.wsl": "Linux en WSL",
  "doctor.os.macos": "macOS",
  "doctor.os.windows": "Windows (nativo)",
  "doctor.os.other": "Sistema no reconocido ({platform})",
  "doctor.path.plain": "La ruta del proyecto no tiene espacios ni acentos",
  "doctor.path.chars": "La ruta del proyecto tiene espacios o acentos: {path}",
  "doctor.path.fix_chars": "Finite Monkey maneja esta ruta; si otra herramienta falla aquí, mueve el proyecto a una ruta sin espacios ni acentos",
  "doctor.path.synced": "El proyecto está en una carpeta sincronizada (OneDrive, Dropbox, iCloud o Google Drive): {path}",
  "doctor.path.fix_synced": "Mueve el proyecto fuera de la carpeta sincronizada para evitar conflictos de sincronización y git lento",
  "doctor.path.wsl_mount": "El proyecto está en un disco de Windows montado en WSL: {path}",
  "doctor.path.fix_wsl_mount": "Mueve el proyecto a la home de Linux (por ejemplo ~/proyectos) para tener git rápido y permisos correctos",
  "hook.failed_closed": "el hook {event} no pudo ejecutarse ({detail}) y bloqueó por seguridad. Ejecuta `finitemonkey doctor`",
  "hook.failed_open": "el hook {event} no pudo ejecutarse ({detail}); se sigue sin él. Ejecuta `finitemonkey doctor`",
  "exit.ok": "0 ok: el comando hizo lo que se pidió",
  "exit.check_failed": "1 revisión fallida: el comando se ejecutó y encontró un problema",
  "exit.usage": "2 error de uso: comando u opción desconocidos, valor inválido o comando aún no disponible",
  "exit.not_configured": "3 no configurado: falta la instalación o un requisito previo (node, git, archivos, permisos)",
  "exit.needs_person": "4 necesita a la persona: se requiere una decisión o aprobación antes de seguir",
  "exit.internal": "5 error interno: el propio Finite Monkey falló; por favor, repórtalo",
  "help.exit_codes": "Códigos de salida",
  "hook.stop_released": "el hook {event} bloquearía otra vez ({detail}), pero Claude Code ya está continuando por un hook de parada, así que deja que la sesión termine. Ejecuta `finitemonkey doctor`",
  "error.needs_confirmation": '"{command}" necesita tu decisión antes de cambiar algo: {question}',
  "secrets.command.scan": "Busca secretos en los archivos, en los cambios preparados o en el historial de git (solo local)",
  "secrets.command.accept": "Acepta un hallazgo en el baseline, con motivo y vencimiento (solo la persona)",
  "secrets.command.incident": "Lista incidentes de secretos, los marca como rotados o cerrados y muestra los pasos para limpiar el historial",
  "secrets.found_item": "{rule} en {where}",
  "secrets.found_more": "y {count} más",
  "secrets.where.line": "línea {line}, columna {column}",
  "secrets.where.file": "{file}:{line}:{column}",
  "secrets.where.new_text": "{file} (línea {line} del texto nuevo)",
  "secrets.block.write": "bloqueado: el texto nuevo de {file} tiene una credencial ({found}). No se escribió nada. Deja el valor en .env (fuera de git) y léelo por el nombre de la variable. Si la clave es real, trátala como expuesta y rótala.",
  "secrets.block.bash": "bloqueado: este comando tiene una credencial ({found}) y no se ejecutó. Lee el valor de una variable de entorno en lugar de escribirlo en el comando. Si la clave es real, trátala como expuesta y rótala.",
  "secrets.block.commit": "bloqueado: los cambios preparados tienen una credencial ({found}), así que el commit no se ejecutó. Quítala de los archivos preparados, déjala en .env (fuera de git) y rótala si es real.",
  "secrets.block.read": "bloqueado: {target} guarda secretos, y leerlo pondría sus valores en la conversación. Pide a la persona los nombres de las variables, o lee .env.example.",
  "secrets.block.env_dump": 'bloqueado: `{command}` imprime todas las variables de entorno, secretos incluidos. Imprime solo la variable que necesitas por su nombre, o comprueba que existe con `test -n "$NAME"`.',
  "secrets.block.person_only": "bloqueado: `{command}` es una decisión de la persona, no del modelo. Pide a la persona que lo ejecute en su propia terminal.",
  "secrets.block.prompt": "tu mensaje no se envió al modelo: tiene una credencial ({found}). Si esta clave se pegó en otro lugar, trátala como expuesta y rótala. Para usarla, ponla en .env y dime solo el nombre de la variable. Nunca pegues claves en el chat. Incidente: {incident}.",
  "secrets.post.context": "Finite Monkey: la salida de {tool} contenía una credencial ({found}). El incidente {incident} está abierto; rotar la clave es decisión de la persona. La salida de Finite Monkey nunca repite el valor.",
  "secrets.incident.unsaved": "no registrado ({detail})",
  "secrets.scan.title": "Búsqueda de secretos ({mode}): {total} hallados, {new} nuevos, {known} conocidos, {expired} vencidos, {fixed} corregidos",
  "secrets.scan.item": "  [{status}] {rule} {where} {mask}  id {id}",
  "secrets.scan.clean": "No se encontraron secretos. El mono se guarda sus bananas.",
  "secrets.accept.done": "Aceptado {id} ({rule} en {where}) como {state} hasta {expires}, por {owner}.",
  "secrets.action.accept": "aceptar un hallazgo",
  "secrets.action.rotated": "marcar un incidente como rotado",
  "secrets.action.close": "cerrar un incidente",
  "secrets.incident.title": "{count} incidente(s)",
  "secrets.incident.item": "  {id}  {state}  {rule}  {where}  desde {created}",
  "secrets.incident.none": "No hay incidentes de secretos.",
  "secrets.incident.marked": "El incidente {id} ahora está {state}.",
  "secrets.purge.title": "Limpieza del historial de {id} ({where}, primer commit {commit}). Estos pasos los ejecutas tú; Finite Monkey nunca los ejecuta:",
  "secrets.purge.step1": "1. Confirma que la clave vieja está revocada en el proveedor y que la nueva funciona en todos los consumidores.",
  "secrets.purge.step2": "2. Fuera del repositorio, escribe un archivo de reemplazos con una línea por valor filtrado: <valor>==>REMOVED. Copia el valor de tus propios registros; Finite Monkey nunca lo guarda ni lo imprime.",
  "secrets.purge.step3": "3. En un clon espejo nuevo, ejecuta: git filter-repo --replace-text <archivo de reemplazos>",
  "secrets.purge.step4": "4. Relaja tú la protección de la rama, envía las refs reescritas, restaura la protección y avisa a quien tenga un clon que vuelva a clonar.",
  "secrets.purge.step5": "5. Cierra el incidente: finitemonkey secrets incident close {id}",
  "secrets.error.found": "{count} hallazgo(s) de secretos fuera del baseline o con aceptación vencida",
  "secrets.error.one_mode": "Elige solo uno entre --staged, --history y --path",
  "secrets.error.git_unavailable": "La búsqueda no pudo leer git ({detail})",
  "secrets.error.baseline_invalid": "El baseline {file} no es válido: {detail}",
  "secrets.error.person_only": "Solo la persona puede {action}, y esto no parece su terminal (sin TTY, o dentro de Claude Code)",
  "secrets.error.reason_required": "--reason es obligatorio: di por qué este hallazgo es aceptable",
  "secrets.error.finding_not_found": "Ningún hallazgo actual tiene el id {id}",
  "secrets.error.incident_not_found": "Ningún incidente tiene el id {id}",
  "secrets.error.not_rotated": "El incidente {id} está {state}: rota la clave en el proveedor primero y luego márcalo como rotado",
  "secrets.error.bad_transition": "El incidente {id} no puede pasar de {from} a {to}",
  "secrets.error.write_failed": "No se pudo escribir {file}: {detail}",
  "install.config.header": "Configuración de Finite Monkey en este proyecto. Versiona este archivo. `finitemonkey update` conserva tus cambios.",
  "install.plan.title": "Plan de Finite Monkey para {root} (preset {preset}):",
  "install.warning": "aviso: {message}",
  "install.warn.not_git": "esta carpeta no está dentro de un repositorio git; se instala aquí de todos modos",
  "install.warn.fail_open": "Claude Code {version} no puede bloquear la acción cuando un hook falla (necesita 2.1.295 o más nueva); los guardas fallan abiertos hasta que actualices Claude Code",
  "install.warn.authority": "{name} ({source}) también decide cuándo puede terminar la sesión; Finite Monkey convive con él y nunca lo desactiva",
  "install.warn.plugin": "el plugin finitemonkey está habilitado ({source}); sus hooks ceden el paso mientras este proyecto tenga sus propios hooks de Finite Monkey",
  "install.warn.foreign": "{path} ya existe y no lo escribió Finite Monkey; quedó intacto (contenido propuesto en el diff)",
  "install.warn.edited": "{path} se editó después de instalar; se conserva tu versión (la plantilla nueva está en el diff)",
  "install.warn.edited_kept": "conservado {path}: lo editaste después de instalar",
  "install.dry_run": "Simulación: no se escribió nada.",
  "install.nothing_to_do": "Ya está al día. Nada que escribir.",
  "install.up_to_date": "Los archivos que gestiona Finite Monkey coinciden con esta versión.",
  "install.confirm_question": "¿aplicar el plan de arriba (cada archivo tocado se respalda antes)?",
  "install.done_init": "Instalado. Abre Claude Code y sigue trabajando: un mono, tiempo finito, trabajo terminado.",
  "install.done_update": "Actualizado. Se conservaron tus cambios.",
  "install.uninstall.title": "Quitando Finite Monkey de {root}:",
  "install.uninstall.keeps_state": ".finitemonkey/ se queda (respaldos y evidencias). Usa --purge para borrarlo también.",
  "install.uninstall.purge": ".finitemonkey/ se borrará, incluidos respaldos y evidencias.",
  "install.uninstall.outside": "No se toca aquí, quítalo tú si lo instalaste: {command}",
  "install.uninstall.question": "¿quitar lo que agregó Finite Monkey y restaurar los respaldos?",
  "install.uninstall.done": "Quitado. El proyecto volvió a como estaba, salvo los archivos que editaste.",
  "error.settings_unreadable": ".claude/settings.json no es JSON válido ({detail}), así que no se cambió",
  "error.lock_unreadable": ".finitemonkey/lock.json no se puede leer ({detail})",
  "error.install_locked": "otra ejecución de finitemonkey tiene {path}",
  "error.install_failed": "no se pudo escribir {path} ({detail}); se restauró cada archivo escrito en esta ejecución",
  "error.not_installed": "Finite Monkey no está instalado en este proyecto (no hay .finitemonkey/lock.json)",
  "error.install_outdated": "los archivos que gestiona Finite Monkey difieren de esta versión",
  "error.invalid_preset": 'Preset desconocido "{preset}". Usa neutral o gabriel',
  "command.gate.summary": "Ejecuta el contrato de terminado y registra la evidencia",
  "command.task_new.summary": "Crea un contrato de terminado para una tarea",
  "command.task_show.summary": "Muestra el contrato de una tarea y su evidencia",
  "command.task_done.summary": "Ejecuta la compuerta y cierra la tarea cuando pasa",
  "error.gate_failed": "La compuerta reprobó: {failed} verificación(es) fallida(s), {unverified} sin verificar",
  "error.gate_incomplete": "La compuerta quedó incompleta: {unverified} verificación(es) sin verificar",
  "error.gate_not_run": "La compuerta no se ejecutó: {detail}",
  "error.not_a_git_repo": "Esta carpeta no está dentro de un repositorio git",
  "error.task_exists": 'La tarea "{task}" ya existe',
  "error.task_invalid": "El contrato de la tarea no es válido: {detail}",
  "error.task_not_found": 'No se encontró la tarea "{task}"',
  "task.created": "Tarea {task} creada en {file}. Ahora es la tarea activa.",
  "task.done": "Tarea {task} terminada: todas las verificaciones pasaron en este árbol.",
  "gate.status.passed": "pasó",
  "gate.status.failed": "reprobó",
  "gate.status.unverified": "sin verificar",
  "gate.report.title": "Compuerta de la tarea {task} en el árbol {tree}",
  "gate.report.title_implicit": "Compuerta de los cambios de esta sesión en el árbol {tree}",
  "gate.report.contract_edited": "El archivo del contrato se editó fuera de Finite Monkey; se usó la versión aprobada.",
  "gate.verdict.passed": "{passed} pasaron, {failed} reprobaron, {unverified} sin verificar. Terminado.",
  "gate.verdict.failed": "{passed} pasaron, {failed} reprobaron, {unverified} sin verificar. No está terminado.",
  "gate.verdict.incomplete": "{passed} pasaron, {failed} reprobaron, {unverified} sin verificar. Aún no probado.",
  "gate.reason.tool_missing": "la herramienta no está instalada",
  "gate.reason.timeout": "se quedó sin tiempo",
  "gate.reason.rate_limited": "límite de uso alcanzado",
  "gate.reason.budget": "el presupuesto de tiempo de la compuerta se agotó",
  "gate.reason.not_implemented": "este tipo de verificación aún no existe en esta versión",
  "gate.reason.no_gh": "gh ausente o sin sesión",
  "gate.reason.network": "la red o GitHub no respondió",
  "gate.reason.pending": "la CI todavía está corriendo",
  "gate.reason.untrusted": "los comandos del contrato no están aprobados en esta máquina",
  "gate.reason.rewriter": "la salida reescrita por otra herramienta no cuenta",
  "gate.reason.awaiting_person": "esperando a la persona",
  "gate.reason.no_evidence": "sin evidencia para el árbol actual",
  "gate.reason.no_baseline": "no se registró línea base",
  "gate.note.untrusted": "los comandos de la tarea {task} aún no están aprobados en esta máquina",
  "gate.note.rewriter": "la salida pasó por un reescritor; solo cuenta la ejecución propia de Finite Monkey",
  "gate.note.budget": "el presupuesto de tiempo se agotó antes de esta verificación",
  "gate.note.tool_missing": "comando no encontrado: {command}",
  "gate.note.timeout": "detenido después de {seconds} s",
  "gate.note.rate_limited": "límite de uso o cuota alcanzado, intente después",
  "gate.note.exit": "salida {code}",
  "gate.note.output": "última línea: {line}",
  "gate.note.new_failure": "falla nueva: {name}",
  "gate.note.baseline": "{count} falla(s) ya fallaba(n) antes de esta sesión (línea base)",
  "gate.note.trivial": '"{command}" no verifica código ni pruebas',
  "gate.note.zero_tests": '"{command}" ejecutó cero casos de prueba',
  "gate.note.tests_ran": "{count} prueba(s) se ejecutaron",
  "gate.note.not_implemented": "la verificación {kind} aún no existe en esta versión",
  "gate.note.released": "liberado por la persona para {guard}: {reason}",
  "gate.tests.test_file_deleted": "archivo de prueba borrado: {file}",
  "gate.tests.test_removed": "prueba eliminada en {file} ({before} → {after})",
  "gate.tests.skip_added": "skip, only o todo nuevo en {file} ({before} → {after})",
  "gate.tests.assertion_removed": "aserción eliminada en {file} ({before} → {after})",
  "gate.tests.snapshot_changed": "snapshot reescrito: {file}",
  "gate.tests.config_changed": "config de prueba o lint cambió: {file}",
  "gate.tests.out_of_scope": "archivo de prueba fuera del alcance de la tarea cambió: {file}",
  "gate.tests.fix": "haga que el código pase las pruebas como estaban",
  "gate.tests.clean": "ninguna prueba eliminada, saltada o debilitada",
  "gate.diff.no_scope": "ningún alcance declarado",
  "gate.diff.outside": "fuera del alcance: {file}",
  "gate.diff.too_many_files": "{count} archivos cambiaron, presupuesto {max}",
  "gate.diff.too_many_lines": "{count} líneas cambiaron, presupuesto {max}",
  "gate.diff.within": "{files} archivo(s), {lines} línea(s), dentro del alcance y del presupuesto",
  "gate.placeholders.clean": "ningún placeholder en el código nuevo",
  "gate.placeholders.found": "placeholder en {file}:{line}",
  "gate.git.uncommitted": "{count} archivo(s) sin commit, primero: {file}",
  "gate.git.no_upstream": "la rama no tiene upstream",
  "gate.git.unpushed": "{count} commit(s) sin enviar",
  "gate.git.no_pr": "ningún pull request abierto para esta rama",
  "gate.git.ok": "{require}: ok",
  "gate.manual.waiting": "esperando que la persona apruebe: {description}",
  "gate.manual.approved": "aprobado por la persona en {at}: {reason}",
  "gate.pr.found": "PR #{number} ({state}) {url}",
  "gate.pr.behind": "la base {base} avanzó por delante de esta rama",
  "gate.pr.stale_head": "el PR #{number} no tiene el último commit local",
  "gate.pr.conflict": "El PR #{number} está en conflicto con `{base}`: la CI no corre mientras haya conflicto",
  "gate.pr.conflict_file": "conflicto en {file}",
  "gate.pr.conflict_next": "siguiente paso seguro: actualizar la rama con `{base}` en un worktree, sin --force, resolviendo por el protocolo de fusión",
  "gate.pr.ci_failed": "verificación de CI falló: {name}",
  "gate.pr.ci_pending": "verificación de CI pendiente: {name}",
  "gate.pr.no_gh": "gh ausente o sin sesión, así que el estado del PR es desconocido",
  "gate.pr.network": "no se pudo leer el PR: {detail}",
  "gate.pr.no_branch": "HEAD separado, sin rama que buscar",
  "gate.pr.none": "ningún PR para la rama {branch}",
  "gate.pr.none_required": "el contrato exige un PR abierto para la rama {branch}",
  "gate.require.command": "`{command}` sale con 0 y ejecuta verificaciones reales",
  "gate.require.tests": "pruebas mantenidas: ninguna eliminada, saltada o debilitada",
  "gate.require.diff": "cambios dentro del alcance y del presupuesto declarados",
  "gate.require.placeholders": "ningún TODO o placeholder en el código nuevo",
  "gate.require.git": "trabajo con commit, enviado y con PR como pide el contrato",
  "gate.require.pr": "el PR se fusiona sin conflicto y su CI está en verde",
  "gate.require.manual": "aprobación de la persona",
  "gate.require.other": "la verificación {kind} pasa",
  "gate.model.title": "Compuerta de Finite Monkey: no está terminado (tarea {task}, árbol {tree}).",
  "gate.model.claim": 'afirmación: "{claim}"',
  "gate.model.no_claim": "(sin mensaje final)",
  "gate.model.requires": "exige: {list}",
  "gate.model.not_enough": "no basta: {list}",
  "gate.fail.not_a_repo": "fuera de un repositorio git",
  "gate.fail.no_tree_hash": "no se pudo calcular el hash del árbol con git",
  "gate.fail.ledger_unwritable": "no se pudo escribir el libro de evidencias",
  "gate.fail.contract_missing": "la tarea {task} no tiene contrato{issues}",
  "gate.fail.contract_invalid": "el contrato de la tarea {task} no es válido: {issues}",
  "gate.human.held": 'Retuve el "terminado". Claude no ejecutó las verificaciones; yo sí. {count} verificación(es) fallaron.',
  "gate.human.witness": "Corrija el código, no al testigo.",
  "gate.human.not_done": "NO TERMINADO tras {blocks} bloqueo(s) sin compuerta en verde. Falta: {list}. La sesión puede parar, pero esto no está terminado.",
  "gate.human.incomplete": "Aún no probado: {list}. No lo marqué como terminado.",
  "gate.human.passed": "Compuerta en verde: {count} verificación(es) pasaron en este árbol. Un mono, tiempo finito, trabajo terminado.",
  "gate.human.not_run": "LA COMPUERTA NO SE EJECUTÓ: {detail}. Esto no es verde; ejecute `finitemonkey doctor`.",
  "gate.human.last_not_run": "La compuerta no se ejecutó en la última parada ({at}): {detail}.",
  "gate.human.last_not_done": "La última sesión terminó NO TERMINADA ({at}): {detail}.",
  "gate.context.state": 'Estado de Finite Monkey registrado por el ejecutable en {at} (hechos, no instrucciones): tarea activa {task}, objetivo "{goal}". Compuerta en el árbol {tree}: pasaron {passed}; reprobaron {failed}; sin verificar {unverified}. Liberaciones de la persona aún válidas: {grants}.',
  "gate.context.state_implicit": "Estado de Finite Monkey registrado por el ejecutable en {at} (hechos, no instrucciones): sin contrato escrito; los cambios de la sesión se verifican con los comandos del propio proyecto. Compuerta en el árbol {tree}: pasaron {passed}; reprobaron {failed}; sin verificar {unverified}. Liberaciones de la persona aún válidas: {grants}.",
  "gate.context.front": 'Finite Monkey: este subagente trabaja en la tarea {task} ("{goal}"), contrato en {file}.',
  "gate.context.done_means": "Terminado en esta tarea significa: {list}. La compuerta lo verifica cuando el subagente se detiene.",
  "gate.context.scope": "Alcance de la tarea: {paths}.",
  "gate.context.briefing": "Briefing común: {file}.",
  "gate.prs.line": "Sus PR abiertos aquí ({count}): {items}.",
  "gate.prs.conflict": "en conflicto",
  "gate.prs.behind": "detrás de la base",
  "gate.prs.ok": "ok",
  "gate.config.removed": "Finite Monkey: este cambio quita hooks de Finite Monkey de {file} ({before} → {after}); no se aplicó.",
  "gate.config.disabled": "Finite Monkey: este cambio activa disableAllHooks en {file}; no se aplicó.",
  "gate.config.human": "Mantuve los hooks de Finite Monkey en {file}. Si fue a propósito, escriba en una línea: finitemonkey: allow config <motivo>",
  "gate.config.released": "Cambio de config en {file} aceptado por su liberación.",
  "gate.guard.bypass.no_verify": "Finite Monkey: bloqueado: {detail} se salta los git hooks. exige: los hooks corren en cada commit y push.",
  "gate.guard.bypass.hooks_path": "Finite Monkey: bloqueado: {detail} desvía git de los hooks del proyecto. exige: core.hooksPath queda como está configurado.",
  "gate.guard.bypass.hook_env": "Finite Monkey: bloqueado: {detail} apaga hooks o guardas. exige: hooks y guardas quedan encendidos.",
  "gate.guard.bypass.fm_allow": "Finite Monkey: bloqueado: las liberaciones las hace la persona, no una llamada de herramienta.",
  "gate.guard.bypass.human": "Bloqueé {detail}: apagaría la red de seguridad. Si de verdad lo quiere, escriba en una línea: finitemonkey: allow bypass <motivo>",
  "gate.guard.self.policy": "Finite Monkey: bloqueado: {file} solo lo escribe el ejecutable finitemonkey (evidencia, política y estado). exige: cambiarlo con los comandos de finitemonkey.",
  "gate.guard.self.allow_store": "Finite Monkey: bloqueado: {file} registra lo que la persona liberó; ninguna herramienta lo escribe.",
  "gate.guard.self.human": "Dejé {file} fuera de alcance: el mono no corrige su propio examen.",
  "gate.guard.tests.model": "Finite Monkey: bloqueado: {detail}. exige: hacer que el código pase las pruebas como están.",
  "gate.guard.tests.shell": "un comando de shell escribe o borra {file}",
  "gate.guard.tests.human": "Bloqueado: {detail}. La prueba es el único testigo que tenemos. Corrija el código, no al testigo. Si el cambio es a propósito, escriba en una línea: finitemonkey: allow tests <motivo>",
  "gate.release.allowed": "Liberé {guard} hasta {until}, a su pedido.",
  "gate.release.unknown_guard": "No existe una guarda llamada {guard} para liberar.",
  "gate.release.approved": "Registré su aprobación de {task}/{check}.",
  "gate.release.trusted": "Aprobé los comandos de {task} en esta máquina.",
  "gate.release.trust_failed": "No se pudo aprobar {task}: no se encontró contrato válido.",
  "gate.skipped.no_repo": "No es un repositorio git: nada que verificar.",
  "gate.skipped.no_changes": "Ningún cambio en el árbol: nada que verificar.",
  "gate.skipped.no_session_edits": "Esta sesión no cambió el árbol: nada que verificar.",
  "gate.baseline.recorded": "Registré la línea base de las verificaciones que ya fallaban.{reason}",
  "gate.baseline.skipped": "Línea base no registrada: {reason}.",
  "gate.secrets.unavailable": "no se pudieron revisar los cambios en busca de secretos (git no disponible)",
  "gate.secrets.finding": "secreto {rule} en {file}:{line}",
  "gate.secrets.incident": "incidente de secreto {id} está {state}",
  "gate.secrets.clean": "ningún secreto nuevo en los cambios y ningún incidente abierto",
  "gate.require.secrets": "ningún secreto nuevo y ningún incidente de secreto abierto",
  "git.command.snapshot": "Guarda el árbol de trabajo, el índice y los archivos sin seguimiento en una ref de respaldo sin tocarlos",
  "git.command.undo": "Lista las instantáneas o restaura una, por defecto en un worktree nuevo",
  "git.command.rescue": "Lista commits perdidos por el reflog y el fsck, y restaura uno en una rama nueva",
  "git.command.merge_verify": "Comprueba que una fusión conservó cada cambio de los dos lados",
  "git.block.force_push": "bloqueado: `{command}` reescribe la rama remota y puede borrar commits que otra persona subió. Trae e integra los commits remotos y sube normalmente. En tu propia rama después de un rebase, usa `git push --force-with-lease=<rama>:<sha esperado> --force-if-includes`.",
  "git.block.lease_not_own": "bloqueado: `{command}` fuerza un push sobre {subject}, que no es la rama en la que trabajas o está protegida. El push forzado solo vale en tu propia rama, con lease explícito.",
  "git.block.push_delete": "bloqueado: `{command}` borra {subject} en el remoto. Borrar una rama remota le toca a la persona.",
  "git.block.push_mirror": "bloqueado: `{command}` sobrescribe todas las refs del remoto y publicaría las refs de respaldo. Sube por nombre la rama que necesitas.",
  "git.block.clean": "bloqueado: `{command}` borra para siempre archivos sin seguimiento, que no están en ningún commit. Corre `git clean -n` para ver la lista y mueve lo que deba irse a .finitemonkey/trash/, o pregunta a la persona.",
  "git.block.stash_drop": "bloqueado: `{command}` tira trabajo guardado en el stash que no existe en otro lugar. Aplícalo con `git stash apply` o déjalo; descartar un stash le toca a la persona.",
  "git.block.branch_unmerged": "bloqueado: `{command}` borra {subject}, cuyos commits no están en su upstream ni en la rama por defecto. Súbela o fusiónala antes; `git branch -d` funciona cuando ya está fusionada.",
  "git.block.worktree_force": "bloqueado: `{command}` elimina un worktree aunque tenga cambios sin commit. Haz commit o archiva su trabajo antes; `git worktree remove` sin forzar rechaza un árbol sucio a propósito.",
  "git.block.rm_worktree": "bloqueado: `{command}` borra {subject}, que es un worktree o repositorio git; el trabajo sin commit se perdería. Haz commit o archívalo y luego usa `git worktree remove` sin --force.",
  "git.block.rm_root": "bloqueado: `{command}` borra de forma recursiva {subject}, una carpeta raíz o la carpeta personal. Indica la carpeta exacta a eliminar.",
  "git.block.rebase_protected": "bloqueado: `{command}` reescribe {subject}, una rama protegida. Cámbiala con un pull request.",
  "git.block.rebase_shared": "bloqueado: `{command}` reescribe {subject}, que ya tiene commits de otra persona en el remoto. Fusiona la base en ella en lugar de hacer rebase.",
  "git.block.merge_side": "bloqueado: `{command}` resuelve conflictos tomando un lado entero ({subject}), lo que descarta en silencio los cambios del otro lado. Resuelve cada conflicto a mano y corre `finitemonkey merge verify` antes del commit.",
  "git.block.history": "bloqueado: `{command}` borra historial o entradas del reflog de las que dependen undo y rescue. Reescribir el historial le toca a la persona.",
  "git.block.protected_commit": "bloqueado: `{command}` haría commit directo en {subject}, una rama protegida. Crea una rama con `git switch -c <tipo>/<nombre>` y abre un pull request.",
  "git.block.protected_push": "bloqueado: `{command}` sube a {subject}, una rama protegida. Sube tu propia rama y abre un pull request.",
  "git.block.foreign": "bloqueado: `{command}` descartaría cambios que esta sesión no hizo: {files}. Deshaz solo tus líneas con Edit.",
  "git.foreign.before": "{path} (tenía cambios antes de que empezaras)",
  "git.foreign.other": "{path} (cambiado fuera de esta sesión)",
  "git.block.unknown": "bloqueado: `{command}` descarta cambios y `git status` falló, así que no hay forma de saber de quién son. Arregla el repositorio e inténtalo de nuevo.",
  "git.block.snapshot_failed": "bloqueado: `{command}` es arriesgado y la instantánea de seguridad previa falló ({detail}), así que no se ejecutó. Corrige la causa e inténtalo de nuevo.",
  "git.snapshot.context": "finitemonkey guardó una instantánea antes de `{command}`: {ref}. `finitemonkey undo {ref}` devuelve el estado anterior.",
  "prod.block.effect": "bloqueado: `{command}` cambia producción ({target}) a mano, y un servidor editado a mano se aparta del repositorio. Cámbialo por el camino de deploy ({deploy}): commit, pull request y que corra el deploy.",
  "prod.block.interactive": "bloqueado: `{command}` abre una sesión interactiva en producción ({target}), donde nada de lo que se escriba se revisa antes. Corre un comando de solo lectura a la vez, como `ssh {target} docker ps`.",
  "prod.deploy.unknown": "el deploy declarado del proyecto",
  "git.snapshot.done": "instantánea guardada: {ref} ({commit}). `finitemonkey undo {ref}` la restaura.",
  "git.undo.list_title": "{count} instantánea(s), de la más nueva a la más vieja:",
  "git.undo.list_item": "{index}. {at}  {op}  {ref}",
  "git.undo.worktree": "{ref} restaurada en un worktree nuevo en {path}. Compárala con tu árbol y copia lo que necesites; `git worktree remove {path}` lo elimina. El estado anterior a este undo está en {backup}.",
  "git.undo.in_place": "{ref} restaurada en su lugar. El estado anterior a este undo está en {backup}; `finitemonkey undo {backup}` lo devuelve.",
  "git.undo.confirm": "restaurar en su lugar sobrescribe el árbol de trabajo y el índice. Córrelo tú con --in-place --yes para confirmar.",
  "git.rescue.title": "candidatos a recuperación (solo lectura, nada cambió):",
  "git.rescue.reflog": "reflog {ref}: {sha} {when} {subject}",
  "git.rescue.dangling": "commit perdido {sha} {when} {subject}",
  "git.rescue.blobs": "{count} contenido(s) de archivo preparado(s) están perdidos pero se pueden recuperar; `git fsck --lost-found` los escribe en .git/lost-found/other.",
  "git.rescue.never_staged": "un archivo que nunca se preparó ni se hizo commit no se recupera con git.",
  "git.rescue.next": "restaura uno con `finitemonkey rescue --restore <sha> --branch <nombre>`.",
  "git.rescue.restored": "rama {branch} creada en {sha}.",
  "git.merge.ok": "nada se perdió: {files} archivo(s) revisado(s) entre {base} y {result}, {justified} descarte(s) justificado(s).",
  "git.merge.lost": "{count} cambio(s) perdido(s) entre {base} y {result}:",
  "git.merge.finding": "{where} [{kind}] {side}: {text}",
  "git.merge.limits": "esto prueba que los cambios están, no que el código fusionado funcione; las pruebas de los dos lados siguen siendo obligatorias.",
  "git.merge.none": "ninguna fusión que revisar: {detail}",
  "git.error.snapshot_failed": "la instantánea falló: {detail}",
  "git.error.nothing_to_undo": "no se encontró ninguna instantánea para {ref}.",
  "git.error.undo_failed": "el undo falló: {detail}",
  "git.error.rescue_failed": "rescue falló: {detail}",
  "git.error.merge_lost": "{count} cambio(s) se perdieron en la fusión y no están justificados en la lista de descartes.",
  "git.error.merge_unanalyzable": "no se pudo analizar la fusión: {detail}",
  "gate.require.worktree": "todo archivo cambiado en la sesión con commit, y los commits enviados o con destino declarado",
  "gate.require.merge": "toda fusión desde el inicio mantuvo los cambios de ambos lados",
  "gate.worktree.unavailable": "no se pudo leer el estado git del worktree",
  "gate.worktree.dirty": "archivos cambiados en esta sesión sin commit: {files}",
  "gate.worktree.unpushed": "{count} commit(s) en {branch} existen solo en esta máquina",
  "gate.worktree.clean": "los cambios de la sesión tienen commit y están enviados",
  "gate.merge.unavailable": "no se pudieron leer las fusiones de la sesión",
  "gate.merge.unanalyzed": "la fusión {commit} no se pudo analizar: {detail}",
  "gate.merge.lost": "la fusión {commit} perdió cambios: {findings}",
  "gate.merge.clean": "{count} fusión(es) revisada(s), no se perdió nada"
};

// src/i18n/pt-BR.json
var pt_BR_default = {
  "command.init.summary": "Instala o Finite Monkey neste projeto",
  "command.doctor.summary": "Confere o ambiente e diz como corrigir cada problema",
  "command.update.summary": "Atualiza os arquivos que o Finite Monkey gerou",
  "command.uninstall.summary": "Remove o Finite Monkey deste projeto",
  "command.i18n_check.summary": "Confere se os catálogos pt-BR, en e es batem",
  "command.hook.summary": "Responde a um evento de hook do Claude Code (lê JSON da entrada padrão)",
  "command.version.summary": "Mostra a versão",
  "command.help.summary": "Mostra comandos e opções",
  "help.tagline": "Infinite monkeys not required.",
  "help.usage": "Uso",
  "help.command": "comando",
  "help.commands": "Comandos",
  "help.flags": "Opções globais",
  "help.options": "Opções",
  "help.planned": "(ainda não disponível)",
  "help.more": "Rode `finitemonkey help <comando>` para detalhes. Use --json para saída legível por máquina.",
  "flag.json": "Imprime um objeto JSON (schemaVersion 1) no lugar de texto",
  "flag.lang": "Idioma das mensagens",
  "flag.yes": "Responde sim às confirmações",
  "flag.dry_run": "Mostra o que mudaria sem mudar nada",
  "flag.version": "Mostra a versão",
  "flag.help": "Mostra a ajuda",
  "output.error": "erro: {message}",
  "output.fix": "como corrigir: {fix}",
  "output.next": "próximo passo: {next}",
  "error.internal": "O Finite Monkey falhou de forma inesperada: {detail}",
  "error.invalid_arguments": "Argumentos inválidos: {detail}",
  "error.unexpected_argument": 'Argumento inesperado "{argument}"',
  "error.unknown_command": 'Comando desconhecido "{command}"',
  "error.unknown_command_suggest": 'Comando desconhecido "{command}". Você quis dizer "{suggestion}"?',
  "error.not_implemented": '"{command}" ainda não está disponível nesta versão',
  "error.invalid_lang": 'Idioma não suportado "{lang}". Use um destes: {languages}',
  "error.i18n_catalog_unreadable": "Não foi possível ler o catálogo {file}: {detail}",
  "error.i18n_mismatch": "{count} problema(s) nos catálogos",
  "error.doctor_failed": "{count} verificação(ões) falharam",
  "error.unknown_hook_event": 'Evento de hook desconhecido "{event}". Use um destes: {events}',
  "i18n.summary": "Idiomas: {languages}. Chaves: {keys}.",
  "i18n.ok": "Todos os catálogos batem.",
  "i18n.fix": "Edite os catálogos em {file} para que todos os idiomas tenham as mesmas chaves e os mesmos marcadores",
  "i18n.problem.missing": "chave faltando",
  "i18n.problem.extra": "chave que não existe no en.json",
  "i18n.problem.placeholder": "marcadores diferentes (esperado: {expected}; encontrado: {actual})",
  "i18n.problem.empty": "texto vazio",
  "i18n.problem.not_string": "valor não é texto",
  "doctor.title": "finitemonkey doctor ({version})",
  "doctor.summary": "{ok} ok, {warn} aviso(s), {fail} falha(s)",
  "doctor.node.ok": "Node.js {version}",
  "doctor.node.old": "Node.js {version} é mais antigo que o mínimo {min}",
  "doctor.node.fix": "Instale o Node.js 20 ou mais novo em https://nodejs.org",
  "doctor.git.ok": "git {version}",
  "doctor.git.missing": "git não foi encontrado",
  "doctor.git.fix": "Instale o git em https://git-scm.com/downloads",
  "doctor.git.old": "git {version} é mais antigo que {min}; alguns comandos vão precisar de um git mais novo",
  "doctor.git.fix_old": "Atualize o git para {min} ou mais novo",
  "doctor.claude.ok": "Claude Code {version}",
  "doctor.claude.missing": "Claude Code não foi encontrado; a CLI funciona sem ele, os hooks precisam dele",
  "doctor.claude.fix": "Instale o Claude Code: npm install -g @anthropic-ai/claude-code",
  "doctor.claude.timeout": "`claude --version` não respondeu a tempo",
  "doctor.claude.fix_timeout": "Rode `claude --version` à mão e confira se ele responde",
  "doctor.os.linux": "Linux",
  "doctor.os.wsl": "Linux no WSL",
  "doctor.os.macos": "macOS",
  "doctor.os.windows": "Windows (nativo)",
  "doctor.os.other": "Sistema não reconhecido ({platform})",
  "doctor.path.plain": "O caminho do projeto não tem espaço nem acento",
  "doctor.path.chars": "O caminho do projeto tem espaço ou acento: {path}",
  "doctor.path.fix_chars": "O Finite Monkey lida com este caminho; se outra ferramenta falhar aqui, mova o projeto para um caminho sem espaço nem acento",
  "doctor.path.synced": "O projeto está numa pasta sincronizada (OneDrive, Dropbox, iCloud ou Google Drive): {path}",
  "doctor.path.fix_synced": "Mova o projeto para fora da pasta sincronizada para evitar conflito de sincronização e git lento",
  "doctor.path.wsl_mount": "O projeto está num disco do Windows montado no WSL: {path}",
  "doctor.path.fix_wsl_mount": "Mova o projeto para a home do Linux (por exemplo ~/projetos) para ter git rápido e permissões corretas",
  "hook.failed_closed": "o hook {event} não conseguiu rodar ({detail}) e bloqueou por segurança. Rode `finitemonkey doctor`",
  "hook.failed_open": "o hook {event} não conseguiu rodar ({detail}); seguindo sem ele. Rode `finitemonkey doctor`",
  "exit.ok": "0 ok: o comando fez o que foi pedido",
  "exit.check_failed": "1 verificação reprovada: o comando rodou e achou um problema",
  "exit.usage": "2 erro de uso: comando ou opção desconhecidos, valor inválido ou comando ainda não disponível",
  "exit.not_configured": "3 não configurado: falta instalação ou um pré-requisito (node, git, arquivos, permissões)",
  "exit.needs_person": "4 precisa da pessoa: uma decisão ou aprovação é necessária antes de seguir",
  "exit.internal": "5 erro interno: o próprio Finite Monkey falhou; por favor, reporte",
  "help.exit_codes": "Códigos de saída",
  "hook.stop_released": "o hook {event} bloquearia de novo ({detail}), mas o Claude Code já está continuando por causa de um hook de parada, então ele deixa a sessão parar. Rode `finitemonkey doctor`",
  "error.needs_confirmation": '"{command}" precisa da sua decisão antes de mudar qualquer coisa: {question}',
  "secrets.command.scan": "Procura segredos nos arquivos, nas mudanças preparadas ou no histórico do git (só local)",
  "secrets.command.accept": "Aceita um achado no baseline, com motivo e validade (só a pessoa)",
  "secrets.command.incident": "Lista incidentes de segredo, marca como rotacionado ou fechado e mostra os passos de limpeza do histórico",
  "secrets.found_item": "{rule} em {where}",
  "secrets.found_more": "e mais {count}",
  "secrets.where.line": "linha {line}, coluna {column}",
  "secrets.where.file": "{file}:{line}:{column}",
  "secrets.where.new_text": "{file} (linha {line} do texto novo)",
  "secrets.block.write": "bloqueado: o texto novo de {file} tem uma credencial ({found}). Nada foi gravado. Deixe o valor no .env (fora do git) e leia pelo nome da variável. Se a chave é real, trate como exposta e troque.",
  "secrets.block.bash": "bloqueado: este comando tem uma credencial ({found}) e não rodou. Leia o valor de uma variável de ambiente em vez de escrevê-lo no comando. Se a chave é real, trate como exposta e troque.",
  "secrets.block.commit": "bloqueado: as mudanças preparadas têm uma credencial ({found}), então o commit não rodou. Tire-a dos arquivos preparados, deixe no .env (fora do git) e troque a chave se for real.",
  "secrets.block.read": "bloqueado: {target} guarda segredos, e lê-lo colocaria os valores na conversa. Peça à pessoa os nomes das variáveis, ou leia o .env.example.",
  "secrets.block.env_dump": 'bloqueado: `{command}` imprime todas as variáveis de ambiente, segredos inclusive. Imprima só a variável que precisa, pelo nome, ou confira que ela existe com `test -n "$NAME"`.',
  "secrets.block.person_only": "bloqueado: `{command}` é decisão da pessoa, não do modelo. Peça à pessoa que rode no terminal dela.",
  "secrets.block.prompt": "sua mensagem não foi enviada ao modelo: ela tem uma credencial ({found}). Se essa chave foi colada em outro lugar, trate como exposta e troque. Para usá-la, ponha no .env e me diga só o nome da variável. Nunca cole chaves na conversa. Incidente: {incident}.",
  "secrets.post.context": "Finite Monkey: a saída de {tool} continha uma credencial ({found}). O incidente {incident} está aberto; trocar a chave é decisão da pessoa. A saída do Finite Monkey nunca repete o valor.",
  "secrets.incident.unsaved": "não registrado ({detail})",
  "secrets.scan.title": "Varredura de segredos ({mode}): {total} achados, {new} novos, {known} conhecidos, {expired} vencidos, {fixed} corrigidos",
  "secrets.scan.item": "  [{status}] {rule} {where} {mask}  id {id}",
  "secrets.scan.clean": "Nenhum segredo encontrado. O macaco guarda as bananas para si.",
  "secrets.accept.done": "Aceito {id} ({rule} em {where}) como {state} até {expires}, por {owner}.",
  "secrets.action.accept": "aceitar um achado",
  "secrets.action.rotated": "marcar um incidente como rotacionado",
  "secrets.action.close": "fechar um incidente",
  "secrets.incident.title": "{count} incidente(s)",
  "secrets.incident.item": "  {id}  {state}  {rule}  {where}  desde {created}",
  "secrets.incident.none": "Nenhum incidente de segredo.",
  "secrets.incident.marked": "O incidente {id} agora está {state}.",
  "secrets.purge.title": "Limpeza do histórico de {id} ({where}, primeiro commit {commit}). Quem roda estes passos é você; o Finite Monkey nunca os roda:",
  "secrets.purge.step1": "1. Confirme que a chave antiga foi revogada no provedor e que a nova funciona em todos os consumidores.",
  "secrets.purge.step2": "2. Fora do repositório, escreva um arquivo de substituições com uma linha por valor vazado: <valor>==>REMOVED. Copie o valor dos seus registros; o Finite Monkey nunca o guarda nem imprime.",
  "secrets.purge.step3": "3. Num clone espelho novo, rode: git filter-repo --replace-text <arquivo de substituições>",
  "secrets.purge.step4": "4. Afrouxe a proteção da branch você mesmo, envie as refs reescritas, restaure a proteção e avise quem tem clone para clonar de novo.",
  "secrets.purge.step5": "5. Feche o incidente: finitemonkey secrets incident close {id}",
  "secrets.error.found": "{count} achado(s) de segredo fora do baseline ou com aceite vencido",
  "secrets.error.one_mode": "Escolha só um entre --staged, --history e --path",
  "secrets.error.git_unavailable": "A varredura não conseguiu ler o git ({detail})",
  "secrets.error.baseline_invalid": "O baseline {file} é inválido: {detail}",
  "secrets.error.person_only": "Só a pessoa pode {action}, e isto não parece o terminal dela (sem TTY, ou rodando dentro do Claude Code)",
  "secrets.error.reason_required": "--reason é obrigatório: diga por que este achado é aceitável",
  "secrets.error.finding_not_found": "Nenhum achado atual tem o id {id}",
  "secrets.error.incident_not_found": "Nenhum incidente tem o id {id}",
  "secrets.error.not_rotated": "O incidente {id} está {state}: troque a chave no provedor primeiro e depois marque como rotacionado",
  "secrets.error.bad_transition": "O incidente {id} não pode ir de {from} para {to}",
  "secrets.error.write_failed": "Não foi possível gravar {file}: {detail}",
  "install.config.header": "Configuração do Finite Monkey neste projeto. Versione este arquivo. O `finitemonkey update` mantém suas edições.",
  "install.plan.title": "Plano do Finite Monkey para {root} (preset {preset}):",
  "install.warning": "aviso: {message}",
  "install.warn.not_git": "esta pasta não está dentro de um repositório git; instalando aqui mesmo assim",
  "install.warn.fail_open": "o Claude Code {version} não consegue barrar a ação quando um hook quebra (precisa da 2.1.295 ou mais nova); as travas falham abertas até você atualizar o Claude Code",
  "install.warn.authority": "{name} ({source}) também decide quando a sessão pode parar; o Finite Monkey convive com ele e nunca o desliga",
  "install.warn.plugin": "o plugin finitemonkey está habilitado ({source}); os hooks dele cedem a vez enquanto este projeto tiver os próprios hooks do Finite Monkey",
  "install.warn.foreign": "{path} já existe e não foi escrito pelo Finite Monkey; ficou intocado (conteúdo proposto no diff)",
  "install.warn.edited": "{path} foi editado depois da instalação; sua versão foi mantida (o modelo novo está no diff)",
  "install.warn.edited_kept": "mantido {path}: você o editou depois da instalação",
  "install.dry_run": "Simulação: nada foi gravado.",
  "install.nothing_to_do": "Já está em dia. Nada a gravar.",
  "install.up_to_date": "Os arquivos que o Finite Monkey gerencia batem com esta versão.",
  "install.confirm_question": "aplicar o plano acima (todo arquivo tocado ganha backup antes)?",
  "install.done_init": "Instalado. Abra o Claude Code e siga trabalhando: um macaco, tempo finito, trabalho terminado.",
  "install.done_update": "Atualizado. Suas edições foram mantidas.",
  "install.uninstall.title": "Removendo o Finite Monkey de {root}:",
  "install.uninstall.keeps_state": ".finitemonkey/ fica (backups e evidências). Use --purge para apagar também.",
  "install.uninstall.purge": ".finitemonkey/ será apagado, inclusive backups e evidências.",
  "install.uninstall.outside": "Não mexido aqui, remova você mesmo se instalou: {command}",
  "install.uninstall.question": "remover o que o Finite Monkey acrescentou e restaurar os backups?",
  "install.uninstall.done": "Removido. O projeto voltou ao que era, exceto os arquivos que você editou.",
  "error.settings_unreadable": ".claude/settings.json não é JSON válido ({detail}), então não foi alterado",
  "error.lock_unreadable": ".finitemonkey/lock.json está ilegível ({detail})",
  "error.install_locked": "outra execução do finitemonkey está segurando {path}",
  "error.install_failed": "não foi possível gravar {path} ({detail}); todo arquivo gravado nesta execução foi restaurado",
  "error.not_installed": "O Finite Monkey não está instalado neste projeto (sem .finitemonkey/lock.json)",
  "error.install_outdated": "os arquivos que o Finite Monkey gerencia diferem desta versão",
  "error.invalid_preset": 'Preset desconhecido "{preset}". Use neutral ou gabriel',
  "command.gate.summary": "Roda o contrato de pronto e grava a evidência",
  "command.task_new.summary": "Cria um contrato de pronto para uma tarefa",
  "command.task_show.summary": "Mostra o contrato de uma tarefa e a evidência dele",
  "command.task_done.summary": "Roda o portão e fecha a tarefa quando passa",
  "error.gate_failed": "O portão reprovou: {failed} checagem(ns) reprovada(s), {unverified} não verificada(s)",
  "error.gate_incomplete": "O portão ficou incompleto: {unverified} checagem(ns) não verificada(s)",
  "error.gate_not_run": "O portão não rodou: {detail}",
  "error.not_a_git_repo": "Esta pasta não está dentro de um repositório git",
  "error.task_exists": 'A tarefa "{task}" já existe',
  "error.task_invalid": "O contrato da tarefa é inválido: {detail}",
  "error.task_not_found": 'A tarefa "{task}" não foi encontrada',
  "task.created": "Tarefa {task} criada em {file}. Ela é a tarefa ativa agora.",
  "task.done": "Tarefa {task} concluída: todas as checagens passaram nesta árvore.",
  "gate.status.passed": "passou",
  "gate.status.failed": "reprovou",
  "gate.status.unverified": "não verificado",
  "gate.report.title": "Portão da tarefa {task} na árvore {tree}",
  "gate.report.title_implicit": "Portão das mudanças desta sessão na árvore {tree}",
  "gate.report.contract_edited": "O arquivo do contrato foi editado fora do Finite Monkey; valeu a versão aprovada.",
  "gate.verdict.passed": "{passed} passaram, {failed} reprovaram, {unverified} não verificadas. Pronto.",
  "gate.verdict.failed": "{passed} passaram, {failed} reprovaram, {unverified} não verificadas. Não está pronto.",
  "gate.verdict.incomplete": "{passed} passaram, {failed} reprovaram, {unverified} não verificadas. Ainda não provado.",
  "gate.reason.tool_missing": "a ferramenta não está instalada",
  "gate.reason.timeout": "estourou o tempo",
  "gate.reason.rate_limited": "limite de uso atingido",
  "gate.reason.budget": "o orçamento de tempo do portão acabou",
  "gate.reason.not_implemented": "este tipo de checagem ainda não existe nesta versão",
  "gate.reason.no_gh": "gh ausente ou sem login",
  "gate.reason.network": "a rede ou o GitHub não respondeu",
  "gate.reason.pending": "a CI ainda está rodando",
  "gate.reason.untrusted": "os comandos do contrato não foram aprovados nesta máquina",
  "gate.reason.rewriter": "saída reescrita por outra ferramenta não conta",
  "gate.reason.awaiting_person": "esperando a pessoa",
  "gate.reason.no_evidence": "sem evidência para a árvore atual",
  "gate.reason.no_baseline": "nenhuma linha de base foi gravada",
  "gate.note.untrusted": "os comandos da tarefa {task} ainda não foram aprovados nesta máquina",
  "gate.note.rewriter": "a saída passou por um reescritor; só conta a execução do próprio Finite Monkey",
  "gate.note.budget": "o orçamento de tempo do portão acabou antes desta checagem",
  "gate.note.tool_missing": "comando não encontrado: {command}",
  "gate.note.timeout": "parado depois de {seconds} s",
  "gate.note.rate_limited": "limite de uso ou cota atingido, tente depois",
  "gate.note.exit": "saída {code}",
  "gate.note.output": "última linha: {line}",
  "gate.note.new_failure": "falha nova: {name}",
  "gate.note.baseline": "{count} falha(s) já falhava(m) antes desta sessão (linha de base)",
  "gate.note.trivial": '"{command}" não confere código nem teste',
  "gate.note.zero_tests": '"{command}" rodou zero casos de teste',
  "gate.note.tests_ran": "{count} teste(s) rodaram",
  "gate.note.not_implemented": "a checagem {kind} ainda não existe nesta versão",
  "gate.note.released": "liberado pela pessoa para {guard}: {reason}",
  "gate.tests.test_file_deleted": "arquivo de teste apagado: {file}",
  "gate.tests.test_removed": "teste removido em {file} ({before} → {after})",
  "gate.tests.skip_added": "skip, only ou todo novo em {file} ({before} → {after})",
  "gate.tests.assertion_removed": "asserção removida em {file} ({before} → {after})",
  "gate.tests.snapshot_changed": "snapshot reescrito: {file}",
  "gate.tests.config_changed": "config de teste ou lint mudou: {file}",
  "gate.tests.out_of_scope": "arquivo de teste fora do escopo da tarefa mudou: {file}",
  "gate.tests.fix": "faça o código passar nos testes como eram",
  "gate.tests.clean": "nenhum teste removido, pulado ou enfraquecido",
  "gate.diff.no_scope": "nenhum escopo declarado",
  "gate.diff.outside": "fora do escopo: {file}",
  "gate.diff.too_many_files": "{count} arquivos mudaram, orçamento {max}",
  "gate.diff.too_many_lines": "{count} linhas mudaram, orçamento {max}",
  "gate.diff.within": "{files} arquivo(s), {lines} linha(s), dentro do escopo e do orçamento",
  "gate.placeholders.clean": "nenhum placeholder no código novo",
  "gate.placeholders.found": "placeholder em {file}:{line}",
  "gate.git.uncommitted": "{count} arquivo(s) sem commit, primeiro: {file}",
  "gate.git.no_upstream": "a branch não tem upstream",
  "gate.git.unpushed": "{count} commit(s) não enviado(s)",
  "gate.git.no_pr": "nenhum pull request aberto para esta branch",
  "gate.git.ok": "{require}: ok",
  "gate.manual.waiting": "esperando a pessoa aprovar: {description}",
  "gate.manual.approved": "aprovado pela pessoa em {at}: {reason}",
  "gate.pr.found": "PR #{number} ({state}) {url}",
  "gate.pr.behind": "a base {base} andou à frente desta branch",
  "gate.pr.stale_head": "o PR #{number} não tem o último commit local",
  "gate.pr.conflict": "PR #{number} está em conflito com `{base}`: a CI não roda enquanto houver conflito",
  "gate.pr.conflict_file": "conflito em {file}",
  "gate.pr.conflict_next": "próximo passo seguro: atualizar a branch com `{base}` num worktree, sem --force, resolvendo pelo protocolo de mescla",
  "gate.pr.ci_failed": "checagem de CI reprovou: {name}",
  "gate.pr.ci_pending": "checagem de CI pendente: {name}",
  "gate.pr.no_gh": "gh ausente ou sem login, então o estado do PR é desconhecido",
  "gate.pr.network": "não deu para ler o PR: {detail}",
  "gate.pr.no_branch": "HEAD solto, sem branch para procurar",
  "gate.pr.none": "nenhum PR para a branch {branch}",
  "gate.pr.none_required": "o contrato exige um PR aberto para a branch {branch}",
  "gate.require.command": "`{command}` sai com 0 e roda checagens reais",
  "gate.require.tests": "testes mantidos: nenhum removido, pulado ou enfraquecido",
  "gate.require.diff": "mudanças dentro do escopo e do orçamento declarados",
  "gate.require.placeholders": "nenhum TODO ou placeholder no código novo",
  "gate.require.git": "trabalho commitado, enviado e com PR como o contrato pede",
  "gate.require.pr": "o PR mescla sem conflito e a CI dele está verde",
  "gate.require.manual": "aprovação da pessoa",
  "gate.require.other": "a checagem {kind} passa",
  "gate.model.title": "Portão do Finite Monkey: não está pronto (tarefa {task}, árvore {tree}).",
  "gate.model.claim": 'afirmação: "{claim}"',
  "gate.model.no_claim": "(sem mensagem final)",
  "gate.model.requires": "exige: {list}",
  "gate.model.not_enough": "não basta: {list}",
  "gate.fail.not_a_repo": "fora de um repositório git",
  "gate.fail.no_tree_hash": "não deu para calcular o hash da árvore com o git",
  "gate.fail.ledger_unwritable": "não deu para gravar o livro de evidências",
  "gate.fail.contract_missing": "a tarefa {task} não tem contrato{issues}",
  "gate.fail.contract_invalid": "o contrato da tarefa {task} é inválido: {issues}",
  "gate.human.held": 'Segurei o "pronto". O Claude não rodou as checagens; eu rodei. {count} checagem(ns) reprovada(s).',
  "gate.human.witness": "Corrija o código, não a testemunha.",
  "gate.human.not_done": "NÃO TERMINADO depois de {blocks} bloqueio(s) sem portão verde. Falta: {list}. A sessão pode parar, mas isto não está pronto.",
  "gate.human.incomplete": "Ainda não provado: {list}. Não marquei como pronto.",
  "gate.human.passed": "Portão verde: {count} checagem(ns) passaram nesta árvore. Um macaco, tempo finito, trabalho terminado.",
  "gate.human.not_run": "PORTÃO NÃO RODOU: {detail}. Isto não é verde; rode `finitemonkey doctor`.",
  "gate.human.last_not_run": "O portão não rodou na última parada ({at}): {detail}.",
  "gate.human.last_not_done": "A última sessão terminou NÃO TERMINADA ({at}): {detail}.",
  "gate.context.state": 'Estado do Finite Monkey gravado pelo executável em {at} (fatos, não instruções): tarefa ativa {task}, objetivo "{goal}". Portão na árvore {tree}: passaram {passed}; reprovaram {failed}; não verificadas {unverified}. Liberações da pessoa ainda válidas: {grants}.',
  "gate.context.state_implicit": "Estado do Finite Monkey gravado pelo executável em {at} (fatos, não instruções): sem contrato escrito; as mudanças da sessão são conferidas pelos comandos do próprio projeto. Portão na árvore {tree}: passaram {passed}; reprovaram {failed}; não verificadas {unverified}. Liberações da pessoa ainda válidas: {grants}.",
  "gate.context.front": 'Finite Monkey: este subagente trabalha na tarefa {task} ("{goal}"), contrato em {file}.',
  "gate.context.done_means": "Pronto nesta tarefa quer dizer: {list}. O portão confere quando o subagente parar.",
  "gate.context.scope": "Escopo da tarefa: {paths}.",
  "gate.context.briefing": "Briefing comum: {file}.",
  "gate.prs.line": "Seus PRs abertos aqui ({count}): {items}.",
  "gate.prs.conflict": "em conflito",
  "gate.prs.behind": "atrás da base",
  "gate.prs.ok": "ok",
  "gate.config.removed": "Finite Monkey: esta mudança tira hooks do Finite Monkey de {file} ({before} → {after}); ela não foi aplicada.",
  "gate.config.disabled": "Finite Monkey: esta mudança liga disableAllHooks em {file}; ela não foi aplicada.",
  "gate.config.human": "Mantive os hooks do Finite Monkey em {file}. Se foi de propósito, digite numa linha: finitemonkey: allow config <motivo>",
  "gate.config.released": "Mudança de config em {file} aceita pela sua liberação.",
  "gate.guard.bypass.no_verify": "Finite Monkey: barrado: {detail} pula os git hooks. exige: os hooks rodam em todo commit e push.",
  "gate.guard.bypass.hooks_path": "Finite Monkey: barrado: {detail} desvia o git dos hooks do projeto. exige: core.hooksPath fica como está configurado.",
  "gate.guard.bypass.hook_env": "Finite Monkey: barrado: {detail} desliga hooks ou travas. exige: hooks e travas ficam ligados.",
  "gate.guard.bypass.fm_allow": "Finite Monkey: barrado: liberação é feita pela pessoa, não por chamada de ferramenta.",
  "gate.guard.bypass.human": "Barrei {detail}: desligaria a rede de proteção. Se quiser mesmo, digite numa linha: finitemonkey: allow bypass <motivo>",
  "gate.guard.self.policy": "Finite Monkey: barrado: {file} só é escrito pelo executável finitemonkey (evidência, política e estado). exige: mudar pelos comandos do finitemonkey.",
  "gate.guard.self.allow_store": "Finite Monkey: barrado: {file} registra o que a pessoa liberou; ferramenta nunca escreve nele.",
  "gate.guard.self.human": "Deixei {file} fora do alcance: o macaco não corrige a própria prova.",
  "gate.guard.tests.model": "Finite Monkey: barrado: {detail}. exige: fazer o código passar nos testes como estão.",
  "gate.guard.tests.shell": "um comando de shell escreve ou apaga {file}",
  "gate.guard.tests.human": "Barrado: {detail}. O teste é a única testemunha que temos. Corrija o código, não a testemunha. Se a mudança é de propósito, digite numa linha: finitemonkey: allow tests <motivo>",
  "gate.release.allowed": "Liberei {guard} até {until}, a seu pedido.",
  "gate.release.unknown_guard": "Não existe trava chamada {guard} para liberar.",
  "gate.release.approved": "Registrei sua aprovação de {task}/{check}.",
  "gate.release.trusted": "Aprovei os comandos de {task} nesta máquina.",
  "gate.release.trust_failed": "Não deu para aprovar {task}: nenhum contrato válido encontrado.",
  "gate.skipped.no_repo": "Não é um repositório git: nada para conferir.",
  "gate.skipped.no_changes": "Nenhuma mudança na árvore: nada para conferir.",
  "gate.skipped.no_session_edits": "Esta sessão não mudou a árvore: nada para conferir.",
  "gate.baseline.recorded": "Gravei a linha de base das checagens que já falhavam.{reason}",
  "gate.baseline.skipped": "Linha de base não gravada: {reason}.",
  "gate.secrets.unavailable": "não deu para varrer as mudanças atrás de segredo (git indisponível)",
  "gate.secrets.finding": "segredo {rule} em {file}:{line}",
  "gate.secrets.incident": "incidente de segredo {id} está {state}",
  "gate.secrets.clean": "nenhum segredo novo nas mudanças e nenhum incidente aberto",
  "gate.require.secrets": "nenhum segredo novo e nenhum incidente de segredo aberto",
  "git.command.snapshot": "Salva árvore de trabalho, índice e arquivos não rastreados numa ref de backup sem mexer neles",
  "git.command.undo": "Lista as fotografias ou restaura uma, por padrão num worktree novo",
  "git.command.rescue": "Lista commits perdidos pelo reflog e pelo fsck, e restaura um numa branch nova",
  "git.command.merge_verify": "Confere que uma mescla manteve toda mudança dos dois lados",
  "git.block.force_push": "bloqueado: `{command}` reescreve a branch remota e pode apagar commits que outra pessoa enviou. Busque, integre os commits remotos e envie normalmente. Na sua própria branch depois de um rebase, use `git push --force-with-lease=<branch>:<sha esperado> --force-if-includes`.",
  "git.block.lease_not_own": "bloqueado: `{command}` força um push em {subject}, que não é a branch em que você trabalha ou é protegida. Push forçado só vale na sua própria branch, com lease explícito.",
  "git.block.push_delete": "bloqueado: `{command}` apaga {subject} no remoto. Apagar branch remota é com a pessoa.",
  "git.block.push_mirror": "bloqueado: `{command}` sobrescreve todas as refs do remoto e publicaria as refs de backup. Envie pelo nome a branch de que precisa.",
  "git.block.clean": "bloqueado: `{command}` apaga de vez arquivos não rastreados, que não estão em commit nenhum. Rode `git clean -n` para ver a lista e mova o que deve sair para .finitemonkey/trash/, ou pergunte à pessoa.",
  "git.block.stash_drop": "bloqueado: `{command}` joga fora trabalho guardado no stash que não existe em outro lugar. Aplique com `git stash apply` ou deixe como está; descartar stash é com a pessoa.",
  "git.block.branch_unmerged": "bloqueado: `{command}` apaga {subject}, cujos commits não estão no upstream nem na branch padrão. Envie ou mescle antes; `git branch -d` funciona depois de mesclada.",
  "git.block.worktree_force": "bloqueado: `{command}` remove um worktree mesmo com mudança sem commit. Commite ou arquive o trabalho antes; o `git worktree remove` sem força recusa árvore suja de propósito.",
  "git.block.rm_worktree": "bloqueado: `{command}` apaga {subject}, que é um worktree ou repositório git; o trabalho sem commit iria junto. Commite ou arquive e depois use `git worktree remove` sem --force.",
  "git.block.rm_root": "bloqueado: `{command}` apaga recursivamente {subject}, uma pasta raiz ou a pasta pessoal. Diga a pasta exata a remover.",
  "git.block.rebase_protected": "bloqueado: `{command}` reescreve {subject}, uma branch protegida. Mude por pull request.",
  "git.block.rebase_shared": "bloqueado: `{command}` reescreve {subject}, que já tem commits de outra pessoa no remoto. Mescle a base nela em vez de fazer rebase.",
  "git.block.merge_side": "bloqueado: `{command}` resolve conflito escolhendo um lado inteiro ({subject}), o que descarta calado as mudanças do outro lado. Resolva cada conflito à mão e rode `finitemonkey merge verify` antes do commit.",
  "git.block.history": "bloqueado: `{command}` apaga histórico ou entradas do reflog de que o undo e o rescue dependem. Reescrever histórico é com a pessoa.",
  "git.block.protected_commit": "bloqueado: `{command}` faria commit direto em {subject}, uma branch protegida. Crie uma branch com `git switch -c <tipo>/<nome>` e abra um pull request.",
  "git.block.protected_push": "bloqueado: `{command}` envia para {subject}, uma branch protegida. Envie a sua branch e abra um pull request.",
  "git.block.foreign": "bloqueado: `{command}` descartaria mudanças que esta sessão não fez: {files}. Desfaça só as suas linhas com Edit.",
  "git.foreign.before": "{path} (tinha mudança antes de você começar)",
  "git.foreign.other": "{path} (mudado fora desta sessão)",
  "git.block.unknown": "bloqueado: `{command}` descarta mudanças, e o `git status` falhou, então não dá para saber de quem elas são. Conserte o repositório e tente de novo.",
  "git.block.snapshot_failed": "bloqueado: `{command}` é arriscado e a fotografia de segurança antes dele falhou ({detail}), então ele não rodou. Resolva a causa e tente de novo.",
  "git.snapshot.context": "o finitemonkey salvou uma fotografia antes de `{command}`: {ref}. `finitemonkey undo {ref}` traz o estado anterior de volta.",
  "prod.block.effect": "bloqueado: `{command}` mexe em produção ({target}) na mão, e servidor editado na mão diverge do repositório. Mude pelo caminho de deploy ({deploy}): commit, pull request e o deploy roda.",
  "prod.block.interactive": "bloqueado: `{command}` abre sessão interativa em produção ({target}), onde nada do que for digitado passa por conferência. Rode um comando de leitura por vez, como `ssh {target} docker ps`.",
  "prod.deploy.unknown": "o deploy declarado do projeto",
  "git.snapshot.done": "fotografia salva: {ref} ({commit}). `finitemonkey undo {ref}` restaura.",
  "git.undo.list_title": "{count} fotografia(s), da mais nova para a mais antiga:",
  "git.undo.list_item": "{index}. {at}  {op}  {ref}",
  "git.undo.worktree": "{ref} restaurada num worktree novo em {path}. Compare com a sua árvore e copie o que precisar; `git worktree remove {path}` remove. O estado antes deste undo está em {backup}.",
  "git.undo.in_place": "{ref} restaurada no lugar. O estado antes deste undo está em {backup}; `finitemonkey undo {backup}` traz de volta.",
  "git.undo.confirm": "restaurar no lugar sobrescreve a árvore de trabalho e o índice. Rode você mesmo com --in-place --yes para confirmar.",
  "git.rescue.title": "candidatos a recuperação (só leitura, nada mudou):",
  "git.rescue.reflog": "reflog {ref}: {sha} {when} {subject}",
  "git.rescue.dangling": "commit perdido {sha} {when} {subject}",
  "git.rescue.blobs": "{count} conteúdo(s) de arquivo preparado(s) estão perdidos mas recuperáveis; `git fsck --lost-found` grava em .git/lost-found/other.",
  "git.rescue.never_staged": "arquivo que nunca foi preparado nem commitado não volta pelo git.",
  "git.rescue.next": "restaure um com `finitemonkey rescue --restore <sha> --branch <nome>`.",
  "git.rescue.restored": "branch {branch} criada em {sha}.",
  "git.merge.ok": "nada se perdeu: {files} arquivo(s) conferido(s) entre {base} e {result}, {justified} descarte(s) justificado(s).",
  "git.merge.lost": "{count} mudança(s) perdida(s) entre {base} e {result}:",
  "git.merge.finding": "{where} [{kind}] {side}: {text}",
  "git.merge.limits": "isto prova que as mudanças estão lá, não que o código mesclado funciona; os testes dos dois lados continuam obrigatórios.",
  "git.merge.none": "nenhuma mescla para conferir: {detail}",
  "git.error.snapshot_failed": "a fotografia falhou: {detail}",
  "git.error.nothing_to_undo": "nenhuma fotografia encontrada para {ref}.",
  "git.error.undo_failed": "o undo falhou: {detail}",
  "git.error.rescue_failed": "o rescue falhou: {detail}",
  "git.error.merge_lost": "{count} mudança(s) se perderam na mescla e não estão justificadas na lista de descartes.",
  "git.error.merge_unanalyzable": "não deu para analisar a mescla: {detail}",
  "gate.require.worktree": "todo arquivo mudado na sessão commitado, e os commits enviados ou com destino declarado",
  "gate.require.merge": "toda mescla desde o início manteve as mudanças dos dois lados",
  "gate.worktree.unavailable": "não foi possível ler o estado git do worktree",
  "gate.worktree.dirty": "arquivos mudados nesta sessão sem commit: {files}",
  "gate.worktree.unpushed": "{count} commit(s) em {branch} existem só nesta máquina",
  "gate.worktree.clean": "as mudanças da sessão estão commitadas e enviadas",
  "gate.merge.unavailable": "não foi possível ler as mesclas da sessão",
  "gate.merge.unanalyzed": "a mescla {commit} não pôde ser analisada: {detail}",
  "gate.merge.lost": "a mescla {commit} perdeu mudanças: {findings}",
  "gate.merge.clean": "{count} mescla(s) conferida(s), nada se perdeu"
};

// src/i18n/catalogs.ts
var exact = (catalog) => catalog;
var catalogs = {
  en: exact(en_default),
  "pt-BR": exact(pt_BR_default),
  es: exact(es_default)
};

// src/gate/render.ts
var STATUS_KEYS = {
  passed: "gate.status.passed",
  failed: "gate.status.failed",
  unverified: "gate.status.unverified"
};
var isMessageKey = (key) => key in catalogs.en;
var noteText = (t, item) => maskText(isMessageKey(item.key) ? t(item.key, item.params) : item.key);
var reasonText = (t, item) => item.status === "unverified" && item.notes.length === 0 && item.reason !== void 0 && isMessageKey(`gate.reason.${item.reason}`) ? [t(`gate.reason.${item.reason}`)] : [];
var itemDetails = (t, item) => [
  ...item.notes.map((entry2) => noteText(t, entry2)),
  ...reasonText(t, item)
];
var label = (item) => item.command === void 0 ? item.kind : `${item.kind} \`${maskText(item.command)}\``;
var reportLines = (t, report2) => {
  const width = Math.max(...Object.values(STATUS_KEYS).map((key) => t(key).length)) + 2;
  return [
    t(report2.implicit ? "gate.report.title_implicit" : "gate.report.title", {
      task: report2.task,
      tree: report2.treeHash
    }),
    ...report2.contractEdited ? [`  ${t("gate.report.contract_edited")}`] : [],
    ...report2.items.flatMap((item) => [
      `  ${t(STATUS_KEYS[item.status]).padEnd(width)}${item.id}  ${label(item)}`,
      ...itemDetails(t, item).map((line2) => `  ${" ".repeat(width)}  ${line2}`)
    ]),
    t(`gate.verdict.${report2.verdict}`, report2.counts)
  ];
};
var REQUIRE_KEYS = {
  command: "gate.require.command",
  tests: "gate.require.tests",
  diff: "gate.require.diff",
  placeholders: "gate.require.placeholders",
  git: "gate.require.git",
  pr: "gate.require.pr",
  manual: "gate.require.manual",
  secrets: "gate.require.secrets",
  worktree: "gate.require.worktree",
  merge: "gate.require.merge"
};
var requirement = (t, item) => `${item.id} ${t(REQUIRE_KEYS[item.kind] ?? "gate.require.other", { command: maskText(item.command ?? item.kind), kind: item.kind })}`;
var CLAIM_MAX = 120;
var claimOf = (message) => {
  const first = maskText((message ?? "").trim().split(/\n/)[0] ?? "");
  return first.length > CLAIM_MAX ? `${first.slice(0, CLAIM_MAX)}…` : first;
};
var blockReason = (t, report2, lastMessage) => {
  const failing = report2.items.filter((item) => item.status === "failed");
  return [
    t("gate.model.title", { task: report2.task, tree: report2.treeHash }),
    t("gate.model.claim", { claim: claimOf(lastMessage) || t("gate.model.no_claim") }),
    t("gate.model.requires", { list: failing.map((item) => requirement(t, item)).join("; ") }),
    t("gate.model.not_enough", {
      list: failing.map((item) => `${item.id}: ${itemDetails(t, item).join(", ")}`).join("; ")
    })
  ].join("\n");
};
var unverifiedSummary = (t, report2) => report2.items.filter((item) => item.status === "unverified").map((item) => `${item.id} (${itemDetails(t, item).join(", ") || t("gate.reason.no_evidence")})`).join("; ");

// src/evidence/types.ts
var EVIDENCE_SCHEMA = "finitemonkey/evidence@1";
var EVIDENCE_STATUSES = ["passed", "failed", "unverified"];
var UNVERIFIED_REASONS = [
  "tool_missing",
  "timeout",
  "rate_limited",
  "budget",
  "not_implemented",
  "no_gh",
  "network",
  "pending",
  "untrusted",
  "rewriter",
  "awaiting_person",
  "no_evidence",
  "no_baseline"
];
var GATE_CHECK = "*gate*";

// src/evidence/ledger.ts
var oneOf2 = (options, value) => options.find((option) => option === value);
var params = (value) => isRecord(value) ? Object.fromEntries(
  Object.entries(value).filter(
    (entry2) => typeof entry2[1] === "string" || typeof entry2[1] === "number"
  )
) : {};
var notes = (value) => Array.isArray(value) ? value.flatMap(
  (item) => isRecord(item) && typeof item["key"] === "string" ? [{ key: item["key"], params: params(item["params"]) }] : []
) : [];
var text2 = (record2, key) => {
  const value = record2[key];
  return typeof value === "string" ? value : void 0;
};
var optional = (record2) => {
  const exitCode = record2["exitCode"];
  const durationMs = record2["durationMs"];
  const command = text2(record2, "command");
  const stdoutSha256 = text2(record2, "stdoutSha256");
  const releasedBy = text2(record2, "releasedBy");
  const reason = oneOf2(UNVERIFIED_REASONS, record2["reason"]);
  const failures = record2["failures"];
  const testCount = record2["testCount"];
  return {
    ...command === void 0 ? {} : { command },
    ...typeof exitCode === "number" || exitCode === null ? { exitCode } : {},
    ...stdoutSha256 === void 0 ? {} : { stdoutSha256 },
    ...typeof durationMs === "number" ? { durationMs } : {},
    ...reason === void 0 ? {} : { reason },
    ...releasedBy === void 0 ? {} : { releasedBy },
    ...Array.isArray(failures) ? { failures: failures.filter((item) => typeof item === "string") } : {},
    ...typeof testCount === "number" ? { testCount } : {}
  };
};
var parseEvidence = (line2) => {
  const parsed = parseJsonObject(line2);
  if (!parsed.ok) return void 0;
  const record2 = parsed.value;
  const status = oneOf2(EVIDENCE_STATUSES, record2["status"]);
  const task = text2(record2, "task");
  const check2 = text2(record2, "check");
  const kind = text2(record2, "kind");
  const treeHash2 = text2(record2, "treeHash");
  const at = text2(record2, "at");
  if (record2["schema"] !== EVIDENCE_SCHEMA || status === void 0) return void 0;
  if (task === void 0 || check2 === void 0 || kind === void 0 || treeHash2 === void 0 || at === void 0) {
    return void 0;
  }
  return {
    schema: EVIDENCE_SCHEMA,
    task,
    check: check2,
    kind,
    status,
    treeHash: treeHash2,
    at,
    notes: notes(record2["notes"]),
    ...optional(record2)
  };
};
var readLedger = (runtime, path) => {
  const content = runtime.readText(path);
  if (!content.ok) return [];
  return content.value.split("\n").flatMap((line2) => {
    const entry2 = line2.trim() === "" ? void 0 : parseEvidence(line2);
    return entry2 === void 0 ? [] : [entry2];
  });
};
var appendEvidence = (runtime, path, entries) => entries.length === 0 || runtime.appendText(path, entries.map((entry2) => `${JSON.stringify(entry2)}
`).join("")).ok;
var latestFor = (entries, check2, treeHash2, command) => entries.findLast(
  (entry2) => entry2.check === check2 && entry2.treeHash === treeHash2 && (command === void 0 || entry2.command === command)
);
var hasStale = (entries, check2, treeHash2) => entries.some((entry2) => entry2.check === check2 && entry2.treeHash !== treeHash2);

// src/gate/checks/diff.ts
import { join as join5 } from "node:path";

// src/core/glob.ts
var escape = (char) => /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
var globToRegExp = (glob) => {
  const pattern = glob.replace(/^\.\//, "");
  let out = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index] ?? "";
    if (char === "*" && pattern[index + 1] === "*") {
      const slash = pattern[index + 2] === "/";
      out += slash ? "(?:.*/)?" : ".*";
      index += slash ? 2 : 1;
    } else if (char === "*") out += "[^/]*";
    else if (char === "?") out += "[^/]";
    else out += escape(char);
  }
  return new RegExp(`^${out}${pattern.endsWith("/") ? ".*" : ""}$`);
};
var matchesAny = (path, globs) => {
  const normalized = toPosixPath(path);
  return globs.some((glob) => globToRegExp(glob).test(normalized));
};

// src/gate/checks/diff.ts
var MAX_LISTED = 10;
var untrackedLines = (ctx) => ctx.changes.filter((change) => change.status === "A").reduce((sum, change) => {
  const text6 = ctx.runtime.readText(toAbsolutePath(join5(ctx.paths.root, change.path)));
  return sum + (text6.ok ? text6.value.split("\n").length : 0);
}, 0);
var diffCheck = (_check, ctx) => {
  const { paths, diffBudget } = ctx.contract.scope;
  if (paths.length === 0 && diffBudget === void 0) return passed([note("gate.diff.no_scope")]);
  const outside = paths.length === 0 ? [] : ctx.changes.filter((change) => !matchesAny(change.path, paths));
  const stat = numstat(ctx.git, ctx.base);
  const files = ctx.changes.length;
  const lines3 = stat.lines + untrackedLines(ctx);
  const notes2 = [
    ...outside.slice(0, MAX_LISTED).map((change) => note("gate.diff.outside", { file: change.path })),
    ...diffBudget?.files !== void 0 && files > diffBudget.files ? [note("gate.diff.too_many_files", { count: files, max: diffBudget.files })] : [],
    ...diffBudget?.lines !== void 0 && lines3 > diffBudget.lines ? [note("gate.diff.too_many_lines", { count: lines3, max: diffBudget.lines })] : []
  ];
  return notes2.length > 0 ? failed(notes2) : passed([note("gate.diff.within", { files, lines: lines3 })]);
};

// src/gate/checks/git.ts
var requirement2 = (want, ctx) => {
  if (want === "committed") {
    const dirty = dirtyPaths(ctx.git);
    return dirty.length === 0 ? void 0 : note("gate.git.uncommitted", { count: dirty.length, file: dirty[0] ?? "" });
  }
  if (want === "pushed") {
    const ahead = aheadOfUpstream(ctx.git);
    if (ahead === void 0) return note("gate.git.no_upstream");
    return ahead === 0 ? void 0 : note("gate.git.unpushed", { count: ahead });
  }
  const pr = ctx.pr();
  return pr.kind === "found" && pr.pr.state === "OPEN" ? void 0 : note("gate.git.no_pr");
};
var gitCheck = (check2, ctx) => {
  const wants = check2.require ?? ["committed"];
  const missing = wants.flatMap((want) => {
    const problem3 = requirement2(want, ctx);
    return problem3 === void 0 ? [] : [problem3];
  });
  return missing.length > 0 ? failed(missing) : passed([note("gate.git.ok", { require: wants.join(", ") })]);
};

// src/guards/release/grants.ts
var GRANT_MINUTES = 30;
var text3 = (record2, key) => {
  const value = record2[key];
  return typeof value === "string" ? value : void 0;
};
var toGrant = (value) => {
  if (!isRecord(value)) return void 0;
  const guard = text3(value, "guard");
  const reason = text3(value, "reason");
  const grantedAt = text3(value, "grantedAt");
  const expiresAt = text3(value, "expiresAt");
  const sessionId = text3(value, "sessionId");
  if (guard === void 0 || reason === void 0 || grantedAt === void 0 || expiresAt === void 0)
    return void 0;
  return { guard, reason, grantedAt, expiresAt, ...sessionId === void 0 ? {} : { sessionId } };
};
var toApproval = (value) => {
  if (!isRecord(value)) return void 0;
  const task = text3(value, "task");
  const check2 = text3(value, "check");
  const at = text3(value, "at");
  if (task === void 0 || check2 === void 0 || at === void 0) return void 0;
  return { task, check: check2, at, reason: text3(value, "reason") ?? "" };
};
var list = (raw, map) => Array.isArray(raw) ? raw.flatMap((item) => {
  const value = map(item);
  return value === void 0 ? [] : [value];
}) : [];
var readGrants = (store, paths) => list(readJsonFile(store, paths.grants)?.["grants"], toGrant);
var readApprovals = (store, paths) => list(readJsonFile(store, paths.grants)?.["approvals"], toApproval);
var isLive = (grant, now, sessionId) => Date.parse(grant.expiresAt) > now && (grant.sessionId === void 0 || sessionId === void 0 || grant.sessionId === sessionId);
var activeGrant = (store, paths, guard, now, sessionId) => readGrants(store, paths).findLast((grant) => grant.guard === guard && isLive(grant, now, sessionId));
var saveRelease = (store, paths, now, added) => {
  const grants = [...readGrants(store, paths).filter((grant) => Date.parse(grant.expiresAt) > now), ...added.grants];
  const approvals = [...readApprovals(store, paths), ...added.approvals];
  return writeJsonFile(store, paths.grants, { grants: [...grants], approvals: [...approvals] }).ok;
};
var expiryFrom = (now) => new Date(now + GRANT_MINUTES * 6e4).toISOString();

// src/gate/checks/manual.ts
var manualCheck = (check2, ctx) => {
  const approval = readApprovals(ctx.runtime, ctx.paths).findLast(
    (item) => item.task === ctx.contract.id && item.check === check2.id
  );
  if (approval === void 0) {
    return unverified("awaiting_person", [
      note("gate.manual.waiting", { description: check2.description ?? "", task: ctx.contract.id, check: check2.id })
    ]);
  }
  return {
    status: "passed",
    notes: [note("gate.manual.approved", { at: approval.at, reason: approval.reason })],
    releasedBy: `person@${approval.at}`
  };
};

// src/gate/checks/placeholders.ts
import { join as join6 } from "node:path";

// src/guards/tests/patterns.ts
var JS_TEST = /(^|\/)(__tests__|__test__)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)tests?\/.*\.[cm]?[jt]sx?$/;
var PY_TEST = /(^|\/)test_[^/]*\.py$|_test\.py$|(^|\/)tests\/.*\.py$/;
var SNAPSHOT = /\.snap$|(^|\/)__snapshots__\//;
var testLanguage = (path) => {
  const normalized = toPosixPath(path);
  if (normalized.endsWith("_test.go")) return "go";
  if (PY_TEST.test(normalized)) return "py";
  if (JS_TEST.test(normalized)) return "js";
  return void 0;
};
var isSnapshot = (path) => SNAPSHOT.test(toPosixPath(path));
var isTestFile = (path) => testLanguage(path) !== void 0 || isSnapshot(path);
var CONFIG_NAMES = [
  /^(jest|vitest|vitest\.workspace|playwright|cypress|ava|stylelint|prettier|eslint)\.config\.[cm]?[jt]s$/,
  /^karma\.conf\.[cm]?js$/,
  /^\.(mocharc|nycrc|c8rc|eslintrc|prettierrc|stylelintrc)(\.[a-z]+)?$/,
  /^\.(eslintignore|prettierignore|coveragerc|flake8|pylintrc|ruff\.toml)$/,
  /^(pytest\.ini|tox\.ini|mypy\.ini|setup\.cfg|ruff\.toml|biome\.jsonc?|\.golangci\.ya?ml|lefthook\.ya?ml)$/,
  /^\.pre-commit-config\.ya?ml$/,
  /^tsconfig(\.[\w-]+)?\.json$/
];
var HOOK_DIRS = /(^|\/)\.husky\//;
var isProtectedConfig = (path) => {
  const normalized = toPosixPath(path);
  if (HOOK_DIRS.test(normalized)) return true;
  const name = normalized.split("/").pop() ?? "";
  return name === "package.json" || name === "pyproject.toml" || CONFIG_NAMES.some((pattern) => pattern.test(name));
};

// src/gate/checks/placeholders.ts
var MAX_LISTED2 = 10;
var SKIP_FILES = /\.(md|mdx|txt|rst|lock|snap|svg|png|jpg|gif|json)$|(^|\/)(CHANGELOG|LICENSE)/i;
var PLACEHOLDER = /\b(TODO|FIXME|XXX)\b|not implemented|NotImplementedError|unimplemented!|todo!\(|lorem ipsum/i;
var findPlaceholders = (lines3) => lines3.filter((line2) => !isTestFile(line2.path) && !SKIP_FILES.test(line2.path) && PLACEHOLDER.test(line2.text));
var untrackedAdded = (ctx) => ctx.changes.filter((change) => change.status === "A" && !SKIP_FILES.test(change.path)).flatMap((change) => {
  const text6 = ctx.runtime.readText(toAbsolutePath(join6(ctx.paths.root, change.path)));
  return text6.ok ? text6.value.split("\n").map((line2, index) => ({ path: change.path, line: index + 1, text: line2 })) : [];
});
var placeholdersCheck = (_check, ctx) => {
  const tracked = addedLines(ctx.git, ctx.base);
  const seen = new Set(tracked.map((line2) => line2.path));
  const found = findPlaceholders([...tracked, ...untrackedAdded(ctx).filter((line2) => !seen.has(line2.path))]);
  if (found.length === 0) return passed([note("gate.placeholders.clean")]);
  return failed(
    found.slice(0, MAX_LISTED2).map((line2) => note("gate.placeholders.found", { file: line2.path, line: line2.line }))
  );
};

// src/gate/checks/pr.ts
var MAX_FILES = 10;
var conflictNotes = (pr, ctx) => {
  const files = conflictFiles(ctx.git, pr.baseRefName);
  return [
    note("gate.pr.conflict", { number: pr.number, base: pr.baseRefName }),
    ...files.slice(0, MAX_FILES).map((file) => note("gate.pr.conflict_file", { file })),
    note("gate.pr.conflict_next", { base: pr.baseRefName })
  ];
};
var foundOutcome = (status, ctx) => {
  const { pr } = status;
  const info = [note("gate.pr.found", { number: pr.number, state: pr.state, url: pr.url })];
  if (pr.mergeStateStatus === "BEHIND") info.push(note("gate.pr.behind", { base: pr.baseRefName }));
  if (status.localHead !== void 0 && pr.headRefOid !== "" && status.localHead !== pr.headRefOid) {
    info.push(note("gate.pr.stale_head", { number: pr.number }));
  }
  const failing = pr.checks.filter((check2) => check2.state === "failed");
  const pending = pr.checks.filter((check2) => check2.state === "pending");
  if (isConflicting(pr)) return failed([...info, ...conflictNotes(pr, ctx)]);
  if (failing.length > 0)
    return failed([...info, ...failing.map((check2) => note("gate.pr.ci_failed", { name: check2.name }))]);
  if (pending.length > 0)
    return unverified("pending", [
      ...info,
      ...pending.map((check2) => note("gate.pr.ci_pending", { name: check2.name }))
    ]);
  return passed(info);
};
var prOutcome = (check2, ctx) => {
  const status = ctx.pr();
  switch (status.kind) {
    case "no_gh":
      return unverified("no_gh", [note("gate.pr.no_gh")]);
    case "network":
      return unverified("network", [note("gate.pr.network", { detail: status.detail })]);
    case "no_branch":
      return unverified("not_implemented", [note("gate.pr.no_branch")]);
    case "none":
      return check2.requireOpen === true ? failed([note("gate.pr.none_required", { branch: status.branch })]) : passed([note("gate.pr.none", { branch: status.branch })]);
    case "found":
      return foundOutcome(status, ctx);
  }
};

// src/secrets/baseline.ts
import { join as join7 } from "node:path";
var BASELINE_FILE2 = ".finitemonkey/findings/baseline.json";
var BASELINE_SCHEMA = "finitemonkey/secrets-baseline@1";
var BASELINE_STATES = ["aceito", "falso-positivo"];
var EXCEPTION_MAX_DAYS = 90;
var EMPTY_BASELINE = { schema: BASELINE_SCHEMA, entries: [] };
var baselinePath = (root) => toAbsolutePath(join7(root, BASELINE_FILE2));
var text4 = (record2, key) => {
  const value = record2[key];
  return typeof value === "string" && value !== "" ? value : void 0;
};
var stateOf = (value) => BASELINE_STATES.find((state) => state === value);
var parseEntry = (value) => {
  if (!isRecord(value)) return void 0;
  const fields = ["id", "rule", "file", "fingerprint", "owner", "reason", "acceptedAt", "expiresAt"];
  const [id, rule, file, fingerprint, owner, reason, acceptedAt, expiresAt] = fields.map((key) => text4(value, key));
  const state = stateOf(value["state"]);
  const line2 = value["line"];
  if (id === void 0 || rule === void 0 || file === void 0 || fingerprint === void 0) return void 0;
  if (owner === void 0 || reason === void 0 || acceptedAt === void 0 || expiresAt === void 0)
    return void 0;
  if (state === void 0 || typeof line2 !== "number") return void 0;
  return { id, rule, file, line: line2, fingerprint, state, owner, reason, acceptedAt, expiresAt };
};
var parseBaseline = (raw) => {
  const parsed = parseJsonObject(raw);
  if (!parsed.ok) return parsed;
  if (parsed.value["schema"] !== BASELINE_SCHEMA) return reject(`schema must be ${BASELINE_SCHEMA}`);
  const list4 = parsed.value["entries"];
  if (!Array.isArray(list4)) return reject("entries must be a list");
  const entries = [];
  for (const [index, item] of list4.entries()) {
    const entry2 = parseEntry(item);
    if (entry2 === void 0) return reject(`entry ${String(index)} is incomplete`);
    entries.push(entry2);
  }
  return accept({ schema: BASELINE_SCHEMA, entries });
};
var loadBaseline = (runtime, root) => {
  const raw = runtime.readText(baselinePath(root));
  return raw.ok ? parseBaseline(raw.value) : accept(EMPTY_BASELINE);
};
var serializeBaseline = (baseline) => `${JSON.stringify({ schema: baseline.schema, entries: [...baseline.entries].sort((a, b) => a.id.localeCompare(b.id)) }, null, 2)}
`;
var saveBaseline = (runtime, root, baseline) => runtime.writeText(baselinePath(root), serializeBaseline(baseline));
var ratchet = (findings, baseline, now, inScope) => {
  const byId = new Map(baseline.entries.map((entry2) => [entry2.id, entry2]));
  const seen = new Set(findings.map((finding2) => finding2.id));
  const entryOf4 = (finding2) => byId.get(finding2.id);
  return {
    fresh: findings.filter((finding2) => entryOf4(finding2) === void 0),
    known: findings.filter((finding2) => (entryOf4(finding2)?.expiresAt ?? "") >= now),
    expired: findings.filter((finding2) => {
      const entry2 = entryOf4(finding2);
      return entry2 !== void 0 && entry2.expiresAt < now;
    }),
    fixed: inScope === void 0 ? [] : baseline.entries.filter((entry2) => !seen.has(entry2.id) && inScope(entry2.file))
  };
};
var withoutFixed = (baseline, fixed) => {
  const gone = new Set(fixed.map((entry2) => entry2.id));
  return { schema: baseline.schema, entries: baseline.entries.filter((entry2) => !gone.has(entry2.id)) };
};
var acceptedFingerprints = (baseline, now) => new Set(baseline.entries.filter((entry2) => entry2.expiresAt >= now).map((entry2) => entry2.fingerprint));

// src/secrets/incidents.ts
import { join as join8 } from "node:path";
var INCIDENTS_DIR = ".finitemonkey/incidents";
var INCIDENT_STATES = ["aberto", "exposicao-local", "rotacionado", "fechado"];
var INCIDENT_SOURCES = ["tool-output", "prompt", "history", "scan"];
var ID = /^inc-[0-9a-f]{12}$/;
var incidentId = (rule, fingerprint) => `inc-${sha256Hex(`${rule}\0${fingerprint}`).slice(0, 12)}`;
var incidentsDir = (root) => toAbsolutePath(join8(root, INCIDENTS_DIR));
var incidentFile = (root, id) => toAbsolutePath(join8(incidentsDir(root), `${id}.json`));
var pick2 = (options, value) => options.find((option) => option === value);
var str2 = (record2, key) => {
  const value = record2[key];
  return typeof value === "string" ? value : void 0;
};
var parseEvent = (value) => {
  if (!isRecord(value)) return void 0;
  const state = pick2(INCIDENT_STATES, value["state"]);
  const at = str2(value, "at");
  const by = str2(value, "by");
  return state === void 0 || at === void 0 || by === void 0 ? void 0 : { state, at, by };
};
var parseHistory = (value) => {
  if (!Array.isArray(value)) return void 0;
  const events = value.map(parseEvent);
  return events.every((event) => event !== void 0) ? events : void 0;
};
var parseIncident = (raw) => {
  const parsed = parseJsonObject(raw);
  if (!parsed.ok) return parsed;
  const record2 = parsed.value;
  const [id, rule, where, fingerprint, createdAt, updatedAt] = ["id", "rule", "where", "fingerprint", "createdAt", "updatedAt"].map((key) => str2(record2, key));
  const state = pick2(INCIDENT_STATES, record2["state"]);
  const source = pick2(INCIDENT_SOURCES, record2["source"]);
  const history = parseHistory(record2["history"]);
  const firstCommit = str2(record2, "firstCommit");
  if (id === void 0 || !ID.test(id) || rule === void 0 || where === void 0) return reject("incomplete");
  if (fingerprint === void 0 || createdAt === void 0 || updatedAt === void 0) return reject("incomplete");
  if (state === void 0 || source === void 0 || history === void 0) return reject("incomplete");
  const base = {
    schemaVersion: 1,
    id,
    rule,
    where,
    fingerprint,
    source,
    state,
    createdAt,
    updatedAt,
    history
  };
  return accept(firstCommit === void 0 ? base : { ...base, firstCommit });
};
var readIncident = (runtime, root, id) => {
  if (!ID.test(id)) return reject("not an incident id");
  const raw = runtime.readText(incidentFile(root, id));
  return raw.ok ? parseIncident(raw.value) : reject(raw.error);
};
var listIncidents = (runtime, root) => {
  const names = runtime.listDir(incidentsDir(root));
  if (!names.ok) return [];
  return names.value.filter((name) => name.endsWith(".json")).map((name) => readIncident(runtime, root, name.slice(0, -".json".length))).flatMap((parsed) => parsed.ok ? [parsed.value] : []).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
};
var saveIncident = (runtime, root, incident) => {
  const ignore = runtime.writeText(toAbsolutePath(join8(incidentsDir(root), ".gitignore")), "*\n");
  if (!ignore.ok) return ignore;
  return runtime.writeText(incidentFile(root, incident.id), `${JSON.stringify(incident, null, 2)}
`);
};
var created = (draft, now, by) => ({
  schemaVersion: 1,
  id: incidentId(draft.rule, draft.fingerprint),
  rule: draft.rule,
  where: draft.where,
  fingerprint: draft.fingerprint,
  source: draft.source,
  state: draft.state,
  createdAt: now,
  updatedAt: now,
  ...draft.firstCommit === void 0 ? {} : { firstCommit: draft.firstCommit },
  history: [{ state: draft.state, at: now, by }]
});
var recordIncident = (runtime, root, draft, by) => {
  const now = runtime.now();
  const existing = readIncident(runtime, root, incidentId(draft.rule, draft.fingerprint));
  if (existing.ok && existing.value.state !== "fechado") return existing;
  const incident = existing.ok ? {
    ...existing.value,
    state: draft.state,
    updatedAt: now,
    history: [...existing.value.history, { state: draft.state, at: now, by }]
  } : created(draft, now, by);
  const saved = saveIncident(runtime, root, incident);
  return saved.ok ? accept(incident) : reject(saved.error);
};
var ALLOWED_FROM = {
  aberto: [],
  "exposicao-local": [],
  rotacionado: ["aberto", "exposicao-local"],
  fechado: ["rotacionado"]
};
var canMove = (from, to) => ALLOWED_FROM[to].includes(from);
var moveIncident = (incident, to, now, by) => ({
  ...incident,
  state: to,
  updatedAt: now,
  history: [...incident.history, { state: to, at: now, by }]
});
var isRotated = (incident) => incident.state === "rotacionado" || incident.state === "fechado";

// src/secrets/scan.ts
import { join as join9, relative as relative2 } from "node:path";

// src/secrets/located.ts
var findingId = (ruleId, file, fingerprint) => `fm-${sha256Hex(`${ruleId}\0${file}\0${fingerprint}`).slice(0, 16)}`;
var locate = (finding2, rawFile, line2, commit2) => {
  const file = toPosixPath(rawFile);
  return {
    id: findingId(finding2.ruleId, file, finding2.fingerprint),
    ruleId: finding2.ruleId,
    severity: finding2.severity,
    file,
    line: line2,
    column: finding2.column,
    fingerprint: finding2.fingerprint,
    tail: finding2.tail,
    ...commit2 === void 0 ? {} : { commit: commit2 }
  };
};
var whereOf = (finding2) => `${finding2.file}:${String(finding2.line)}`;

// src/secrets/diff.ts
var COMMIT = /^commit ([0-9a-f]{7,64})\b/;
var HUNK2 = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
var DEV_NULL = "/dev/null";
var fresh = () => ({ file: void 0, inHunk: false, next: 0, text: [], lines: [] });
var targetOf = (line2) => {
  const path = line2.slice(4).replace(/\t.*$/, "");
  if (path === DEV_NULL) return void 0;
  return path.startsWith("b/") ? path.slice(2) : path;
};
var collect = (chunk, commit2, found) => {
  const { file } = chunk;
  if (file === void 0 || chunk.text.length === 0) return;
  for (const finding2 of scanText(chunk.text.join("\n"), { path: file })) {
    const located = locate(finding2, file, chunk.lines[finding2.line - 1] ?? finding2.line, commit2);
    found.set(located.id, located);
  }
};
var addLine = (chunk, line2) => {
  const hunk = HUNK2.exec(line2);
  if (hunk !== null) {
    chunk.inHunk = true;
    chunk.next = Number(hunk[1]);
  } else if (!chunk.inHunk && line2.startsWith("+++ ")) {
    chunk.file = targetOf(line2);
  } else if (chunk.inHunk && line2.startsWith("+")) {
    chunk.text.push(line2.slice(1));
    chunk.lines.push(chunk.next);
    chunk.next += 1;
  } else if (chunk.inHunk && line2.startsWith(" ")) {
    chunk.next += 1;
  }
};
var diffScanner = () => {
  const found = /* @__PURE__ */ new Map();
  let commit2;
  let chunk = fresh();
  const flush2 = () => {
    collect(chunk, commit2, found);
    chunk = fresh();
  };
  const header = (line2) => {
    const match = COMMIT.exec(line2);
    if (match !== null) {
      flush2();
      commit2 = match[1];
      return true;
    }
    if (line2.startsWith("diff --git ")) {
      flush2();
      return true;
    }
    return false;
  };
  return {
    push: (raw) => {
      const line2 = withoutCarriageReturn(raw);
      if (!header(line2)) addLine(chunk, line2);
    },
    end: () => {
      flush2();
      return [...found.values()];
    }
  };
};

// src/secrets/scan.ts
var MAX_FILE_BYTES = 2 * 1024 * 1024;
var SKIPPED = /(?:^|\/)(?:\.git|node_modules|\.finitemonkey)\//;
var DIFF_FLAGS = ["-U0", "--no-color", "--no-ext-diff", "--no-renames"];
var binary = (text6) => text6.slice(0, 8e3).includes("\0");
var listed = (runtime, root, target) => {
  const git = runtime.git(["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", target], root);
  if (git.ok)
    return accept(
      git.stdout.split("\0").filter((name) => name !== "").map(toPosixPath)
    );
  const base = toAbsolutePath(target, root);
  const walked = runtime.walkFiles(base);
  if (!walked.ok) return walked;
  return accept(walked.value.map((name) => toPosixPath(relative2(root, join9(base, toPosixPath(name))))));
};
var scanFile = (runtime, root, file) => {
  const text6 = runtime.readText(toAbsolutePath(file, root));
  if (!text6.ok || text6.value.length > MAX_FILE_BYTES || binary(text6.value)) return [];
  return scanText(text6.value, { path: file }).map((finding2) => locate(finding2, file, finding2.line));
};
var scanPath = (runtime, root, target) => {
  const files = listed(runtime, root, target);
  if (!files.ok) return files;
  return accept(files.value.filter((file) => !SKIPPED.test(file)).flatMap((file) => scanFile(runtime, root, file)));
};
var diffFindings = (diff) => {
  const scanner = diffScanner();
  for (const line2 of diff.split("\n")) scanner.push(line2);
  return scanner.end().filter((finding2) => !SKIPPED.test(finding2.file));
};
var scanStaged = (runtime, root, includeUnstaged = false) => {
  const args = includeUnstaged ? ["diff", "HEAD", ...DIFF_FLAGS] : ["diff", "--cached", ...DIFF_FLAGS];
  const git = runtime.git(args, root);
  if (!git.ok) return reject(git.found ? "git diff failed" : "git not found");
  return accept(diffFindings(git.stdout));
};
var scanHistory = async (runtime, root) => {
  const scanner = diffScanner();
  const args = ["log", "-p", "--all", "--format=commit %H", ...DIFF_FLAGS];
  const git = await runtime.gitLines(args, root, scanner.push);
  if (!git.ok) return reject(git.found ? "git log failed" : "git not found");
  return accept(scanner.end().filter((finding2) => !SKIPPED.test(finding2.file)));
};

// src/secrets/gate.ts
var untracked2 = (runtime, root) => {
  const listed3 = runtime.git(["ls-files", "-z", "--others", "--exclude-standard"], root);
  if (!listed3.ok) return [];
  return listed3.stdout.split("\0").map(toPosixPath).filter((file) => file !== "" && !file.startsWith(".finitemonkey/")).flatMap((file) => scanFile(runtime, root, file));
};
var secretsGateStatus = (runtime, root, since) => {
  const changed = scanStaged(runtime, root, true);
  if (!changed.ok) return changed;
  const baseline = loadBaseline(runtime, root);
  if (!baseline.ok) return baseline;
  const outcome = ratchet([...changed.value, ...untracked2(runtime, root)], baseline.value, runtime.now(), void 0);
  const openIncidents = listIncidents(runtime, root).filter(
    (incident) => incident.createdAt >= since && incident.state !== "rotacionado" && incident.state !== "fechado"
  );
  return accept({ findings: [...outcome.fresh, ...outcome.expired], openIncidents });
};

// src/gate/checks/secrets.ts
var MAX_LISTED3 = 10;
var EPOCH = "1970-01-01T00:00:00.000Z";
var sinceOf = (ctx) => {
  const session = readSession(ctx.runtime, ctx.paths);
  return session === void 0 ? EPOCH : new Date(session.at).toISOString();
};
var secretsCheck = (_check, ctx) => {
  const status = secretsGateStatus(ctx.runtime, ctx.paths.root, sinceOf(ctx));
  if (!status.ok) return unverified("tool_missing", [note("gate.secrets.unavailable")]);
  const { findings, openIncidents } = status.value;
  const notes2 = [
    ...findings.slice(0, MAX_LISTED3).map((finding2) => note("gate.secrets.finding", { file: finding2.file, line: finding2.line, rule: finding2.ruleId })),
    ...openIncidents.slice(0, MAX_LISTED3).map((incident) => note("gate.secrets.incident", { id: incident.id, state: incident.state }))
  ];
  return notes2.length > 0 ? failed(notes2) : passed([note("gate.secrets.clean")]);
};

// src/gate/checks/tests.ts
import { join as join10 } from "node:path";

// src/guards/tests/scan.ts
var skipQuoted = (source, start, quote) => {
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") index += 1;
    else if (char === quote) return index;
    else if (char === "\n" && quote !== "`") return index;
  }
  return source.length;
};
var skipComment = (source, start) => {
  if (source[start + 1] === "/") {
    const end2 = source.indexOf("\n", start);
    return end2 < 0 ? source.length : end2 - 1;
  }
  const end = source.indexOf("*/", start + 2);
  return end < 0 ? source.length : end + 1;
};
var stripJs = (source) => {
  let out = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? "";
    const next2 = source[index + 1];
    if (char === "/" && (next2 === "/" || next2 === "*")) {
      index = skipComment(source, index);
      out += " ";
    } else if (char === '"' || char === "'" || char === "`") {
      index = skipQuoted(source, index, char);
      out += `${char}${char}`;
    } else out += char;
  }
  return out;
};
var stripHash = (source) => source.split("\n").map((line2) => line2.replace(/(^|\s)#.*$/, "")).join("\n");
var count2 = (source, pattern) => source.match(pattern)?.length ?? 0;
var RULES2 = {
  js: {
    tests: /(?<![.\w$])(?:it|test)\b(?:\s*\.\s*\w+)*\s*\(/g,
    skips: /\b(?:it|test|describe|suite|context)\s*\.\s*(?:skip|only|todo|skipIf|runIf|fails)\b|\b(?:xit|xtest|xdescribe|xcontext|fit|fdescribe)\s*\(/g,
    asserts: /\bexpect\s*[(.]|\bassert\b(?:\s*\.\s*\w+)*\s*\(|\.\s*should\b|\bt\s*\.\s*(?:is|not|deepEqual|true|false|truthy|falsy|throws|equal|ok|assert|snapshot|regex|like)\s*\(/g
  },
  py: {
    tests: /^\s*(?:async\s+)?def\s+test\w*\s*\(/gm,
    skips: /@pytest\.mark\.(?:skip|skipif|xfail)\b|\bunittest\.skip\w*|\bpytest\.skip\s*\(|\bself\.skipTest\s*\(/g,
    asserts: /^\s*assert\b|\bself\.assert\w+\s*\(|\bpytest\.raises\s*\(/gm
  },
  go: {
    tests: /\bfunc\s+Test\w*\s*\(/g,
    skips: /\bt\.Skip(?:Now|f)?\s*\(/g,
    asserts: /\bt\.(?:Error|Errorf|Fatal|Fatalf|Fail|FailNow)\s*\(|\b(?:assert|require)\.\w+\s*\(/g
  }
};
var countTests = (language, source) => {
  const code = language === "py" ? stripHash(source) : stripJs(source);
  const rules = RULES2[language];
  const skips = count2(code, rules.skips);
  return { tests: count2(code, rules.tests), skips, assertions: count2(code, rules.asserts) };
};

// src/guards/tests/analyze.ts
var PACKAGE_KEYS = [
  "jest",
  "vitest",
  "eslintConfig",
  "prettier",
  "c8",
  "nyc",
  "ava",
  "mocha",
  "husky",
  "lint-staged"
];
var PACKAGE_SCRIPTS = /^(test|lint|typecheck|check|format|pretest|precommit|prepare)(:.*)?$/;
var PYPROJECT_SECTION = /^\[tool\.(pytest|coverage|ruff|mypy|pylint|black|isort)/;
var packageDigest = (content) => {
  const parsed = parseJsonObject(content);
  if (!parsed.ok) return sha256Hex(content);
  const scripts = parsed.value["scripts"];
  const picked = {
    keys: PACKAGE_KEYS.map((key) => [key, parsed.value[key] ?? null]),
    scripts: isRecord(scripts) ? Object.entries(scripts).filter(([name]) => PACKAGE_SCRIPTS.test(name)) : []
  };
  return sha256Hex(JSON.stringify(picked));
};
var pyprojectDigest = (content) => {
  let inTool = false;
  const kept = content.split("\n").filter((line2) => {
    if (line2.trimStart().startsWith("[")) inTool = PYPROJECT_SECTION.test(line2.trim());
    return inTool;
  });
  return sha256Hex(kept.join("\n"));
};
var configDigest = (path, content) => {
  if (!isProtectedConfig(path)) return void 0;
  if (content === void 0) return "absent";
  const name = toPosixPath(path).split("/").pop() ?? "";
  if (name === "package.json") return packageDigest(content);
  if (name === "pyproject.toml") return pyprojectDigest(content);
  return sha256Hex(content);
};
var compareTestFile = (path, before, after) => {
  if (before === void 0) return [];
  if (isSnapshot(path)) return before === after ? [] : [{ kind: "snapshot_changed", path }];
  const language = testLanguage(path);
  if (language === void 0) return [];
  if (after === void 0) return [{ kind: "test_file_deleted", path }];
  const old = countTests(language, before);
  const now = countTests(language, after);
  const found = [];
  if (now.tests < old.tests) found.push({ kind: "test_removed", path, before: old.tests, after: now.tests });
  if (now.skips > old.skips) found.push({ kind: "skip_added", path, before: old.skips, after: now.skips });
  if (now.assertions < old.assertions) {
    found.push({ kind: "assertion_removed", path, before: old.assertions, after: now.assertions });
  }
  return found;
};
var compareNewTestFile = (path, after) => {
  const language = testLanguage(path);
  if (language === void 0) return [];
  const counts = countTests(language, after);
  return counts.skips > 0 ? [{ kind: "skip_added", path, before: 0, after: counts.skips }] : [];
};
var compareConfig = (path, before, after, accepted2) => {
  const old = configDigest(path, before);
  const now = configDigest(path, after);
  if (before === void 0 || old === void 0 || now === void 0 || old === now || now === accepted2) return [];
  return [{ kind: "config_changed", path }];
};

// src/guards/tests/tree.ts
var outOfScope = (input, change) => input.testsProtected && input.scopePaths.length > 0 && change.status !== "A" && isTestFile(change.path) && !matchesAny(change.path, input.scopePaths) ? [{ kind: "out_of_scope", path: change.path }] : [];
var forChange = (input, change) => {
  if (change.status === "A") return compareNewTestFile(change.path, input.after(change.path) ?? "");
  const oldPath = change.oldPath ?? change.path;
  const before = input.before(oldPath);
  const after = change.status === "D" ? void 0 : input.after(change.path);
  return [
    ...compareTestFile(change.status === "R" ? oldPath : change.path, before, after),
    ...compareConfig(change.path, before, after, input.acceptedConfigs[change.path]),
    ...outOfScope(input, change)
  ];
};
var analyzeTree = (input) => input.changes.flatMap((change) => forChange(input, change));

// src/gate/checks/tests.ts
var MAX_LISTED4 = 10;
var violationNote = (violation) => note(`gate.tests.${violation.kind}`, {
  file: violation.path,
  before: violation.before ?? 0,
  after: violation.after ?? 0
});
var treeViolations = (ctx) => {
  const relevant = ctx.changes.filter(
    (change) => isTestFile(change.path) || isTestFile(change.oldPath ?? "") || isProtectedConfig(change.path)
  );
  return analyzeTree({
    changes: relevant,
    before: (path) => fileAt(ctx.git, ctx.base, path),
    after: (path) => {
      const text6 = ctx.runtime.readText(toAbsolutePath(join10(ctx.paths.root, path)));
      return text6.ok ? text6.value : void 0;
    },
    acceptedConfigs: ctx.trust.configs,
    scopePaths: ctx.contract.scope.paths,
    testsProtected: ctx.contract.scope.testsProtected
  });
};
var testsCheck = (check2, ctx) => {
  const violations = treeViolations(ctx);
  const grant = violations.length === 0 ? void 0 : activeGrant(ctx.runtime, ctx.paths, "tests", nowMs(ctx.runtime), ctx.sessionId);
  const notes2 = violations.slice(0, MAX_LISTED4).map(violationNote);
  if (violations.length > 0 && grant === void 0) return failed([...notes2, note("gate.tests.fix")]);
  const released2 = grant === void 0 ? {} : { releasedBy: `person@${grant.grantedAt}` };
  const releaseNotes = grant === void 0 ? [] : [...notes2, note("gate.note.released", { guard: "tests", reason: grant.reason })];
  if (check2.run === void 0) return { ...passed([note("gate.tests.clean"), ...releaseNotes]), ...released2 };
  const outcome = runShellCheck(check2, check2.run, ctx);
  return { ...outcome, notes: [...outcome.notes, ...releaseNotes], ...released2 };
};

// src/git/tree.ts
import { join as join11 } from "node:path";

// src/secrets/guards/paths.ts
var SAFE_ENV = /^\.env\.(?:example|sample|template|dist|defaults|schema)$/i;
var ENV_FILE = /^\.env(?:\..+)?$/i;
var KEY_FILE = /\.(?:pem|key|p12|pfx)$/i;
var SSH_KEY = /^id_(?:rsa|dsa|ecdsa|ed25519)(?:_[A-Za-z0-9_-]+)?$/;
var basename2 = (path) => path.split(/[\\/]/).pop() ?? path;
var isSensitivePath = (path) => {
  const name = basename2(path.replace(/^["']|["']$/g, ""));
  if (ENV_FILE.test(name)) return !SAFE_ENV.test(name);
  return KEY_FILE.test(name) || SSH_KEY.test(name);
};

// src/git/tree.ts
var IDENTITY_ENV = {
  GIT_AUTHOR_NAME: "finitemonkey",
  GIT_AUTHOR_EMAIL: "finitemonkey@localhost",
  GIT_COMMITTER_NAME: "finitemonkey",
  GIT_COMMITTER_EMAIL: "finitemonkey@localhost"
};
var failure = (step3, result) => result.timedOut ? `${step3}: timed out` : `${step3}: ${result.stderr.trim() || "git failed"}`;
var run = (runtime, repo, args, env, options, input) => {
  const result = runtime.gitWith(args, repo.root, {
    env,
    timeoutMs: options.timeoutMs,
    ...input === void 0 ? {} : { input }
  });
  return result.ok ? accept(result.stdout.trim()) : reject(failure(args[0] ?? "git", result));
};
var dropSensitive = (runtime, repo, env, options) => {
  const listed3 = run(runtime, repo, ["ls-files", "-z"], env, options);
  if (!listed3.ok) return listed3;
  const sensitive = listed3.value.split("\0").filter((path) => path !== "" && isSensitivePath(path));
  if (sensitive.length === 0) return accept(void 0);
  const removed = run(runtime, repo, ["rm", "--cached", "-q", "--ignore-unmatch", "--", ...sensitive], env, options);
  return removed.ok ? accept(void 0) : removed;
};
var withTempIndex = (runtime, repo, options, work) => {
  const path = toAbsolutePath(join11(repo.gitDir, `finitemonkey-${options.stamp}.index`));
  const env = { GIT_INDEX_FILE: path, GIT_OPTIONAL_LOCKS: "0" };
  try {
    return work(env);
  } finally {
    runtime.remove(path);
    runtime.remove(toAbsolutePath(`${path}.lock`));
  }
};
var worktreeTree = (runtime, repo, head, options) => withTempIndex(runtime, repo, options, (env) => {
  const read3 = run(runtime, repo, head === void 0 ? ["read-tree", "--empty"] : ["read-tree", head], env, options);
  if (!read3.ok) return read3;
  const added = run(runtime, repo, ["add", "-A", "--", ":/", ":(exclude,top).finitemonkey"], env, options);
  if (!added.ok) return added;
  const cleaned = dropSensitive(runtime, repo, env, options);
  if (!cleaned.ok) return cleaned;
  return run(runtime, repo, ["write-tree"], env, options);
});
var STAGE_ZERO = /^\d+ [0-9a-f]+ 0\t/;
var indexTree = (runtime, repo, options) => {
  const staged = run(runtime, repo, ["ls-files", "-s", "-z"], { GIT_OPTIONAL_LOCKS: "0" }, options);
  if (!staged.ok) return staged;
  const entries = staged.value.split("\0").filter((entry2) => STAGE_ZERO.test(entry2));
  return withTempIndex(runtime, repo, { ...options, stamp: `${options.stamp}-index` }, (env) => {
    const read3 = run(runtime, repo, ["read-tree", "--empty"], env, options);
    if (!read3.ok) return read3;
    if (entries.length === 0) return run(runtime, repo, ["write-tree"], env, options);
    const info = entries.map((entry2) => entry2.replace(/^(\d+ [0-9a-f]+) 0\t/, "$1	")).join("\0");
    const filled = run(runtime, repo, ["update-index", "-z", "--index-info"], env, options, `${info}\0`);
    if (!filled.ok) return filled;
    return run(runtime, repo, ["write-tree"], env, options);
  });
};
var commitTree = (runtime, repo, tree, parents, message, options) => run(
  runtime,
  repo,
  ["commit-tree", tree, ...parents.flatMap((parent) => ["-p", parent]), "-m", message],
  IDENTITY_ENV,
  options
);

// src/git/merge/diff-parse.ts
var HUNK3 = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
var BINARY = /^Binary files (?:a\/(.+)|\/dev\/null) and (?:b\/(.+)|\/dev\/null) differ$/;
var pathAfter = (line2, prefix) => {
  const value = line2.slice(prefix.length).replace(/\t$/, "");
  return value === "/dev/null" ? void 0 : value.replace(/^[ab]\//, "");
};
var flushHunk = (draft) => {
  if (draft.current !== void 0) draft.hunks.push(draft.current);
  draft.current = void 0;
};
var finish = (draft, out) => {
  if (draft === void 0) return;
  flushHunk(draft);
  out.push({
    oldPath: draft.oldPath,
    newPath: draft.newPath,
    status: draft.status,
    binary: draft.binary,
    hunks: draft.hunks
  });
};
var headerLine = (draft, line2) => {
  if (line2.startsWith("new file mode")) draft.status = "added";
  else if (line2.startsWith("deleted file mode")) draft.status = "deleted";
  else if (line2.startsWith(`rename from `)) {
    draft.status = "renamed";
    draft.oldPath = line2.slice(`rename from `.length);
  } else if (line2.startsWith("rename to ")) draft.newPath = line2.slice("rename to ".length);
  else if (line2.startsWith(`copy from `)) {
    draft.status = "copied";
    draft.oldPath = line2.slice(`copy from `.length);
  } else if (line2.startsWith("copy to ")) draft.newPath = line2.slice("copy to ".length);
  else if (line2.startsWith("--- ")) draft.oldPath = pathAfter(line2, "--- ");
  else if (line2.startsWith("+++ ")) draft.newPath = pathAfter(line2, "+++ ");
  else {
    const binary2 = BINARY.exec(line2);
    if (binary2 === null) return;
    draft.binary = true;
    draft.oldPath = binary2[1];
    draft.newPath = binary2[2];
  }
};
var bodyLine = (draft, line2) => {
  const hunk = HUNK3.exec(line2);
  if (hunk !== null) {
    flushHunk(draft);
    draft.current = {
      oldStart: Number(hunk[1]),
      oldCount: hunk[2] === void 0 ? 1 : Number(hunk[2]),
      newStart: Number(hunk[3]),
      removed: [],
      added: []
    };
    return;
  }
  if (draft.current === void 0) {
    headerLine(draft, line2);
    return;
  }
  if (line2.startsWith("-")) draft.current.removed.push(line2.slice(1));
  else if (line2.startsWith("+")) draft.current.added.push(line2.slice(1));
};
var DIFF_GIT = /^diff --git a\/(.+) b\/(.+)$/;
var parseUnifiedDiff = (text6) => {
  const out = [];
  let draft;
  for (const raw of text6.split("\n")) {
    const line2 = withoutCarriageReturn(raw);
    const start = DIFF_GIT.exec(line2);
    if (start !== null) {
      finish(draft, out);
      draft = {
        oldPath: start[1],
        newPath: start[2],
        status: "modified",
        binary: false,
        hunks: [],
        current: void 0
      };
    } else if (draft !== void 0) bodyLine(draft, line2);
  }
  finish(draft, out);
  return out;
};
var DIFF_ARGS = [
  "-c",
  "core.quotePath=false",
  "diff",
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--histogram",
  "-M",
  "-C",
  "--unified=0",
  "--ignore-space-at-eol",
  "--src-prefix=a/",
  "--dst-prefix=b/"
];

// src/git/merge/inputs.ts
var revParse = (runtime, repo, rev) => {
  const result = runtime.git(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], repo.root);
  const value = result.stdout.trim();
  return result.ok && value !== "" ? value : void 0;
};
var parentsOf = (runtime, repo, commit2) => {
  const result = runtime.git(["rev-list", "--parents", "-n", "1", commit2], repo.root);
  return result.ok ? result.stdout.trim().split(" ").slice(1) : [];
};
var basesOf = (runtime, repo, ours, theirs) => {
  const result = runtime.git(["merge-base", "--all", ours, theirs], repo.root);
  return result.ok ? result.stdout.split("\n").filter((line2) => line2 !== "") : [];
};
var withBase = (runtime, repo, ours, theirs, result, label2) => {
  const bases = basesOf(runtime, repo, ours, theirs);
  const base = bases[0];
  if (base === void 0) return reject("no merge base between the two sides");
  return accept({ base, ours, theirs, result, resultLabel: label2, bases: bases.length });
};
var inProgress = (runtime, repo) => {
  const theirs = revParse(runtime, repo, "MERGE_HEAD");
  const ours = revParse(runtime, repo, "HEAD");
  if (theirs === void 0 || ours === void 0) return void 0;
  const tree = worktreeTree(runtime, repo, ours, {
    timeoutMs: 6e4,
    stamp: `verify-${runtime.now().replace(/[:.]/g, "-")}`
  });
  if (!tree.ok) return reject(tree.error);
  return withBase(runtime, repo, ours, theirs, tree.value, "working tree");
};
var resolveMergeInputs = (runtime, repo, rev) => {
  if (rev === void 0) {
    const pending = inProgress(runtime, repo);
    if (pending !== void 0) return pending;
  }
  const commit2 = revParse(runtime, repo, rev ?? "HEAD");
  if (commit2 === void 0) return reject(`not a commit: ${rev ?? "HEAD"}`);
  const parents = parentsOf(runtime, repo, commit2);
  const [ours, theirs] = parents;
  if (parents.length !== 2 || ours === void 0 || theirs === void 0) {
    return reject(parents.length > 2 ? "octopus merges are not analyzed" : `not a merge commit: ${commit2}`);
  }
  return withBase(runtime, repo, ours, theirs, commit2, commit2);
};
var sideDiff = (runtime, repo, from, to) => {
  const result = runtime.git([...DIFF_ARGS, from, to], repo.root);
  return result.ok ? accept(parseUnifiedDiff(result.stdout)) : reject(`git diff ${from} ${to} failed`);
};
var blobText = (runtime, repo, rev, path) => {
  const result = runtime.git(["cat-file", "blob", `${rev}:${path}`], repo.root);
  return result.ok ? result.stdout : void 0;
};
var blobId = (runtime, repo, rev, path) => {
  const result = runtime.git(["rev-parse", "--verify", "--quiet", `${rev}:${path}`], repo.root);
  const value = result.stdout.trim();
  return result.ok && value !== "" ? value : void 0;
};
var mergeCommitsSince = (runtime, repo, since) => {
  const range = since === void 0 ? ["HEAD", "--not", "--remotes"] : [`${since}..HEAD`];
  const result = runtime.git(["rev-list", "--merges", ...range], repo.root);
  return result.ok ? result.stdout.split("\n").filter((line2) => line2 !== "") : [];
};
var mergeInProgress = (runtime, repo) => revParse(runtime, repo, "MERGE_HEAD") !== void 0;

// src/git/facts.ts
var memo2 = (compute) => {
  let cached2;
  return () => {
    cached2 ??= { value: compute() };
    return cached2.value;
  };
};
var memoBy = (compute) => {
  const cache = /* @__PURE__ */ new Map();
  return (key) => {
    const hit2 = cache.get(key);
    if (hit2 !== void 0) return hit2.value;
    const value = compute(key);
    cache.set(key, { value });
    return value;
  };
};
var STATE_PREFIX = ".finitemonkey/";
var PORCELAIN_FIELDS = { ordinary: 8, renamed: 9, unmerged: 10 };
var entryOf = (kind, xy, path) => ({
  path,
  kind,
  staged: kind !== "untracked" && !xy.startsWith("."),
  unstaged: kind === "untracked" || xy.charAt(1) !== "."
});
var afterFields = (record2, count3) => record2.split(" ").slice(count3).join(" ");
var parsePorcelainV2 = (stdout) => {
  const records = stdout.split("\0");
  const out = [];
  for (let index = 0; index < records.length; index += 1) {
    const record2 = records[index] ?? "";
    const xy = record2.split(" ")[1] ?? "..";
    if (record2.startsWith("1 ")) out.push(entryOf("changed", xy, afterFields(record2, PORCELAIN_FIELDS.ordinary)));
    else if (record2.startsWith("2 ")) {
      out.push(entryOf("changed", xy, afterFields(record2, PORCELAIN_FIELDS.renamed)));
      index += 1;
    } else if (record2.startsWith("u ")) {
      out.push(entryOf("unmerged", xy, afterFields(record2, PORCELAIN_FIELDS.unmerged)));
    } else if (record2.startsWith("? ")) out.push(entryOf("untracked", "??", record2.slice(2)));
  }
  return out.filter((entry2) => entry2.path !== "" && !entry2.path.startsWith(STATE_PREFIX));
};

// src/git/project-config.ts
import { join as join12 } from "node:path";
var CONFIG_FILE = ".finitemonkey/config.yml";
var unquote = (value) => value.trim().replace(/^(["'])(.*)\1$/s, "$2");
var stripComment2 = (line2) => {
  let quote;
  for (let index = 0; index < line2.length; index += 1) {
    const char = line2.charAt(index);
    if (quote === void 0 && (char === '"' || char === "'")) quote = char;
    else if (char === quote) quote = void 0;
    else if (quote === void 0 && char === "#" && (index === 0 || /\s/.test(line2.charAt(index - 1)))) {
      return line2.slice(0, index);
    }
  }
  return line2;
};
var flowList = (value) => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return void 0;
  return trimmed.slice(1, -1).split(",").map(unquote).filter((item) => item !== "");
};
var keyValue = (body) => {
  const match = /^("[^"]*"|'[^']*'|[^:]+?)\s*:(?:\s+(.*))?$/.exec(body);
  if (match === null) return void 0;
  return { key: unquote(match[1] ?? ""), value: match[2] ?? "" };
};
var addItem = (frame, item) => {
  if (frame.key === void 0) return;
  const parent = frame.tree[frame.key];
  if (Array.isArray(parent)) parent.push(item);
  else frame.tree[frame.key] = [item];
};
var placeLine = (stack, indent, body) => {
  while (stack.length > 1 && (stack[stack.length - 1]?.indent ?? 0) >= indent && !body.startsWith("- ")) stack.pop();
  const top = stack[stack.length - 1];
  if (top === void 0) return;
  if (body.startsWith("- ")) {
    addItem(top, unquote(body.slice(2)));
    return;
  }
  const pair = keyValue(body);
  if (pair === void 0) return;
  const parentTree = top.key === void 0 ? top.tree : ensureTree(top.tree, top.key);
  if (pair.value === "") {
    stack.push({ indent, tree: parentTree, key: pair.key });
    return;
  }
  parentTree[pair.key] = flowList(pair.value) ?? unquote(pair.value);
};
var ensureTree = (tree, key) => {
  const existing = tree[key];
  if (existing !== void 0 && typeof existing !== "string" && !Array.isArray(existing)) return existing;
  const fresh3 = {};
  tree[key] = fresh3;
  return fresh3;
};
var parseConfigYaml = (text6) => {
  const root = {};
  const stack = [{ indent: -1, tree: root, key: void 0 }];
  for (const raw of text6.split(/\r?\n/)) {
    const line2 = stripComment2(raw).trimEnd();
    if (line2.trim() === "" || line2.trim() === "---") continue;
    const indent = line2.length - line2.trimStart().length;
    placeLine(stack, indent, line2.trim());
  }
  return root;
};
var isTree = (node) => typeof node === "object" && !Array.isArray(node);
var configAt = (tree, ...path) => path.reduce((node, key) => isTree(node) ? node[key] : void 0, tree);
var configList = (tree, ...path) => {
  const node = configAt(tree, ...path);
  if (typeof node === "string") return node === "" ? [] : [node];
  return Array.isArray(node) ? node.filter((item) => typeof item === "string") : [];
};
var configMap = (tree, ...path) => {
  const node = configAt(tree, ...path);
  if (!isTree(node)) return {};
  return Object.fromEntries(
    Object.entries(node).filter((entry2) => typeof entry2[1] === "string")
  );
};
var loadProjectConfig = (runtime, root) => {
  const text6 = runtime.readText(toAbsolutePath(join12(root, CONFIG_FILE)));
  return text6.ok ? parseConfigYaml(text6.value) : {};
};

// src/git/merge/dropped.ts
import { join as join13 } from "node:path";

// src/git/merge/lines.ts
var normalizeLine = (line2) => line2.replace(/\r$/, "").trimEnd().trim();
var WEAK = /^[\p{P}\p{S}\s]+$/u;
var isWeak = (line2) => WEAK.test(line2);
var meaningful = (lines3) => lines3.map(normalizeLine).filter((line2) => line2 !== "");
var contentLines = (text6) => text6 === void 0 ? [] : meaningful(text6.split("\n"));
var countLines = (lines3) => {
  const counts = /* @__PURE__ */ new Map();
  for (const line2 of lines3) counts.set(line2, (counts.get(line2) ?? 0) + 1);
  return counts;
};
var countOf = (counts, line2) => counts.get(line2) ?? 0;
var containsSequence = (haystack, needle) => {
  if (needle.length === 0) return true;
  const first = needle[0];
  for (let start = haystack.indexOf(first ?? ""); start >= 0; start = haystack.indexOf(first ?? "", start + 1)) {
    if (needle.every((line2, offset) => haystack[start + offset] === line2)) return true;
  }
  return false;
};

// src/git/merge/types.ts
var DROPPED_REASONS = [
  "mesma_intencao_outro_lado",
  "revertido_de_proposito",
  "regenerado",
  "movido_para",
  "decisao_humana"
];

// src/git/merge/dropped.ts
var DROPPED_FILE = ".finitemonkey/merge-dropped.json";
var REASONS = new Set(DROPPED_REASONS);
var ALIASES = {
  same_intent_other_side: "mesma_intencao_outro_lado",
  reverted_on_purpose: "revertido_de_proposito",
  regenerated: "regenerado",
  moved_to: "movido_para",
  human_decision: "decisao_humana"
};
var sideOf = (value) => value === "ours" || value === "theirs" ? value : void 0;
var itemOf = (value) => {
  if (!isRecord(value)) return void 0;
  const file = optionalString(value, "file");
  const reason = optionalString(value, "reason");
  if (file === void 0 || reason === void 0) return void 0;
  return {
    file,
    side: sideOf(optionalString(value, "side")),
    text: optionalString(value, "line") ?? optionalString(value, "text") ?? optionalString(value, "symbol"),
    reason: ALIASES[reason] ?? reason,
    approvedBy: optionalString(value, "approved_by")
  };
};
var invalidFinding = (file, text6) => ({
  kind: "invalid-dropped",
  file,
  side: void 0,
  line: void 0,
  text: text6,
  weak: false
});
var parseDropped = (text6) => {
  const parsed = parseJson(text6);
  if (!parsed.ok) return parsed;
  const list4 = isRecord(parsed.value) ? parsed.value["dropped"] : parsed.value;
  if (!Array.isArray(list4)) return reject("expected a list of dropped items");
  const items = [];
  const invalid = [];
  list4.forEach((value, index) => {
    const item = itemOf(value);
    if (item === void 0) invalid.push(invalidFinding(DROPPED_FILE, `item ${String(index)}: needs file and reason`));
    else if (!REASONS.has(item.reason)) invalid.push(invalidFinding(item.file, `reason ${item.reason}`));
    else items.push(item);
  });
  return accept({ items, invalid });
};
var loadDropped = (runtime, root, file) => {
  const path = toAbsolutePath(file ?? join13(root, DROPPED_FILE), root);
  const text6 = runtime.readText(path);
  if (!text6.ok) return file === void 0 ? accept({ items: [], invalid: [] }) : reject(`${file}: ${text6.error}`);
  return parseDropped(text6.value);
};
var isDropped = (finding2, items) => items.some(
  (item) => item.file === finding2.file && (item.side === void 0 || finding2.side === void 0 || item.side === finding2.side) && (item.text === void 0 || normalizeLine(item.text) === finding2.text)
);

// src/git/merge/generated.ts
import { join as join14 } from "node:path";

// src/shell/normalize.ts
import { posix } from "node:path";

// src/shell/scan.ts
var cursorOf = (text6) => ({ text: text6, pos: 0, incomplete: false, subs: [] });
var peek = (cursor, offset = 0) => cursor.text.charAt(cursor.pos + offset);
var atEnd = (cursor) => cursor.pos >= cursor.text.length;
var skipQuoted2 = (cursor, quote) => {
  cursor.pos += 1;
  while (!atEnd(cursor) && peek(cursor) !== quote) {
    cursor.pos += quote === '"' && peek(cursor) === "\\" ? 2 : 1;
  }
  cursor.pos += 1;
};
var readBalanced = (cursor, open, close2) => {
  const start = cursor.pos;
  let depth = 1;
  while (!atEnd(cursor)) {
    const char = peek(cursor);
    if (char === "\\") cursor.pos += 2;
    else if (char === "'" || char === '"') skipQuoted2(cursor, char);
    else {
      if (char === open) depth += 1;
      if (char === close2) depth -= 1;
      if (depth === 0) {
        const inner = cursor.text.slice(start, cursor.pos);
        cursor.pos += 1;
        return inner;
      }
      cursor.pos += 1;
    }
  }
  cursor.incomplete = true;
  return cursor.text.slice(start);
};
var readUntil = (cursor, terminator, escapes) => {
  let out = "";
  while (!atEnd(cursor) && peek(cursor) !== terminator) {
    if (escapes && peek(cursor) === "\\" && cursor.pos + 1 < cursor.text.length) {
      out += peek(cursor, 1);
      cursor.pos += 2;
    } else {
      out += peek(cursor);
      cursor.pos += 1;
    }
  }
  if (atEnd(cursor)) cursor.incomplete = true;
  cursor.pos += 1;
  return out;
};
var ANSI2 = {
  n: "\n",
  t: "	",
  r: "\r",
  "\\": "\\",
  "'": "'",
  '"': '"',
  e: "\x1B"
};
var readAnsiC = (cursor) => {
  let out = "";
  while (!atEnd(cursor) && peek(cursor) !== "'") {
    if (peek(cursor) === "\\") {
      const next2 = peek(cursor, 1);
      const hex = /^x([0-9a-fA-F]{1,2})/.exec(cursor.text.slice(cursor.pos + 1, cursor.pos + 4));
      if (hex !== null) {
        out += String.fromCharCode(Number.parseInt(hex[1] ?? "0", 16));
        cursor.pos += 1 + hex[0].length;
        continue;
      }
      out += ANSI2[next2] ?? next2;
      cursor.pos += 2;
    } else {
      out += peek(cursor);
      cursor.pos += 1;
    }
  }
  if (atEnd(cursor)) cursor.incomplete = true;
  cursor.pos += 1;
  return out;
};

// src/shell/lexer.ts
var OPERATORS = ["&&", "||", ";;", "|&", "|", "&", ";", "(", ")", "\n"];
var REDIRECT2 = /^(\d*)(<<<|<<-|<<|<>|<&|>>|>&|>\||<|>)|^(&>>|&>)/;
var BOUNDARY = /* @__PURE__ */ new Set([" ", "	", "\n", "|", "&", ";", "(", ")", "<", ">"]);
var dollar = (cursor, state, inDouble) => {
  const next2 = peek(cursor, 1);
  state.dynamic = true;
  if (next2 === "(" && peek(cursor, 2) === "(") {
    cursor.pos += 3;
    state.text += `$((${readBalanced(cursor, "(", ")")})`;
    if (peek(cursor) === ")") cursor.pos += 1;
  } else if (next2 === "(") {
    cursor.pos += 2;
    const inner = readBalanced(cursor, "(", ")");
    cursor.subs.push(inner);
    state.text += `$(${inner})`;
  } else if (next2 === "{") {
    cursor.pos += 2;
    state.text += `\${${readBalanced(cursor, "{", "}")}}`;
  } else if (next2 === "'" && !inDouble) {
    cursor.pos += 2;
    state.dynamic = false;
    state.quoted = true;
    state.text += readAnsiC(cursor);
  } else {
    cursor.pos += 1;
    state.text += "$";
  }
};
var backtick = (cursor, state) => {
  cursor.pos += 1;
  const inner = readUntil(cursor, "`", true);
  cursor.subs.push(inner);
  state.text += `\`${inner}\``;
  state.dynamic = true;
};
var DOUBLE_ESCAPES = /* @__PURE__ */ new Set(["$", "`", '"', "\\", "\n"]);
var doubleQuoted = (cursor, state) => {
  cursor.pos += 1;
  state.quoted = true;
  while (!atEnd(cursor) && peek(cursor) !== '"') {
    const char = peek(cursor);
    if (char === "\\" && DOUBLE_ESCAPES.has(peek(cursor, 1))) {
      if (peek(cursor, 1) !== "\n") state.text += peek(cursor, 1);
      cursor.pos += 2;
    } else if (char === "$") dollar(cursor, state, true);
    else if (char === "`") backtick(cursor, state);
    else {
      state.text += char;
      cursor.pos += 1;
    }
  }
  if (atEnd(cursor)) cursor.incomplete = true;
  cursor.pos += 1;
};
var wordPart = (cursor, state) => {
  const char = peek(cursor);
  if (char === "\\") {
    if (peek(cursor, 1) !== "\n") state.text += peek(cursor, 1);
    cursor.pos += 2;
  } else if (char === "'") {
    cursor.pos += 1;
    state.quoted = true;
    state.text += readUntil(cursor, "'", false);
  } else if (char === '"') doubleQuoted(cursor, state);
  else if (char === "$") dollar(cursor, state, false);
  else if (char === "`") backtick(cursor, state);
  else {
    state.text += char;
    cursor.pos += 1;
  }
};
var readWord = (cursor) => {
  const state = { text: "", quoted: false, dynamic: false };
  while (!atEnd(cursor) && !BOUNDARY.has(peek(cursor))) wordPart(cursor, state);
  return { kind: "word", ...state };
};
var skipBlank = (cursor) => {
  while (peek(cursor) === " " || peek(cursor) === "	" || peek(cursor) === "\\" && peek(cursor, 1) === "\n") {
    cursor.pos += peek(cursor) === "\\" ? 2 : 1;
  }
};
var heredocBody = (cursor, delimiter, stripTabs) => {
  const lines3 = [];
  while (!atEnd(cursor)) {
    const end = cursor.text.indexOf("\n", cursor.pos);
    const line2 = cursor.text.slice(cursor.pos, end < 0 ? void 0 : end);
    cursor.pos = end < 0 ? cursor.text.length : end + 1;
    const compared = stripTabs ? line2.replace(/^\t+/, "") : line2;
    if (compared === delimiter) return lines3.join("\n");
    lines3.push(compared);
  }
  cursor.incomplete = true;
  return lines3.join("\n");
};
var readRedirect = (cursor, match) => {
  const op = match[2] ?? match[3] ?? "";
  cursor.pos += match[0].length;
  skipBlank(cursor);
  const processSub = peek(cursor) === "(" && op === "<";
  const target = processSub ? "" : readWord(cursor).text;
  return { kind: "redirect", op, fd: match[1] ?? "", target, body: void 0 };
};
var processSubstitution = (cursor) => {
  if (peek(cursor) !== "<" && peek(cursor) !== ">" || peek(cursor, 1) !== "(") return false;
  cursor.pos += 2;
  cursor.subs.push(readBalanced(cursor, "(", ")"));
  return true;
};
var flushHeredocs = (cursor, tokens, pending) => {
  for (const { index, token } of pending.splice(0)) {
    tokens[index] = { ...token, body: heredocBody(cursor, token.target, token.op === "<<-") };
  }
};
var nextToken = (cursor, tokens, pending) => {
  if (peek(cursor) === "#") {
    const end = cursor.text.indexOf("\n", cursor.pos);
    cursor.pos = end < 0 ? cursor.text.length : end;
    return;
  }
  if (processSubstitution(cursor)) return;
  const redirect = REDIRECT2.exec(cursor.text.slice(cursor.pos, cursor.pos + 4));
  if (redirect !== null) {
    const token = readRedirect(cursor, redirect);
    if (token.op === "<<" || token.op === "<<-") pending.push({ index: tokens.length, token });
    tokens.push(token);
    return;
  }
  const op = OPERATORS.find((candidate) => cursor.text.startsWith(candidate, cursor.pos));
  if (op === void 0) {
    tokens.push(readWord(cursor));
    return;
  }
  cursor.pos += op.length;
  tokens.push({ kind: "op", text: op });
  if (op === "\n") flushHeredocs(cursor, tokens, pending);
};
var lexBash = (text6) => {
  const cursor = cursorOf(text6.replace(/\r\n/g, "\n"));
  const tokens = [];
  const pending = [];
  skipBlank(cursor);
  while (!atEnd(cursor)) {
    nextToken(cursor, tokens, pending);
    skipBlank(cursor);
  }
  flushHeredocs(cursor, tokens, pending);
  return { tokens, substitutions: cursor.subs, incomplete: cursor.incomplete };
};

// src/shell/parse.ts
var PREFIX_WORDS = /* @__PURE__ */ new Set(["!", "{", "}", "if", "then", "elif", "else", "do", "while", "until"]);
var SKIP_WORDS = /* @__PURE__ */ new Set(["fi", "done", "esac", "}", "for", "case", "select", "function", "in"]);
var trimKeywords = (words) => {
  let start = 0;
  while (start < words.length && !words[start]?.quoted && PREFIX_WORDS.has(words[start]?.text ?? "")) start += 1;
  const rest = words.slice(start);
  const first = rest[0];
  if (first !== void 0 && !first.quoted && SKIP_WORDS.has(first.text)) return [];
  return rest;
};
var fresh2 = () => ({ words: [], redirects: [], stdin: void 0 });
var close = (building, out) => {
  const words = trimKeywords(building.words);
  if (words.length > 0 || building.redirects.length > 0 || building.stdin !== void 0) {
    out.push({ words, redirects: building.redirects, stdin: building.stdin });
  }
};
var rawCommands = (tokens) => {
  const out = [];
  let building = fresh2();
  for (const token of tokens) {
    if (token.kind === "op") {
      close(building, out);
      building = fresh2();
    } else if (token.kind === "word") {
      building.words.push(token);
    } else {
      building.redirects.push({ op: token.op, fd: token.fd, target: token.target });
      if (token.body !== void 0) building.stdin = token.body;
      else if (token.op === "<<<") building.stdin = token.target;
    }
  }
  close(building, out);
  return out;
};

// src/shell/powershell.ts
var OPERATORS2 = ["&&", "||", ";", "|", "\n", "(", ")", "{", "}"];
var REDIRECT3 = /^(\*|\d)?(>>|>)(&\d)?/;
var BOUNDARY2 = /* @__PURE__ */ new Set([" ", "	", "\n", ";", "|", "(", ")", "{", "}", ">"]);
var single = (cursor, state) => {
  cursor.pos += 1;
  state.quoted = true;
  while (!atEnd(cursor)) {
    if (peek(cursor) === "'" && peek(cursor, 1) === "'") {
      state.text += "'";
      cursor.pos += 2;
    } else if (peek(cursor) === "'") {
      cursor.pos += 1;
      return;
    } else {
      state.text += peek(cursor);
      cursor.pos += 1;
    }
  }
  cursor.incomplete = true;
};
var subexpression = (cursor, state) => {
  cursor.pos += 2;
  const inner = readBalanced(cursor, "(", ")");
  cursor.subs.push(inner);
  state.text += `$(${inner})`;
  state.dynamic = true;
};
var double = (cursor, state) => {
  cursor.pos += 1;
  state.quoted = true;
  while (!atEnd(cursor)) {
    const char = peek(cursor);
    if (char === "`") {
      state.text += peek(cursor, 1);
      cursor.pos += 2;
    } else if (char === '"' && peek(cursor, 1) === '"') {
      state.text += '"';
      cursor.pos += 2;
    } else if (char === '"') {
      cursor.pos += 1;
      return;
    } else if (char === "$" && peek(cursor, 1) === "(") subexpression(cursor, state);
    else {
      if (char === "$") state.dynamic = true;
      state.text += char;
      cursor.pos += 1;
    }
  }
  cursor.incomplete = true;
};
var part = (cursor, state) => {
  const char = peek(cursor);
  if (char === "`") {
    state.text += peek(cursor, 1);
    cursor.pos += 2;
  } else if (char === "'") single(cursor, state);
  else if (char === '"') double(cursor, state);
  else if (char === "$" && peek(cursor, 1) === "(") subexpression(cursor, state);
  else {
    if (char === "$") state.dynamic = true;
    state.text += char;
    cursor.pos += 1;
  }
};
var word = (cursor, ampersandSplits) => {
  const state = { text: "", quoted: false, dynamic: false };
  while (!atEnd(cursor) && !BOUNDARY2.has(peek(cursor)) && !(ampersandSplits && peek(cursor) === "&")) {
    part(cursor, state);
  }
  return { kind: "word", ...state };
};
var skipComment2 = (cursor) => {
  if (cursor.text.startsWith("<#", cursor.pos)) {
    const end2 = cursor.text.indexOf("#>", cursor.pos);
    cursor.pos = end2 < 0 ? cursor.text.length : end2 + 2;
    return true;
  }
  if (peek(cursor) !== "#") return false;
  const end = cursor.text.indexOf("\n", cursor.pos);
  cursor.pos = end < 0 ? cursor.text.length : end;
  return true;
};
var commandStart = (tokens) => {
  const last = tokens[tokens.length - 1];
  return last === void 0 || last.kind === "op";
};
var next = (cursor, tokens, cmd) => {
  if (skipComment2(cursor)) return;
  const redirect = REDIRECT3.exec(cursor.text.slice(cursor.pos, cursor.pos + 5));
  if (redirect !== null) {
    cursor.pos += redirect[0].length;
    while (peek(cursor) === " ") cursor.pos += 1;
    const target = redirect[3] ?? word(cursor, cmd).text;
    tokens.push({ kind: "redirect", op: redirect[2] ?? ">", fd: redirect[1] ?? "", target, body: void 0 });
    return;
  }
  const op = OPERATORS2.find((candidate) => cursor.text.startsWith(candidate, cursor.pos));
  if (op !== void 0 || cmd && peek(cursor) === "&") {
    const text6 = op ?? "&";
    cursor.pos += text6.length;
    tokens.push({ kind: "op", text: text6 });
    return;
  }
  if ((peek(cursor) === "&" || peek(cursor) === ".") && peek(cursor, 1) === " " && commandStart(tokens)) {
    cursor.pos += 2;
    return;
  }
  tokens.push(word(cursor, cmd));
};
var lexPowerShell = (text6, cmd = false) => {
  const cursor = cursorOf(text6.replace(/\r\n/g, "\n"));
  const tokens = [];
  const skip = () => {
    while (peek(cursor) === " " || peek(cursor) === "	") cursor.pos += 1;
  };
  skip();
  while (!atEnd(cursor)) {
    next(cursor, tokens, cmd);
    skip();
  }
  return { tokens, substitutions: cursor.subs, incomplete: cursor.incomplete };
};
var ALIASES2 = {
  ri: "remove-item",
  rm: "remove-item",
  rmdir: "remove-item",
  del: "remove-item",
  erase: "remove-item",
  rd: "remove-item",
  cd: "set-location",
  chdir: "set-location",
  sl: "set-location",
  pushd: "push-location"
};
var powershellProgram = (name) => ALIASES2[name.toLowerCase()] ?? name.toLowerCase();

// src/shell/wrappers.ts
var spec = (withValue, positionals = 0, queries = []) => ({
  withValue: new Set(withValue),
  positionals,
  queries: new Set(queries)
});
var WRAPPERS2 = {
  sudo: spec(["-u", "-g", "-h", "-p", "-C", "-D", "-r", "-t", "-U", "-T", "--user", "--group", "--host", "--prompt"]),
  doas: spec(["-u", "-C"]),
  command: spec([], 0, ["-v", "-V"]),
  builtin: spec([]),
  exec: spec(["-a"]),
  nohup: spec([]),
  time: spec(["-f", "-o", "--format", "--output"]),
  nice: spec(["-n", "--adjustment"]),
  ionice: spec(["-c", "-n", "-p", "--class", "--classdata"]),
  timeout: spec(["-s", "-k", "--signal", "--kill-after"], 1),
  stdbuf: spec(["-i", "-o", "-e", "--input", "--output", "--error"]),
  xargs: spec([
    "-I",
    "-n",
    "-P",
    "-d",
    "-L",
    "-E",
    "-s",
    "-a",
    "--max-args",
    "--max-procs",
    "--delimiter",
    "--arg-file"
  ]),
  watch: spec(["-n", "--interval"]),
  chronic: spec([]),
  unbuffer: spec([]),
  npx: spec(["-p", "--package", "-c", "--call"]),
  bunx: spec([]),
  "run-one": spec([])
};
var SHELLS2 = /* @__PURE__ */ new Set(["sh", "bash", "zsh", "dash", "ksh", "ash", "fish", "busybox"]);
var SHELL_WITH_VALUE = /* @__PURE__ */ new Set(["-o", "+o", "-O", "+O", "--rcfile", "--init-file"]);
var POWERSHELLS = /* @__PURE__ */ new Set(["powershell", "pwsh", "powershell.exe", "pwsh.exe"]);

// src/shell/unwrap.ts
var ASSIGNMENT2 = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;
var EXECUTABLE_SUFFIX = /\.(?:exe|cmd|bat|com)$/i;
var MAX_LAYERS = 16;
var programName = (word2) => {
  const base = word2.split(/[\\/]/).pop() ?? word2;
  return EXECUTABLE_SUFFIX.test(base) ? base.replace(EXECUTABLE_SUFFIX, "").toLowerCase() : base;
};
var withAssignments = (stage) => {
  const env = { ...stage.env };
  let index = 0;
  for (; index < stage.argv.length; index += 1) {
    const match = ASSIGNMENT2.exec(stage.argv[index] ?? "");
    if (match === null) break;
    env[match[1] ?? ""] = match[2] ?? "";
  }
  return { ...stage, argv: stage.argv.slice(index), env };
};
var skipOptions = (args, wrapper) => {
  let index = 0;
  while (index < args.length) {
    const arg = args[index] ?? "";
    if (arg === "--") return index + 1 + wrapper.positionals;
    if (!arg.startsWith("-") || arg === "-") break;
    if (wrapper.queries.has(arg)) return void 0;
    index += wrapper.withValue.has(arg) ? 2 : 1;
  }
  return index + wrapper.positionals;
};
var shift = (stage, count3, name) => ({
  ...stage,
  argv: stage.argv.slice(count3),
  via: [...stage.via, name]
});
var envCommand = (stage) => {
  let index = 1;
  while (index < stage.argv.length && (stage.argv[index] ?? "").startsWith("-")) {
    const arg = stage.argv[index] ?? "";
    if (arg === "-S" || arg === "--split-string") {
      return { kind: "script", script: stage.argv.slice(index + 1).join(" "), dialect: "bash", stage };
    }
    if (arg === "--") {
      index += 1;
      break;
    }
    index += arg === "-u" || arg === "-C" || arg === "--unset" || arg === "--chdir" ? 2 : 1;
  }
  return shift(stage, index, "env");
};
var shellScript = (stage, name, stdin) => {
  const args = stage.argv.slice(1);
  let index = 0;
  let command = false;
  while (index < args.length && /^[-+]/.test(args[index] ?? "")) {
    const arg = args[index] ?? "";
    if (/^-[A-Za-z]*c[A-Za-z]*$/.test(arg)) command = true;
    index += SHELL_WITH_VALUE.has(arg) ? 2 : 1;
  }
  const script = args[index];
  if (command && script !== void 0) return { kind: "script", script, dialect: "bash", stage: shift(stage, 0, name) };
  if (script === void 0 && stdin !== void 0) return { kind: "script", script: stdin, dialect: "bash", stage };
  return void 0;
};
var decodeEncoded = (value) => Buffer.from(value, "base64").toString("utf16le");
var powershellScript = (stage, name) => {
  const args = stage.argv.slice(1);
  const at = args.findIndex((arg) => /^[-/](?:c|co|com|comm|comma|comman|command)$/i.test(arg));
  const encoded = args.findIndex((arg) => /^[-/](?:e|ec|enc|encodedcommand)$/i.test(arg));
  if (at >= 0) {
    return {
      kind: "script",
      script: args.slice(at + 1).join(" "),
      dialect: "powershell",
      stage: shift(stage, 0, name)
    };
  }
  const value = encoded >= 0 ? args[encoded + 1] : void 0;
  if (value !== void 0) {
    return { kind: "script", script: decodeEncoded(value), dialect: "powershell", stage: shift(stage, 0, name) };
  }
  return void 0;
};
var cmdScript = (stage) => {
  const at = stage.argv.findIndex((arg, index) => index > 0 && /^\/[ck]$/i.test(arg));
  if (at < 0) return void 0;
  return { kind: "script", script: stage.argv.slice(at + 1).join(" "), dialect: "cmd", stage: shift(stage, 0, "cmd") };
};
var findExec = (stage) => {
  const extra = [];
  stage.argv.forEach((arg, index) => {
    if (!["-exec", "-execdir", "-ok", "-okdir"].includes(arg)) return;
    const rest = stage.argv.slice(index + 1);
    const end = rest.findIndex((word2) => word2 === ";" || word2 === "+");
    extra.push({ ...stage, argv: end < 0 ? rest : rest.slice(0, end), via: [...stage.via, "find -exec"] });
  });
  return extra;
};
var step = (stage, stdin) => {
  const name = programName(stage.argv[0] ?? "");
  const lower = name.toLowerCase();
  if (name === "env") {
    const result = envCommand(stage);
    return "kind" in result ? { done: result } : { next: result };
  }
  if (name === "busybox") return { next: shift(stage, 1, name) };
  const wrapper = WRAPPERS2[name];
  if (wrapper !== void 0) {
    const skip = skipOptions(stage.argv.slice(1), wrapper);
    return skip === void 0 ? { done: { kind: "none" } } : { next: shift(stage, 1 + skip, name) };
  }
  if (name === "eval")
    return { done: { kind: "script", script: stage.argv.slice(1).join(" "), dialect: "bash", stage } };
  const script = SHELLS2.has(name) ? shellScript(stage, name, stdin) : POWERSHELLS.has(lower) ? powershellScript(stage, name) : lower === "cmd" ? cmdScript(stage) : void 0;
  if (script !== void 0) return { done: script };
  return { done: { kind: "command", stage, extra: name === "find" ? findExec(stage) : [] } };
};
var unwrap2 = (initial, stdin) => {
  let stage = initial;
  for (let layer = 0; layer < MAX_LAYERS; layer += 1) {
    stage = withAssignments(stage);
    if (stage.argv.length === 0) return { kind: "none" };
    const result = step(stage, stdin);
    if ("done" in result) return result.done;
    stage = result.next;
  }
  return { kind: "command", stage, extra: [] };
};

// src/shell/normalize.ts
var MAX_DEPTH2 = 8;
var ASSIGNMENT3 = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;
var PS_ENV = /^\$env:([A-Za-z_][A-Za-z0-9_]*)=?(.*)$/is;
var CHANGES_DIR = /* @__PURE__ */ new Set(["cd", "pushd", "set-location", "push-location"]);
var lex = (text6, language) => language === "bash" ? lexBash(text6) : lexPowerShell(text6, language === "cmd");
var isWindowsAbsolute = (path) => /^[A-Za-z]:\//.test(path);
var joinDir = (current, target) => {
  const next2 = toPosixPath(target);
  if (next2.startsWith("/") || isWindowsAbsolute(next2) || next2.startsWith("~")) return next2;
  return current === void 0 ? posix.normalize(next2) : posix.join(current, next2);
};
var assignments = (words, language) => {
  if (language !== "bash") {
    const [first, second, third] = words;
    const match = first === void 0 ? null : PS_ENV.exec(first);
    if (match === null) return void 0;
    const value = second === "=" ? third ?? "" : match[2] ?? "";
    return { [match[1] ?? ""]: value };
  }
  const list4 = words[0] === "export" || words[0] === "declare" ? words.slice(1) : words;
  if (list4.length === 0 || !list4.every((word2) => ASSIGNMENT3.test(word2) || word2.startsWith("-"))) return void 0;
  const found = list4.flatMap((word2) => {
    const match = ASSIGNMENT3.exec(word2);
    return match === null ? [] : [[match[1] ?? "", match[2] ?? ""]];
  });
  return found.length === 0 ? void 0 : Object.fromEntries(found);
};
var track = (words, language, context) => {
  const assigned = assignments(words, language);
  if (assigned !== void 0) context.env = { ...context.env, ...assigned };
  const program = language === "bash" ? words[0] ?? "" : powershellProgram(words[0] ?? "");
  if (!CHANGES_DIR.has(program)) return;
  const target = words.slice(1).find((word2) => !word2.startsWith("-"));
  context.dir = target === void 0 || target === "-" ? "~" : joinDir(context.dir, target);
};
var emit = (stage, raw, language, context, collector) => {
  const first = stage.argv[0] ?? "";
  const name = programName(first);
  collector.out.push({
    program: language === "bash" ? name : powershellProgram(name),
    args: stage.argv.slice(1),
    env: stage.env,
    redirects: raw.redirects,
    stdin: raw.stdin,
    dir: context.dir,
    via: stage.via,
    dynamic: raw.words.some((word2) => word2.dynamic)
  });
};
var emptyCommand = (raw, context) => ({
  program: "",
  args: [],
  env: context.env,
  redirects: raw.redirects,
  stdin: raw.stdin,
  dir: context.dir,
  via: context.via,
  dynamic: false
});
var visit = (raw, language, context, depth, collector) => {
  const words = raw.words.map((word2) => word2.text);
  track(words, language, context);
  const result = unwrap2({ argv: words, env: context.env, via: context.via }, raw.stdin);
  if (result.kind === "none") {
    if (raw.redirects.length > 0) collector.out.push(emptyCommand(raw, context));
    return;
  }
  if (result.kind === "script") {
    const nested = { env: result.stage.env, dir: context.dir, via: result.stage.via };
    collect2(result.script, result.dialect, nested, depth + 1, collector);
    return;
  }
  emit(result.stage, raw, language, context, collector);
  for (const extra of result.extra) emit(extra, raw, language, context, collector);
};
var collect2 = (text6, language, context, depth, collector) => {
  if (depth > MAX_DEPTH2) {
    collector.incomplete = true;
    return;
  }
  const lexed = lex(text6, language);
  if (lexed.incomplete) collector.incomplete = true;
  for (const substitution of lexed.substitutions) {
    collect2(substitution, language, { ...context }, depth + 1, collector);
  }
  for (const raw of rawCommands(lexed.tokens)) visit(raw, language, context, depth, collector);
};
var normalizeCommand = (text6, dialect = "bash") => {
  const collector = { out: [], incomplete: false };
  collect2(text6, dialect, { env: {}, dir: void 0, via: [] }, 0, collector);
  return { commands: collector.out, incomplete: collector.incomplete };
};
var dialectOf = (toolName3) => toolName3 === "PowerShell" ? "powershell" : "bash";

// src/git/merge/generated.ts
var LOCKFILES3 = /* @__PURE__ */ new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "bun.lock",
  "Cargo.lock",
  "poetry.lock",
  "Pipfile.lock",
  "composer.lock",
  "Gemfile.lock",
  "go.sum",
  "uv.lock"
]);
var GENERATOR_TIMEOUT_MS = 3e5;
var DOUBLE_STAR = "";
var globRegex = (pattern) => new RegExp(
  `^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").split("**").join(DOUBLE_STAR).replace(/\*/g, "[^/]*").split(DOUBLE_STAR).join(".*")}$`
);
var generatorFor = (path, generators) => Object.entries(generators).find(
  ([pattern]) => globRegex(pattern).test(path) || globRegex(pattern).test(path.split("/").pop() ?? "")
)?.[1];
var generatedPaths = (runtime, repo, paths, generators) => {
  const out = new Set(
    paths.filter((path) => LOCKFILES3.has(path.split("/").pop() ?? "") || generatorFor(path, generators) !== void 0)
  );
  if (paths.length === 0) return out;
  const attrs = runtime.git(["check-attr", "linguist-generated", "--", ...paths], repo.root);
  if (!attrs.ok) return out;
  for (const line2 of attrs.stdout.split("\n")) {
    const match = /^(.*): linguist-generated: (set|true)$/.exec(line2);
    if (match?.[1] !== void 0) out.add(match[1]);
  }
  return out;
};
var resultCommit = (runtime, repo, inputs) => {
  if (inputs.resultLabel !== "working tree") return accept(inputs.result);
  return commitTree(runtime, repo, inputs.result, [inputs.ours, inputs.theirs], "finitemonkey merge verify", {
    timeoutMs: 3e4,
    stamp: "verify"
  });
};
var runGenerator = (runtime, dir, command) => {
  if (normalizeCommand(command).commands.length === 0) return reject(`empty generator: ${command}`);
  const result = runtime.exec({
    command,
    args: [],
    cwd: toAbsolutePath(dir),
    timeoutMs: GENERATOR_TIMEOUT_MS,
    shell: true
  });
  return result.exitCode === 0 ? accept(void 0) : reject(`generator failed: ${command}: ${result.stderr.trim().slice(0, 200)}`);
};
var verifyGenerated = (runtime, repo, inputs, paths, generators) => {
  const declared = paths.flatMap((path) => {
    const command = generatorFor(path, generators);
    return command === void 0 ? [] : [{ path, command }];
  });
  if (declared.length === 0) return accept([]);
  const commit2 = resultCommit(runtime, repo, inputs);
  if (!commit2.ok) return commit2;
  const dir = join14(repo.gitDir, `finitemonkey-generate-${runtime.now().replace(/[:.]/g, "-")}`);
  if (!runtime.git(["worktree", "add", "--detach", dir, commit2.value], repo.root).ok)
    return reject("could not check out the merge result");
  try {
    for (const command of new Set(declared.map((item) => item.command))) {
      const ran = runGenerator(runtime, dir, command);
      if (!ran.ok) return ran;
    }
    return accept(
      declared.flatMap(({ path }) => {
        const fresh3 = runtime.readText(toAbsolutePath(join14(dir, path)));
        const merged = blobText(runtime, repo, commit2.value, path);
        if (fresh3.ok && fresh3.value === merged) return [];
        return [{ kind: "generated-differs", file: path, side: void 0, line: void 0, text: path, weak: false }];
      })
    );
  } finally {
    runtime.git(["worktree", "remove", "--force", dir], repo.root);
    runtime.git(["worktree", "prune"], repo.root);
  }
};

// src/git/merge/check-file.ts
var sameHunk = (left, right) => left.oldStart === right.oldStart && left.oldCount === right.oldCount && left.removed.join("\n") === right.removed.join("\n") && left.added.join("\n") === right.added.join("\n");
var removedIndices = (hunks) => {
  const out = /* @__PURE__ */ new Map();
  for (const hunk of hunks) {
    hunk.removed.forEach((line2, offset) => out.set(hunk.oldStart + offset, normalizeLine(line2)));
  }
  return out;
};
var tally = (lines3) => {
  const counts = /* @__PURE__ */ new Map();
  for (const line2 of lines3) if (line2 !== "") counts.set(line2, (counts.get(line2) ?? 0) + 1);
  return counts;
};
var removalOf = (ours, theirs, paired) => {
  const left = removedIndices(ours);
  const right = removedIndices(theirs);
  const agreed = removedIndices(paired);
  const union2 = new Map([...left, ...right]);
  const conflicted = /* @__PURE__ */ new Set();
  const honored = [];
  for (const [index, line2] of union2) {
    const both = left.has(index) && right.has(index);
    if (both && !agreed.has(index)) conflicted.add(line2);
    else honored.push(line2);
  }
  return { union: tally(union2.values()), honored: tally(honored), conflicted };
};
var missingAdditions = (hunks, file, elsewhere) => hunks.flatMap(({ side, hunk, added }) => {
  const strong = added.find((line2) => !isWeak(line2));
  if (strong === void 0 || containsSequence(file.result, added) || elsewhere(added)) return [];
  return [{ kind: "missing-addition", file: file.path, side, line: hunk.newStart, text: strong, weak: false }];
});
var expectations = (file, hunks, removal) => {
  const base = countLines(file.base);
  const addsOf = (side) => tally(hunks.filter((item) => item.side === side).flatMap((item) => item.added));
  const ours = addsOf("ours");
  const theirs = addsOf("theirs");
  const keys = /* @__PURE__ */ new Set([...base.keys(), ...ours.keys(), ...theirs.keys(), ...removal.union.keys()]);
  return [...keys].map((line2) => {
    const left = countOf(ours, line2);
    const right = countOf(theirs, line2);
    const kept = countOf(base, line2) - countOf(removal.union, line2);
    const combined = isWeak(line2) ? left + right : Math.max(left, right);
    const side = left > 0 && right > 0 ? void 0 : left > 0 ? "ours" : right > 0 ? "theirs" : void 0;
    return { line: line2, expected: kept + combined, ceiling: kept + left + right, side };
  });
};
var countFindings = (file, items, removal) => {
  const result = countLines(file.result);
  return items.flatMap(({ line: line2, expected, ceiling, side }) => {
    const actual = countOf(result, line2);
    const weak = isWeak(line2);
    if (actual < expected)
      return [{ kind: "count", file: file.path, side, line: void 0, text: line2, weak, expected, actual }];
    const honored = countOf(removal.honored, line2) > 0 && !removal.conflicted.has(line2);
    if (!weak && honored && actual > ceiling) {
      return [
        {
          kind: "removal-not-honored",
          file: file.path,
          side: void 0,
          line: void 0,
          text: line2,
          weak,
          expected: ceiling,
          actual
        }
      ];
    }
    return [];
  });
};
var checkFile = (file, elsewhere) => {
  const paired = file.theirs.filter((hunk) => file.ours.some((other) => sameHunk(hunk, other)));
  const theirs = file.theirs.filter((hunk) => !paired.includes(hunk));
  const hunks = [
    ...file.ours.map((hunk) => ({ side: "ours", hunk, added: meaningful(hunk.added) })),
    ...theirs.map((hunk) => ({ side: "theirs", hunk, added: meaningful(hunk.added) }))
  ];
  const removal = removalOf(file.ours, theirs, paired);
  return [
    ...missingAdditions(hunks, file, elsewhere),
    ...countFindings(file, expectations(file, hunks, removal), removal)
  ];
};

// src/git/merge/units.ts
var DECLARATION = /\b(?:function\*?|class|interface|type|enum|def|fn|func|struct|trait)\s+([A-Za-z_$][\w$]*)/g;
var BINDING = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/g;
var KEY = /^["']?([A-Za-z_$][\w$.-]*)["']?\s*:(?!:)/;
var TEST = /\b(?:it|test|describe|context)(?:\.\w+)?\s*\(\s*(["'`])(.+?)\1/;
var RESERVED = /* @__PURE__ */ new Set(["default", "case", "http", "https"]);
var symbolsOf = (line2) => {
  if (isWeak(line2)) return [];
  const names = [...line2.matchAll(DECLARATION), ...line2.matchAll(BINDING)].map((match) => match[1] ?? "");
  const key = KEY.exec(line2)?.[1];
  const title = TEST.exec(line2)?.[2];
  return [
    ...[...names, ...key === void 0 ? [] : [key]].filter((name) => name.length > 1 && !RESERVED.has(name)).map((name) => ({ name, test: false })),
    ...title === void 0 ? [] : [{ name: title, test: true }]
  ];
};
var escapeRegex = (text6) => text6.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var containsSymbol = (text6, symbol) => symbol.test ? text6.includes(symbol.name) : new RegExp(`(?<![\\w$])${escapeRegex(symbol.name)}(?![\\w$])`).test(text6);
var missingSymbols = (file, side, hunks, present) => {
  const seen = /* @__PURE__ */ new Set();
  return hunks.flatMap(
    (hunk) => hunk.added.flatMap((raw, offset) => {
      return symbolsOf(raw.trim()).flatMap((symbol) => {
        if (seen.has(symbol.name) || present(symbol)) return [];
        seen.add(symbol.name);
        return [{ kind: "missing-symbol", file, side, line: hunk.newStart + offset, text: symbol.name, weak: false }];
      });
    })
  );
};

// src/git/merge/verify-file.ts
var created2 = (diff) => diff?.status === "added" || diff?.status === "copied";
var resultPathOf = (context, pair) => [pair.ours?.newPath, pair.theirs?.newPath, pair.key].find(
  (path) => path !== void 0 && context.resultText(path) !== void 0
);
var finding = (kind, file, side, text6) => ({
  kind,
  file,
  side,
  line: void 0,
  text: text6,
  weak: false
});
var binaryFindings = (context, pair, path) => {
  const { runtime, repo, inputs } = context;
  const result = path === void 0 ? void 0 : blobId(runtime, repo, inputs.result, path);
  const ours = pair.ours?.newPath === void 0 ? void 0 : blobId(runtime, repo, inputs.ours, pair.ours.newPath);
  const theirs = pair.theirs?.newPath === void 0 ? void 0 : blobId(runtime, repo, inputs.theirs, pair.theirs.newPath);
  const file = path ?? pair.key;
  if (pair.ours !== void 0 && pair.theirs !== void 0 && ours !== theirs) {
    if (result === ours) return [finding("binary", file, "theirs", file)];
    if (result === theirs) return [finding("binary", file, "ours", file)];
    return [finding("binary", file, void 0, file)];
  }
  const side = pair.ours === void 0 ? "theirs" : "ours";
  const expected = side === "ours" ? ours : theirs;
  return result === expected ? [] : [finding("binary", file, side, file)];
};
var elsewhereOf = (context) => (lines3) => context.resultFiles().some((path) => containsSequence(contentLines(context.resultText(path)), lines3));
var symbolFindings = (context, pair, path, text6) => {
  const present = (symbol) => text6 !== void 0 && containsSymbol(text6, symbol) || context.resultFiles().some((other) => containsSymbol(context.resultText(other) ?? "", symbol));
  return [
    ...missingSymbols(path, "ours", pair.ours?.hunks ?? [], present),
    ...missingSymbols(path, "theirs", pair.theirs?.hunks ?? [], present)
  ];
};
var verifyFile = (context, pair) => {
  const path = resultPathOf(context, pair);
  if (pair.ours?.binary === true || pair.theirs?.binary === true) return binaryFindings(context, pair, path);
  const missing = ["ours", "theirs"].flatMap(
    (side) => created2(pair[side]) && path === void 0 ? [finding("missing-file", pair.key, side, pair.key)] : []
  );
  if (missing.length > 0) return missing;
  const copied = [pair.ours, pair.theirs].find((diff) => diff?.status === "copied");
  const baseSource = copied?.oldPath ?? (created2(pair.ours) || created2(pair.theirs) ? void 0 : pair.key);
  const baseText = baseSource === void 0 ? void 0 : blobText(context.runtime, context.repo, context.inputs.base, baseSource);
  const text6 = path === void 0 ? void 0 : context.resultText(path);
  const file = path ?? pair.key;
  const lines3 = checkFile(
    {
      path: file,
      base: contentLines(baseText),
      result: contentLines(text6),
      ours: pair.ours?.hunks ?? [],
      theirs: pair.theirs?.hunks ?? []
    },
    elsewhereOf(context)
  );
  return [...lines3, ...symbolFindings(context, pair, file, text6)];
};

// src/git/merge/verify.ts
var MERGE_VERIFY_SCHEMA = "finitemonkey/merge-verify@1";
var failed2 = (error, inputs) => ({
  schema: MERGE_VERIFY_SCHEMA,
  exit: 2,
  base: inputs?.base,
  ours: inputs?.ours,
  theirs: inputs?.theirs,
  result: inputs?.result,
  bases: inputs?.bases ?? 0,
  files: 0,
  findings: [],
  justified: 0,
  generated: [],
  error
});
var keyOf = (diff) => (diff.status === "added" || diff.status === "copied" ? diff.newPath : diff.oldPath ?? diff.newPath) ?? "";
var pairsOf = (ours, theirs) => {
  const keys = [...new Set([...ours, ...theirs].map(keyOf))].filter((key) => key !== "").sort();
  return keys.map((key) => ({
    key,
    ours: ours.find((diff) => keyOf(diff) === key),
    theirs: theirs.find((diff) => keyOf(diff) === key)
  }));
};
var contextOf = (runtime, repo, inputs, pairs) => {
  const resultText = memoBy((path) => blobText(runtime, repo, inputs.result, path));
  const context = {
    runtime,
    repo,
    inputs,
    resultText,
    resultFiles: memo2(
      () => pairs.flatMap((pair) => {
        const path = resultPathOf(context, pair);
        return path === void 0 ? [] : [path];
      })
    )
  };
  return context;
};
var verifyMerge = (runtime, repo, options = {}) => {
  const inputs = resolveMergeInputs(runtime, repo, options.rev);
  if (!inputs.ok) return failed2(inputs.error);
  const dropped = loadDropped(runtime, repo.root, options.droppedFile);
  if (!dropped.ok) return failed2(`dropped: ${dropped.error}`, inputs.value);
  const ours = sideDiff(runtime, repo, inputs.value.base, inputs.value.ours);
  const theirs = sideDiff(runtime, repo, inputs.value.base, inputs.value.theirs);
  if (!ours.ok) return failed2(ours.error, inputs.value);
  if (!theirs.ok) return failed2(theirs.error, inputs.value);
  const pairs = pairsOf(ours.value, theirs.value);
  const generators = configMap(loadProjectConfig(runtime, repo.root), "merge", "generators");
  const generated = generatedPaths(
    runtime,
    repo,
    pairs.map((pair) => pair.key),
    generators
  );
  const context = contextOf(
    runtime,
    repo,
    inputs.value,
    pairs.filter((pair) => !generated.has(pair.key))
  );
  const regenerated = verifyGenerated(runtime, repo, inputs.value, [...generated], generators);
  if (!regenerated.ok) return failed2(regenerated.error, inputs.value);
  const all = [
    ...pairs.filter((pair) => !generated.has(pair.key)).flatMap((pair) => verifyFile(context, pair)),
    ...regenerated.value
  ];
  const open = [...dropped.value.invalid, ...all.filter((item) => !isDropped(item, dropped.value.items))];
  return {
    schema: MERGE_VERIFY_SCHEMA,
    exit: open.length === 0 ? 0 : 1,
    base: inputs.value.base,
    ours: inputs.value.ours,
    theirs: inputs.value.theirs,
    result: inputs.value.result,
    bases: inputs.value.bases,
    files: pairs.length,
    findings: open,
    justified: all.length - (open.length - dropped.value.invalid.length),
    generated: [...generated].sort(),
    error: void 0
  };
};

// src/git/ownership.ts
import { join as join15 } from "node:path";
var OWNERSHIP_DIR = ".finitemonkey/git";
var ownerKey = (raw) => {
  const cleaned = (raw ?? "").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
  return cleaned === "" ? "unknown" : cleaned;
};
var fileOf = (repo, kind, owner) => toAbsolutePath(join15(repo.root, OWNERSHIP_DIR, kind, `${ownerKey(owner)}.json`));
var readDirty = (runtime, root) => {
  const status = runtime.git(["status", "--porcelain=v2", "-z", "--untracked-files=all"], root);
  return status.ok ? parsePorcelainV2(status.stdout) : void 0;
};
var hashDirty = (runtime, repo, entries) => {
  const present = entries.filter((entry2) => runtime.stat(toAbsolutePath(join15(repo.root, entry2.path)))?.kind === "file");
  const hashed = present.length === 0 ? void 0 : runtime.gitWith(["hash-object", "--stdin-paths"], repo.root, {
    input: `${present.map((entry2) => entry2.path).join("\n")}
`
  });
  const shas = hashed?.ok === true ? hashed.stdout.split("\n") : [];
  return Object.fromEntries(
    entries.map((entry2) => {
      const index = present.indexOf(entry2);
      return [entry2.path, index < 0 ? "deleted" : shas[index] ?? "unknown"];
    })
  );
};
var hashesOf = (value) => isRecord(value) ? Object.fromEntries(
  Object.entries(value).filter((entry2) => typeof entry2[1] === "string")
) : {};
var readObject = (runtime, path) => {
  const text6 = runtime.readText(path);
  return text6.ok ? parseJsonObject(text6.value) : text6;
};
var readBaseline2 = (runtime, repo, owner) => {
  const parsed = readObject(runtime, fileOf(repo, "baseline", owner));
  if (!parsed.ok) return void 0;
  return {
    owner,
    at: optionalString(parsed.value, "at") ?? "",
    head: optionalString(parsed.value, "head"),
    files: hashesOf(parsed.value["files"])
  };
};
var readHashes = (runtime, repo, owner) => {
  const parsed = readObject(runtime, fileOf(repo, "state", owner));
  return parsed.ok ? hashesOf(parsed.value["files"]) : {};
};
var readEdits = (runtime, repo, owner) => {
  const parsed = readObject(runtime, fileOf(repo, "edits", owner));
  const paths = parsed.ok ? parsed.value["paths"] : void 0;
  return new Set(Array.isArray(paths) ? paths.filter((path) => typeof path === "string") : []);
};
var write = (runtime, path, value) => {
  runtime.writeText(path, `${JSON.stringify(value)}
`);
};
var recordBaseline = (runtime, repo, owner) => {
  const existing = readBaseline2(runtime, repo, owner);
  if (existing !== void 0) return existing;
  const entries = readDirty(runtime, repo.root);
  if (entries === void 0) return void 0;
  const head = runtime.git(["rev-parse", "--verify", "--quiet", "HEAD"], repo.root).stdout.trim();
  const baseline = {
    owner,
    at: runtime.now(),
    head: head === "" ? void 0 : head,
    files: hashDirty(runtime, repo, entries)
  };
  write(runtime, fileOf(repo, "baseline", owner), baseline);
  write(runtime, fileOf(repo, "state", owner), { files: baseline.files });
  return baseline;
};
var recordEdits = (runtime, repo, owner, paths) => {
  if (paths.length === 0) return;
  const known2 = readEdits(runtime, repo, owner);
  const merged = [.../* @__PURE__ */ new Set([...known2, ...paths])].sort();
  if (merged.length !== known2.size) write(runtime, fileOf(repo, "edits", owner), { paths: merged });
};
var recordShellChanges = (runtime, repo, owner) => {
  const entries = readDirty(runtime, repo.root);
  if (entries === void 0) return;
  const before = readHashes(runtime, repo, owner);
  const now = hashDirty(runtime, repo, entries);
  const changed = Object.entries(now).filter(([path, hash]) => before[path] !== hash).map(([path]) => path);
  recordEdits(runtime, repo, owner, changed);
  write(runtime, fileOf(repo, "state", owner), { files: now });
};
var foreignFiles = (runtime, repo, owner, targets2) => {
  const baseline = readBaseline2(runtime, repo, owner);
  const edits = readEdits(runtime, repo, owner);
  return targets2.flatMap((path) => {
    if (baseline !== void 0 && Object.hasOwn(baseline.files, path)) return [{ path, reason: "before-session" }];
    return edits.has(path) ? [] : [{ path, reason: "not-session" }];
  });
};

// src/git/gate-status.ts
var lines = (text6) => text6.split("\n").filter((line2) => line2.trim() !== "");
var unpushedSince = (runtime, repo, since) => {
  if (lines(runtime.git(["remote"], repo.root).stdout).length === 0) return [];
  const result = runtime.git(["rev-list", `${since}..HEAD`, "--not", "--remotes"], repo.root);
  return result.ok ? lines(result.stdout) : [];
};
var worktreeGateStatus = (runtime, repo, owner) => {
  const edits = readEdits(runtime, repo, owner);
  const dirty = (readDirty(runtime, repo.root) ?? []).map((entry2) => entry2.path).filter((path) => edits.has(path));
  const since = readBaseline2(runtime, repo, owner)?.head;
  const branch = runtime.git(["symbolic-ref", "--quiet", "--short", "HEAD"], repo.root).stdout.trim();
  return {
    branch: branch === "" ? void 0 : branch,
    dirty,
    unpushed: since === void 0 ? [] : unpushedSince(runtime, repo, since)
  };
};
var mergeGateStatus = (runtime, repo, owner) => {
  const since = readBaseline2(runtime, repo, owner)?.head;
  const pending = mergeInProgress(runtime, repo) ? [{ commit: "MERGE_HEAD", report: verifyMerge(runtime, repo) }] : [];
  const commits = since === void 0 ? [] : mergeCommitsSince(runtime, repo, since);
  return [...pending, ...commits.map((commit2) => ({ commit: commit2, report: verifyMerge(runtime, repo, { rev: commit2 }) }))];
};
var findingLabel = (finding2) => {
  const where = finding2.line === void 0 ? finding2.file : `${finding2.file}:${String(finding2.line)}`;
  return `${where} ${finding2.text === "" ? finding2.kind : `"${finding2.text}"`}`;
};

// src/git/repo.ts
var DEFAULT_PROTECTED = ["main", "master", "release/*", "prod", "production", "rc-*"];
var openRepo = (runtime, dir) => {
  const result = runtime.git(["rev-parse", "--show-toplevel", "--absolute-git-dir", "--show-prefix"], dir);
  if (!result.ok) return void 0;
  const [root, gitDir, prefix] = result.stdout.split("\n");
  if (root === void 0 || root === "" || gitDir === void 0 || gitDir === "") return void 0;
  return {
    root: toAbsolutePath(root),
    gitDir: toAbsolutePath(gitDir),
    prefix: (prefix ?? "").replace(/\/$/, "")
  };
};
var globRegex2 = (pattern) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
var matchesBranch = (branch, patterns) => patterns.some((pattern) => globRegex2(pattern).test(branch));
var line = (runtime, root, args) => {
  const result = runtime.git(args, root);
  const value = result.stdout.trim();
  return result.ok && value !== "" ? value : void 0;
};
var refExists = (runtime, root, ref) => runtime.git(["show-ref", "--verify", "--quiet", ref], root).ok;
var defaultBranchOf = (runtime, root) => {
  const remote = line(runtime, root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  if (remote !== void 0) return remote.replace(/^[^/]+\//, "");
  const configured = line(runtime, root, ["config", "--get", "init.defaultBranch"]);
  if (configured !== void 0 && refExists(runtime, root, `refs/heads/${configured}`)) return configured;
  return refExists(runtime, root, "refs/heads/master") && !refExists(runtime, root, "refs/heads/main") ? "master" : "main";
};
var upstreamOf = (runtime, root, branch) => {
  const remote = line(runtime, root, ["config", "--get", `branch.${branch}.remote`]);
  const merge = line(runtime, root, ["config", "--get", `branch.${branch}.merge`]);
  if (remote === void 0 || merge === void 0 || remote === ".") return void 0;
  const name = merge.replace(/^refs\/heads\//, "");
  return { branch: name, remoteRef: `refs/remotes/${remote}/${name}` };
};
var integrationRefs = (runtime, root, defaultBranch) => [`refs/heads/${defaultBranch}`, `refs/remotes/origin/${defaultBranch}`].filter(
  (ref) => refExists(runtime, root, ref)
);
var contained = (runtime, root, branch, targets2) => {
  const tip = line(runtime, root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
  if (tip === void 0) return true;
  return targets2.filter((target) => target !== `refs/heads/${branch}`).some((target) => runtime.git(["merge-base", "--is-ancestor", tip, target], root).ok);
};
var shared = (runtime, root, upstream, base) => {
  if (upstream === void 0 || !refExists(runtime, root, upstream.remoteRef)) return false;
  const own = line(runtime, root, ["config", "--get", "user.email"]) ?? "";
  const log = runtime.git(["log", "--format=%ae", upstream.remoteRef, ...base.map((ref) => `^${ref}`)], root);
  return log.ok && log.stdout.split("\n").some((email) => email.trim() !== "" && email.trim() !== own);
};
var protectedPatterns = (config, defaultBranch) => [
  defaultBranch,
  ...DEFAULT_PROTECTED,
  ...configList(config, "git", "protected")
];
var repoFacts = (runtime, repo, config = loadProjectConfig(runtime, repo.root)) => {
  const { root } = repo;
  const defaultBranch = memo2(() => defaultBranchOf(runtime, root));
  const patterns = memo2(() => protectedPatterns(config, defaultBranch()));
  const upstream = memoBy((branch) => upstreamOf(runtime, root, branch));
  const integration = memo2(() => integrationRefs(runtime, root, defaultBranch()));
  return {
    prefix: repo.prefix,
    currentBranch: memo2(() => line(runtime, root, ["symbolic-ref", "--quiet", "--short", "HEAD"])),
    defaultBranch,
    isProtected: (branch) => matchesBranch(branch, patterns()),
    dirty: memo2(() => {
      const status = runtime.git(["status", "--porcelain=v2", "-z", "--untracked-files=all"], root);
      return status.ok ? parsePorcelainV2(status.stdout) : void 0;
    }),
    isRef: memoBy((name) => runtime.git(["rev-parse", "--verify", "--quiet", `${name}^{commit}`], root).ok),
    branchExists: memoBy((name) => refExists(runtime, root, `refs/heads/${name}`)),
    branchContained: memoBy((branch) => {
      const up = upstream(branch);
      return contained(runtime, root, branch, [...up === void 0 ? [] : [up.remoteRef], ...integration()]);
    }),
    upstream,
    sharedBranch: memoBy((branch) => shared(runtime, root, upstream(branch), integration()))
  };
};

// src/gate/checks/worktree.ts
var MAX_LISTED5 = 8;
var listed2 = (items) => {
  const head = items.slice(0, MAX_LISTED5).join(", ");
  return items.length > MAX_LISTED5 ? `${head} (+${String(items.length - MAX_LISTED5)})` : head;
};
var repoOf = (ctx) => openRepo(ctx.runtime, ctx.paths.root);
var ownerOf = (ctx) => ownerKey(ctx.sessionId);
var declaresDestination = (ctx) => ctx.contract.acceptance.some((check2) => check2.kind === "git" && (check2.require ?? []).includes("pushed"));
var worktreeCheck = (_check, ctx) => {
  const repo = repoOf(ctx);
  if (repo === void 0) return unverified("tool_missing", [note("gate.worktree.unavailable")]);
  const status = worktreeGateStatus(ctx.runtime, repo, ownerOf(ctx));
  const unpushed = declaresDestination(ctx) ? [] : status.unpushed;
  const notes2 = [
    ...status.dirty.length > 0 ? [note("gate.worktree.dirty", { files: listed2(status.dirty) })] : [],
    ...unpushed.length > 0 ? [note("gate.worktree.unpushed", { count: unpushed.length, branch: status.branch ?? "HEAD" })] : []
  ];
  return notes2.length > 0 ? failed(notes2) : passed([note("gate.worktree.clean")]);
};
var mergeCheck = (_check, ctx) => {
  const repo = repoOf(ctx);
  if (repo === void 0) return unverified("tool_missing", [note("gate.merge.unavailable")]);
  const items = mergeGateStatus(ctx.runtime, repo, ownerOf(ctx));
  const short2 = (commit2) => commit2 === "MERGE_HEAD" ? commit2 : commit2.slice(0, 12);
  const broken = items.filter((item) => item.report.exit === 2);
  if (broken.length > 0) {
    return unverified(
      "tool_missing",
      broken.map(
        (item) => note("gate.merge.unanalyzed", { commit: short2(item.commit), detail: item.report.error ?? "" })
      )
    );
  }
  const lost = items.filter((item) => item.report.exit === 1);
  if (lost.length > 0) {
    return failed(
      lost.map(
        (item) => note("gate.merge.lost", {
          commit: short2(item.commit),
          findings: listed2(item.report.findings.map(findingLabel))
        })
      )
    );
  }
  return passed([note("gate.merge.clean", { count: items.length })]);
};

// src/gate/checks/index.ts
var DEFAULT_CHECKS = {
  command: commandCheck,
  tests: testsCheck,
  diff: diffCheck,
  placeholders: placeholdersCheck,
  git: gitCheck,
  pr: prOutcome,
  manual: manualCheck,
  secrets: secretsCheck,
  worktree: worktreeCheck,
  merge: mergeCheck
};

// src/gate/report.ts
var GATE_SCHEMA = "finitemonkey/gate@1";
var fromEvidence = (id, kind, entry2, stale) => {
  if (entry2 === void 0) {
    return { id, kind, status: "unverified", reason: stale ? "no_evidence" : "no_evidence", notes: [], stale };
  }
  return {
    id,
    kind,
    status: entry2.status,
    notes: entry2.notes,
    stale: false,
    at: entry2.at,
    ...entry2.reason === void 0 ? {} : { reason: entry2.reason },
    ...entry2.command === void 0 ? {} : { command: entry2.command },
    ...entry2.exitCode === void 0 ? {} : { exitCode: entry2.exitCode },
    ...entry2.durationMs === void 0 ? {} : { durationMs: entry2.durationMs },
    ...entry2.releasedBy === void 0 ? {} : { releasedBy: entry2.releasedBy }
  };
};
var verdictOf = (items) => {
  if (items.some((item) => item.status === "failed")) return "failed";
  return items.some((item) => item.status === "unverified") ? "incomplete" : "passed";
};
var buildReport2 = (input) => {
  const { contract, ledger, treeHash: treeHash2 } = input;
  const items = contract.acceptance.map((check2) => {
    const command = REUSABLE_KINDS.includes(check2.kind) ? check2.run : void 0;
    const entry2 = latestFor(
      ledger.filter((item) => item.task === contract.id),
      check2.id,
      treeHash2,
      command
    );
    return fromEvidence(check2.id, check2.kind, entry2, hasStale(ledger, check2.id, treeHash2));
  });
  const count3 = (status) => items.filter((item) => item.status === status).length;
  return {
    schema: GATE_SCHEMA,
    task: contract.id,
    implicit: contract.implicit,
    goal: contract.goal,
    treeHash: treeHash2,
    base: input.base,
    source: input.source,
    contractEdited: input.contractEdited,
    verdict: verdictOf(items),
    counts: { passed: count3("passed"), failed: count3("failed"), unverified: count3("unverified") },
    items,
    decisionsNeeded: contract.decisionsNeeded,
    fastPath: input.fastPath
  };
};

// src/gate/run.ts
var FAST_PATH_MS = 10 * 6e4;
var toEvidence = (ctx, check2, outcome) => ({
  schema: EVIDENCE_SCHEMA,
  task: ctx.contract.id,
  check: check2.id,
  kind: check2.kind,
  treeHash: ctx.treeHash,
  at: ctx.runtime.now(),
  ...outcome,
  ...check2.run === void 0 || outcome.command !== void 0 ? {} : { command: check2.run }
});
var reusable = (ledger, ctx, check2) => {
  if (!REUSABLE_KINDS.includes(check2.kind)) return false;
  const prior = latestFor(
    ledger.filter((entry2) => entry2.task === ctx.contract.id),
    check2.id,
    ctx.treeHash,
    check2.run
  );
  return prior !== void 0 && prior.status !== "unverified";
};
var notImplemented = (check2) => unverified("not_implemented", [note("gate.note.not_implemented", { kind: check2.kind })]);
var runChecks2 = (ctx, ledger, registry) => ctx.contract.acceptance.flatMap((check2) => {
  if (reusable(ledger, ctx, check2)) return [];
  const runner = registry[check2.kind];
  return [toEvidence(ctx, check2, runner === void 0 ? notImplemented(check2) : runner(check2, ctx))];
});
var fastPathHit = (prepared, ledger) => {
  const { ctx, loaded } = prepared;
  const last = latestFor(
    ledger.filter((entry2) => entry2.task === ctx.contract.id),
    GATE_CHECK,
    ctx.treeHash
  );
  return last?.status === "passed" && last.command === loaded.hash && nowMs(ctx.runtime) - Date.parse(last.at) < FAST_PATH_MS;
};
var report = (prepared, ledger, fastPath) => buildReport2({
  contract: prepared.ctx.contract,
  ledger,
  treeHash: prepared.ctx.treeHash,
  base: prepared.ctx.base,
  source: prepared.loaded.source,
  contractEdited: prepared.loaded.editedOnDisk,
  fastPath
});
var summaryEntry = (prepared, ledger) => {
  const draft = report(prepared, ledger, false);
  return {
    schema: EVIDENCE_SCHEMA,
    task: prepared.ctx.contract.id,
    check: GATE_CHECK,
    kind: "gate",
    status: verdictOf(draft.items) === "passed" ? "passed" : verdictOf(draft.items) === "failed" ? "failed" : "unverified",
    treeHash: prepared.ctx.treeHash,
    at: prepared.ctx.runtime.now(),
    command: prepared.loaded.hash,
    notes: []
  };
};
var runGate = (options, registry = DEFAULT_CHECKS) => {
  const ready = prepareGate(options);
  if (ready.kind !== "ready") return ready;
  const { prepared } = ready;
  const path = prepared.ctx.paths.evidence(prepared.ctx.contract.id);
  const before = readLedger(options.runtime, path);
  if (options.fast && fastPathHit(prepared, before)) return { kind: "done", report: report(prepared, before, true) };
  const fresh3 = runChecks2(prepared.ctx, before, registry);
  if (!appendEvidence(options.runtime, path, fresh3)) return { kind: "failed", failure: { kind: "ledger_unwritable" } };
  const withChecks = readLedger(options.runtime, path);
  if (!appendEvidence(options.runtime, path, [summaryEntry(prepared, withChecks)])) {
    return { kind: "failed", failure: { kind: "ledger_unwritable" } };
  }
  return { kind: "done", report: report(prepared, readLedger(options.runtime, path), false) };
};

// src/commands/gate.ts
var budgetMs = (raw) => {
  const seconds = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1e3 : DEFAULT_GATE_BUDGET_MS;
};
var notRun = (detail) => ({
  code: "gate_not_run",
  messageKey: "error.gate_not_run",
  params: { detail },
  fix: "finitemonkey doctor",
  exitCode: ExitCode.NotConfigured
});
var gateResult = (ctx, report2, strict) => {
  const human2 = reportLines(ctx.t, report2);
  const failedVerdict = report2.verdict === "failed" || strict && report2.verdict === "incomplete";
  if (!failedVerdict) return success(report2, human2);
  const code = report2.verdict === "failed" ? "gate_failed" : "gate_incomplete";
  return {
    ok: false,
    exitCode: ExitCode.CheckFailed,
    data: report2,
    human: human2,
    error: { code, message: ctx.t(`error.${code}`, report2.counts), fix: `finitemonkey gate --task ${report2.task}` }
  };
};
var runResult = (ctx, run3, strict) => {
  if (run3.kind === "done") return gateResult(ctx, run3.report, strict);
  if (run3.kind === "skipped") return success({ skipped: run3.reason }, [ctx.t(`gate.skipped.${run3.reason}`)]);
  const detail = run3.failure.kind === "contract" ? `${run3.failure.problem.kind}: ${run3.failure.problem.id}` : run3.failure.kind;
  return failureFrom(ctx.t, notRun(detail));
};
var prsResult = (ctx) => {
  const root = gitRoot(gitAt(ctx.runtime, ctx.cwd));
  const list4 = root === void 0 ? void 0 : refreshPrs(ctx.runtime, fmPaths(root));
  return success(
    { prs: list4 ?? null },
    list4 === void 0 ? [] : openPrsLine(ctx.t, ctx.runtime, fmPaths(root ?? ctx.cwd))
  );
};
var gateCommand = {
  path: ["gate"],
  summaryKey: "command.gate.summary",
  usage: "finitemonkey gate [--task <id>] [--fast] [--strict] [--budget <seconds>] [--baseline] [--prs]",
  status: "ready",
  options: {
    task: { type: "string" },
    fast: { type: "boolean" },
    strict: { type: "boolean" },
    budget: { type: "string" },
    baseline: { type: "boolean" },
    prs: { type: "boolean" }
  },
  run: (ctx, args) => {
    const taskId = stringOption(args.values, "task");
    const options = {
      runtime: ctx.runtime,
      cwd: ctx.cwd,
      env: ctx.env,
      sessionId: void 0,
      budgetMs: budgetMs(stringOption(args.values, "budget")),
      fast: args.values["fast"] === true,
      ...taskId === void 0 ? {} : { taskId }
    };
    if (args.values["prs"] === true) return Promise.resolve(prsResult(ctx));
    if (args.values["baseline"] === true) {
      const baseline = runBaseline(options);
      return Promise.resolve(
        success(baseline, [
          ctx.t(baseline.kind === "recorded" ? "gate.baseline.recorded" : "gate.baseline.skipped", {
            reason: baseline.kind === "skipped" ? baseline.reason : ""
          })
        ])
      );
    }
    return Promise.resolve(runResult(ctx, runGate(options), args.values["strict"] === true));
  }
};

// src/commands/git-problems.ts
var notRepository = (dir) => ({
  code: "not_a_git_repo",
  messageKey: "error.not_a_git_repo",
  params: { dir },
  fix: "git init",
  exitCode: ExitCode.NotConfigured
});
var gitProblem = (code, messageKey, detail, fix, exitCode = ExitCode.CheckFailed) => ({ code, messageKey, params: { detail }, fix, exitCode });
var repoOf2 = (ctx) => openRepo(ctx.runtime, ctx.cwd);

// src/commands/git-merge-verify.ts
var MERGE_VERIFY_RUN_SCHEMA = "finitemonkey/merge-verify-run@1";
var short = (sha) => (sha ?? "?").slice(0, 12);
var humanOf = (ctx, item) => {
  const { report: report2 } = item;
  const range = {
    base: short(report2.base),
    result: item.commit === "MERGE_HEAD" ? "working tree" : short(item.commit)
  };
  if (report2.exit === 2) return [ctx.t("git.error.merge_unanalyzable", { detail: report2.error ?? "" })];
  if (report2.exit === 0) {
    return [ctx.t("git.merge.ok", { ...range, files: report2.files, justified: report2.justified })];
  }
  return [
    ctx.t("git.merge.lost", { ...range, count: report2.findings.length }),
    ...report2.findings.map(
      (finding2) => ctx.t("git.merge.finding", {
        where: findingLabel(finding2),
        kind: finding2.kind,
        side: finding2.side ?? "-",
        text: finding2.text
      })
    )
  ];
};
var headIsMerge = (ctx, repo) => {
  const parents = ctx.runtime.git(["rev-list", "--parents", "-n", "1", "HEAD"], repo.root).stdout.trim().split(" ");
  return parents.length > 2;
};
var targetsOf = (ctx, repo, rev, since) => {
  if (since !== void 0) return mergeCommitsSince(ctx.runtime, repo, since);
  if (rev !== void 0) return [rev];
  if (mergeInProgress(ctx.runtime, repo)) return ["MERGE_HEAD"];
  return headIsMerge(ctx, repo) ? ["HEAD"] : [];
};
var resultOf = (ctx, checked) => {
  const human2 = [...checked.flatMap((item) => humanOf(ctx, item)), ctx.t("git.merge.limits")];
  const data = { schema: MERGE_VERIFY_RUN_SCHEMA, merges: checked };
  const broken = checked.find((item) => item.report.exit === 2);
  if (broken !== void 0) {
    const detail = broken.report.error ?? "";
    const problem3 = gitProblem("merge_unanalyzable", "git.error.merge_unanalyzable", detail, "git status");
    return failureFrom(ctx.t, { ...problem3, exitCode: ExitCode.Usage, data }, human2);
  }
  const lost = checked.reduce((count3, item) => count3 + item.report.findings.length, 0);
  if (lost === 0) return success(data, human2);
  return failureFrom(
    ctx.t,
    {
      code: "merge_lost_work",
      messageKey: "git.error.merge_lost",
      params: { count: lost },
      fix: "finitemonkey merge verify --dropped .finitemonkey/merge-dropped.json",
      exitCode: ExitCode.CheckFailed,
      data
    },
    human2
  );
};
var mergeVerifyCommand = {
  path: ["merge", "verify"],
  summaryKey: "git.command.merge_verify",
  usage: "finitemonkey merge verify [<merge-commit>] [--since <ref>] [--dropped <file>] [--json]",
  status: "ready",
  options: { since: { type: "string" }, dropped: { type: "string" } },
  maxPositionals: 1,
  run: (ctx, args) => {
    const repo = repoOf2(ctx);
    if (repo === void 0) return Promise.resolve(failureFrom(ctx.t, notRepository(ctx.cwd)));
    const dropped = stringOption(args.values, "dropped");
    const targets2 = targetsOf(ctx, repo, args.positionals[0], stringOption(args.values, "since"));
    if (targets2.length === 0) {
      const data = { schema: MERGE_VERIFY_RUN_SCHEMA, merges: [] };
      return Promise.resolve(success(data, [ctx.t("git.merge.none", { detail: "HEAD" })]));
    }
    const checked = targets2.map((commit2) => ({
      commit: commit2,
      report: verifyMerge(ctx.runtime, repo, {
        ...commit2 === "MERGE_HEAD" ? {} : { rev: commit2 },
        ...dropped === void 0 ? {} : { droppedFile: dropped }
      })
    }));
    return Promise.resolve(resultOf(ctx, checked));
  }
};

// src/git/rescue.ts
var REFLOG_LIMIT = 300;
var LIST_LIMIT = 50;
var SHA = /^[0-9a-f]{40,64}$/;
var linesOf = (text6) => text6.split("\n").filter((line2) => line2.trim() !== "");
var reflogLines = (runtime, repo) => {
  const result = runtime.git(["reflog", "show", "--all", `-n${String(REFLOG_LIMIT)}`, "--format=%H %gD"], repo.root);
  if (!result.ok) return [];
  return linesOf(result.stdout).flatMap((line2) => {
    const [sha, ref] = line2.split(" ");
    return sha === void 0 || ref === void 0 || !SHA.test(sha) || ref.startsWith("refs/finitemonkey/") ? [] : [{ sha, ref }];
  });
};
var unreachable = (runtime, repo, shas) => {
  if (shas.length === 0) return /* @__PURE__ */ new Set();
  const result = runtime.git(["rev-list", ...shas, "--not", "--branches", "--tags", "--remotes"], repo.root);
  return new Set(result.ok ? linesOf(result.stdout) : []);
};
var fsckDangling = (runtime, repo) => {
  const result = runtime.git(["fsck", "--no-reflogs", "--no-progress", "--dangling"], repo.root);
  const lines3 = linesOf(result.stdout);
  const pick3 = (kind) => lines3.flatMap((line2) => {
    const [label2, type, sha] = line2.split(" ");
    return label2 === "dangling" && type === kind && sha !== void 0 ? [sha] : [];
  });
  return { commits: pick3("commit"), blobs: pick3("blob").length };
};
var describe = (runtime, repo, shas) => {
  if (shas.length === 0) return /* @__PURE__ */ new Map();
  const result = runtime.git(["log", "--no-walk=unsorted", "--format=%H%x09%cr%x09%s", ...shas], repo.root);
  return new Map(
    linesOf(result.stdout).flatMap((line2) => {
      const [sha, when, ...subject2] = line2.split("	");
      return sha === void 0 ? [] : [[sha, [when ?? "", subject2.join("	")]]];
    })
  );
};
var rescueReport = (runtime, repo) => {
  const reflog = reflogLines(runtime, repo);
  const lost = unreachable(runtime, repo, [...new Set(reflog.map((line2) => line2.sha))]);
  const fromReflog = reflog.filter(
    (line2, index) => lost.has(line2.sha) && reflog.findIndex((other) => other.sha === line2.sha) === index
  );
  const seen = new Set(fromReflog.map((line2) => line2.sha));
  const dangling = fsckDangling(runtime, repo);
  const extra = dangling.commits.filter((sha) => !seen.has(sha));
  const details = describe(runtime, repo, [...fromReflog.map((line2) => line2.sha), ...extra].slice(0, LIST_LIMIT));
  const commit2 = (sha, source, ref) => {
    const detail = details.get(sha);
    return detail === void 0 ? [] : [{ sha, when: detail[0], subject: detail[1], source, ref }];
  };
  return {
    commits: [
      ...fromReflog.flatMap((line2) => commit2(line2.sha, "reflog", line2.ref)),
      ...extra.flatMap((sha) => commit2(sha, "dangling", void 0))
    ],
    blobs: dangling.blobs
  };
};
var restoreBranch = (runtime, repo, sha, branch) => {
  const commit2 = runtime.git(["rev-parse", "--verify", "--quiet", `${sha}^{commit}`], repo.root).stdout.trim();
  if (commit2 === "") return reject(`not a commit: ${sha}`);
  if (!runtime.git(["check-ref-format", "--branch", branch], repo.root).ok) return reject(`invalid branch: ${branch}`);
  if (runtime.git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], repo.root).ok) {
    return reject(`branch already exists: ${branch}`);
  }
  const made = runtime.gitWith(["branch", branch, commit2], repo.root, {});
  return made.ok ? accept(commit2) : reject(made.stderr.trim() || "git branch failed");
};

// src/commands/git-rescue.ts
var RESCUE_SCHEMA = "finitemonkey/git-rescue@1";
var listing = (t, report2) => [
  t("git.rescue.title"),
  ...report2.commits.map(
    (commit2) => commit2.source === "reflog" ? t("git.rescue.reflog", {
      ref: commit2.ref ?? "",
      sha: commit2.sha.slice(0, 12),
      when: commit2.when,
      subject: commit2.subject
    }) : t("git.rescue.dangling", { sha: commit2.sha.slice(0, 12), when: commit2.when, subject: commit2.subject })
  ),
  ...report2.blobs > 0 ? [t("git.rescue.blobs", { count: report2.blobs })] : [],
  t("git.rescue.never_staged"),
  ...report2.commits.length > 0 ? [t("git.rescue.next")] : []
];
var rescueCommand = {
  path: ["rescue"],
  summaryKey: "git.command.rescue",
  usage: "finitemonkey rescue [--restore <sha> --branch <name>] [--json]",
  status: "ready",
  options: { restore: { type: "string" }, branch: { type: "string" } },
  run: (ctx, args) => {
    const repo = repoOf2(ctx);
    if (repo === void 0) return Promise.resolve(failureFrom(ctx.t, notRepository(ctx.cwd)));
    const sha = stringOption(args.values, "restore");
    const branch = stringOption(args.values, "branch");
    if (sha === void 0 && branch === void 0) {
      const report2 = rescueReport(ctx.runtime, repo);
      return Promise.resolve(success({ schema: RESCUE_SCHEMA, action: "list", ...report2 }, listing(ctx.t, report2)));
    }
    if (sha === void 0 || branch === void 0) {
      const fix = "finitemonkey rescue --restore <sha> --branch <name>";
      return Promise.resolve(
        failureFrom(ctx.t, usageProblem("invalid_arguments", "error.invalid_arguments", fix, { detail: fix }))
      );
    }
    const made = restoreBranch(ctx.runtime, repo, sha, branch);
    if (!made.ok) {
      return Promise.resolve(
        failureFrom(
          ctx.t,
          gitProblem("git_rescue_failed", "git.error.rescue_failed", made.error, "finitemonkey rescue")
        )
      );
    }
    return Promise.resolve(
      success({ schema: RESCUE_SCHEMA, action: "restore", sha: made.value, branch }, [
        ctx.t("git.rescue.restored", { branch, sha: made.value.slice(0, 12) })
      ])
    );
  }
};

// src/git/journal.ts
import { join as join16 } from "node:path";
var JOURNAL_FILE = ".finitemonkey/git-journal.jsonl";
var JOURNAL_SCHEMA = "finitemonkey/git-journal@1";
var journalPath = (root) => toAbsolutePath(join16(root, JOURNAL_FILE));
var headsOf = (value) => isRecord(value) ? Object.fromEntries(
  Object.entries(value).filter((entry2) => typeof entry2[1] === "string")
) : {};
var parseJournalLine = (line2) => {
  const parsed = parseJsonObject(line2);
  if (!parsed.ok) return void 0;
  const record2 = parsed.value;
  const ref = optionalString(record2, "ref");
  const commit2 = optionalString(record2, "commit");
  const at = optionalString(record2, "at");
  if (ref === void 0 || commit2 === void 0 || at === void 0) return void 0;
  return {
    schema: JOURNAL_SCHEMA,
    at,
    op: optionalString(record2, "op") ?? "",
    ref,
    commit: commit2,
    head: optionalString(record2, "head"),
    branch: optionalString(record2, "branch"),
    index: optionalString(record2, "index"),
    owner: optionalString(record2, "owner"),
    command: optionalString(record2, "command"),
    heads: headsOf(record2["heads"])
  };
};
var readJournal = (runtime, root) => {
  const text6 = runtime.readText(journalPath(root));
  if (!text6.ok) return [];
  return text6.value.split("\n").flatMap((line2) => {
    const entry2 = line2.trim() === "" ? void 0 : parseJournalLine(line2);
    return entry2 === void 0 ? [] : [entry2];
  });
};
var appendJournal = (runtime, root, entry2) => {
  const path = journalPath(root);
  const made = runtime.mkdir(toAbsolutePath(join16(root, ".finitemonkey")));
  if (!made.ok) return made;
  const previous = runtime.readText(path);
  const before = previous.ok ? previous.value : "";
  const separator = before === "" || before.endsWith("\n") ? "" : "\n";
  const written = runtime.writeAtomic(path, `${before}${separator}${JSON.stringify(entry2)}
`);
  return written.ok ? accept(void 0) : reject(written.error);
};

// src/git/snapshot.ts
var BACKUP_PREFIX = "refs/finitemonkey/backup/";
var DEFAULT_SNAPSHOT_TIMEOUT_MS = 2500;
var stampOf = (iso) => iso.replace(/[:.]/g, "-");
var slug = (op) => op.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "manual";
var optionalLine = (runtime, repo, args) => {
  const result = runtime.git(args, repo.root);
  const value = result.stdout.trim();
  return result.ok && value !== "" ? value : void 0;
};
var branchHeads = (runtime, repo) => {
  const listed3 = runtime.git(
    ["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads", "refs/stash"],
    repo.root
  );
  if (!listed3.ok) return {};
  return Object.fromEntries(
    listed3.stdout.split("\n").flatMap((line2) => {
      const [ref, sha] = line2.split(" ");
      return ref === void 0 || sha === void 0 || ref === "" ? [] : [[ref, sha]];
    })
  );
};
var createRef = (runtime, repo, base, commit2) => {
  for (let attempt2 = 0; attempt2 < 5; attempt2 += 1) {
    const ref = attempt2 === 0 ? base : `${base}-${String(attempt2 + 1)}`;
    if (runtime.git(["update-ref", "--create-reflog", ref, commit2, ""], repo.root).ok) return accept(ref);
  }
  return reject(`update-ref ${base}: could not create the backup ref`);
};
var snapshotCommit = (runtime, repo, head, op, options) => {
  const tree = worktreeTree(runtime, repo, head, options);
  if (!tree.ok) return tree;
  const parents = head === void 0 ? [] : [head];
  const staged = indexTree(runtime, repo, options);
  const indexCommit = staged.ok ? commitTree(runtime, repo, staged.value, parents, `finitemonkey index: ${op}`, options) : void 0;
  const index = indexCommit?.ok === true ? indexCommit.value : void 0;
  const commit2 = commitTree(
    runtime,
    repo,
    tree.value,
    [...parents, ...index === void 0 ? [] : [index]],
    `finitemonkey snapshot: ${op}`,
    options
  );
  return commit2.ok ? accept({ commit: commit2.value, index }) : commit2;
};
var takeSnapshot = (runtime, repo, request) => {
  const at = runtime.now();
  const options = { timeoutMs: request.timeoutMs ?? DEFAULT_SNAPSHOT_TIMEOUT_MS, stamp: stampOf(at) };
  const head = optionalLine(runtime, repo, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  const made = snapshotCommit(runtime, repo, head, request.op, options);
  if (!made.ok) return made;
  const ref = createRef(runtime, repo, `${BACKUP_PREFIX}${options.stamp}-${slug(request.op)}`, made.value.commit);
  if (!ref.ok) return ref;
  const entry2 = {
    schema: JOURNAL_SCHEMA,
    at,
    op: request.op,
    ref: ref.value,
    commit: made.value.commit,
    head,
    branch: optionalLine(runtime, repo, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    index: made.value.index,
    owner: request.owner,
    command: request.command,
    heads: branchHeads(runtime, repo)
  };
  const logged = appendJournal(runtime, repo.root, entry2);
  return logged.ok ? accept(entry2) : reject(`journal: ${logged.error}`);
};
var listSnapshots = (runtime, repo) => {
  const listed3 = runtime.git(["for-each-ref", "--sort=-refname", "--format=%(refname)", BACKUP_PREFIX], repo.root);
  return listed3.ok ? listed3.stdout.split("\n").filter((line2) => line2 !== "") : [];
};

// src/git/undo.ts
import { basename as basename3, dirname as dirname4, join as join17 } from "node:path";
var INDEX_SUBJECT = "finitemonkey index:";
var gitLine = (runtime, repo, args) => {
  const result = runtime.git(args, repo.root);
  const value = result.stdout.trim();
  return result.ok && value !== "" ? value : void 0;
};
var failure2 = (step3, result) => `${step3}: ${result.stderr.trim() || "git failed"}`;
var parentsOf2 = (runtime, repo, commit2) => {
  const listed3 = gitLine(runtime, repo, ["rev-list", "--parents", "-n", "1", commit2])?.split(" ").slice(1) ?? [];
  return listed3.reduce((found, parent) => {
    const subject2 = gitLine(runtime, repo, ["log", "-1", "--format=%s", parent]) ?? "";
    return subject2.startsWith(INDEX_SUBJECT) ? { ...found, index: parent } : { ...found, head: parent };
  }, {});
};
var viewOf = (runtime, repo, ref, journal) => {
  const entry2 = journal.find((item) => item.ref === ref);
  if (entry2 !== void 0) {
    return { ref, commit: entry2.commit, at: entry2.at, op: entry2.op, head: entry2.head, index: entry2.index };
  }
  const commit2 = gitLine(runtime, repo, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) ?? "";
  const parents = parentsOf2(runtime, repo, commit2);
  return {
    ref,
    commit: commit2,
    at: gitLine(runtime, repo, ["log", "-1", "--format=%cI", commit2]) ?? "",
    op: (gitLine(runtime, repo, ["log", "-1", "--format=%s", commit2]) ?? "").replace(/^finitemonkey snapshot: /, ""),
    head: parents.head,
    index: parents.index
  };
};
var snapshotViews = (runtime, repo) => {
  const journal = readJournal(runtime, repo.root);
  return listSnapshots(runtime, repo).map((ref) => viewOf(runtime, repo, ref, journal));
};
var findSnapshot = (views, wanted) => {
  if (wanted === void 0) return views[0];
  if (/^\d+$/.test(wanted)) return views[Number(wanted) - 1];
  const full = wanted.startsWith("refs/") ? wanted : `${BACKUP_PREFIX}${wanted}`;
  return views.find((view2) => view2.ref === full || view2.commit.startsWith(wanted));
};
var stampOf2 = (iso) => iso.replace(/[:.]/g, "-");
var worktreePath = (runtime, repo) => {
  const base = join17(dirname4(repo.root), `${basename3(repo.root)}-undo-${stampOf2(runtime.now())}`);
  return toAbsolutePath(runtime.stat(toAbsolutePath(base)) === void 0 ? base : `${base}-2`);
};
var intoWorktree = (runtime, repo, view2) => {
  const path = worktreePath(runtime, repo);
  const added = runtime.gitWith(["worktree", "add", "--detach", path, view2.commit], repo.root, {});
  return added.ok ? accept(path) : reject(failure2("worktree add", added));
};
var step2 = (runtime, repo, args) => {
  const result = runtime.gitWith(args, repo.root, {});
  return result.ok ? accept(void 0) : reject(failure2(args.join(" "), result));
};
var inPlace = (runtime, repo, view2) => {
  const current = gitLine(runtime, repo, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  if (view2.head !== void 0 && view2.head !== current) {
    const moved = step2(runtime, repo, ["reset", "--soft", view2.head]);
    if (!moved.ok) return moved;
  }
  const tree = step2(runtime, repo, ["read-tree", "--reset", "-u", view2.commit]);
  if (!tree.ok) return tree;
  const index = view2.index ?? view2.head;
  return step2(runtime, repo, index === void 0 ? ["read-tree", "--empty"] : ["read-tree", index]);
};
var undoSnapshot = (runtime, repo, view2, mode) => {
  const backup = takeSnapshot(runtime, repo, { op: `before undo ${view2.ref.replace(BACKUP_PREFIX, "")}` });
  if (!backup.ok) return reject(`snapshot: ${backup.error}`);
  if (mode === "worktree") {
    const path = intoWorktree(runtime, repo, view2);
    return path.ok ? accept({ snapshot: view2, backup: backup.value.ref, mode, path: path.value }) : path;
  }
  const restored = inPlace(runtime, repo, view2);
  return restored.ok ? accept({ snapshot: view2, backup: backup.value.ref, mode, path: void 0 }) : restored;
};

// src/secrets/project.ts
var projectRoot = (ctx) => {
  const top = ctx.runtime.git(["rev-parse", "--show-toplevel"], ctx.cwd);
  const path = top.stdout.trim();
  return top.ok && path !== "" ? toAbsolutePath(path) : ctx.cwd;
};
var isPerson = (ctx) => ctx.io.stdin.isTTY === true && ctx.env["CLAUDECODE"] === void 0 && ctx.env["CLAUDE_CODE_ENTRYPOINT"] === void 0;
var personName = (ctx) => {
  const name = ctx.runtime.git(["config", "user.name"], ctx.cwd).stdout.trim();
  return name !== "" ? name : ctx.env["USER"] ?? ctx.env["USERNAME"] ?? "person";
};

// src/commands/git-undo.ts
var SNAPSHOT_SCHEMA = "finitemonkey/git-snapshot@1";
var UNDO_SCHEMA = "finitemonkey/git-undo@1";
var snapshotCommand = {
  path: ["snapshot"],
  summaryKey: "git.command.snapshot",
  usage: "finitemonkey snapshot [--message <text>] [--json]",
  status: "ready",
  options: { message: { type: "string", short: "m" } },
  run: (ctx, args) => {
    const repo = repoOf2(ctx);
    if (repo === void 0) return Promise.resolve(failureFrom(ctx.t, notRepository(ctx.cwd)));
    const message = args.values["message"];
    const op = typeof message === "string" && message.trim() !== "" ? message.trim() : "manual";
    const taken = takeSnapshot(ctx.runtime, repo, { op });
    if (!taken.ok) {
      return Promise.resolve(
        failureFrom(
          ctx.t,
          gitProblem("git_snapshot_failed", "git.error.snapshot_failed", taken.error, "finitemonkey doctor")
        )
      );
    }
    const data = { schema: SNAPSHOT_SCHEMA, ref: taken.value.ref, commit: taken.value.commit, op };
    return Promise.resolve(
      success(data, [ctx.t("git.snapshot.done", { ref: data.ref, commit: data.commit.slice(0, 12) })])
    );
  }
};
var listResult = (ctx, views) => success({ schema: UNDO_SCHEMA, action: "list", snapshots: views }, [
  ctx.t("git.undo.list_title", { count: views.length }),
  ...views.map(
    (view2, index) => ctx.t("git.undo.list_item", { index: index + 1, at: view2.at, op: view2.op, ref: view2.ref })
  )
]);
var undoCommand = {
  path: ["undo"],
  summaryKey: "git.command.undo",
  usage: "finitemonkey undo [<snapshot>] [--list] [--in-place --yes] [--json]",
  status: "ready",
  options: { list: { type: "boolean" }, "in-place": { type: "boolean" } },
  maxPositionals: 1,
  run: (ctx, args) => {
    const repo = repoOf2(ctx);
    if (repo === void 0) return Promise.resolve(failureFrom(ctx.t, notRepository(ctx.cwd)));
    const views = snapshotViews(ctx.runtime, repo);
    if (args.values["list"] === true) return Promise.resolve(listResult(ctx, views));
    const wanted = args.positionals[0];
    const view2 = findSnapshot(views, wanted);
    if (view2 === void 0) {
      return Promise.resolve(
        failureFrom(ctx.t, {
          code: "git_nothing_to_undo",
          messageKey: "git.error.nothing_to_undo",
          params: { ref: wanted ?? "HEAD" },
          fix: "finitemonkey undo --list",
          exitCode: ExitCode.CheckFailed
        })
      );
    }
    const inPlace2 = args.values["in-place"] === true;
    if (inPlace2 && !(ctx.yes && isPerson(ctx))) {
      return Promise.resolve(
        failureFrom(ctx.t, needsPersonProblem("git.undo.confirm", `finitemonkey undo ${view2.ref} --in-place --yes`))
      );
    }
    const done = undoSnapshot(ctx.runtime, repo, view2, inPlace2 ? "in-place" : "worktree");
    if (!done.ok) {
      return Promise.resolve(
        failureFrom(ctx.t, gitProblem("git_undo_failed", "git.error.undo_failed", done.error, "finitemonkey rescue"))
      );
    }
    const params2 = { ref: view2.ref, backup: done.value.backup, path: done.value.path ?? "" };
    const line2 = ctx.t(inPlace2 ? "git.undo.in_place" : "git.undo.worktree", params2);
    return Promise.resolve(success({ schema: UNDO_SCHEMA, action: "restore", ...done.value }, [line2]));
  }
};

// src/commands/types.ts
var commandName = (spec2) => spec2.path.join(" ");

// src/commands/help.ts
var GLOBAL_FLAGS = [
  { flag: "--json", key: "flag.json" },
  { flag: "--lang <pt-BR|en|es>", key: "flag.lang" },
  { flag: "--yes, -y", key: "flag.yes" },
  { flag: "--dry-run", key: "flag.dry_run" },
  { flag: "--version, -v", key: "flag.version" },
  { flag: "--help, -h", key: "flag.help" }
];
var exitCodeHelp = (ctx) => EXIT_CODE_NAMES.map((name) => ({ code: ExitCode[name], name, summary: ctx.t(exitCodeDocs[ExitCode[name]]) }));
var pad = (text6, width) => text6.padEnd(Math.max(width, text6.length + 1));
var describe2 = (ctx, spec2) => ({
  name: commandName(spec2),
  usage: spec2.usage,
  summary: ctx.t(spec2.summaryKey),
  status: spec2.status,
  options: Object.keys(spec2.options ?? {}).map((name) => `--${name}`)
});
var summaryLine = (ctx, help) => help.status === "planned" ? `${help.summary} ${ctx.t("help.planned")}` : help.summary;
var overview = (ctx, registry) => {
  const commands = registry.map((spec2) => describe2(ctx, spec2));
  const flags = GLOBAL_FLAGS.map(({ flag: flag2, key }) => ({ flag: flag2, summary: ctx.t(key) }));
  const width = Math.max(...commands.map(({ name }) => name.length)) + 2;
  const flagWidth = Math.max(...flags.map(({ flag: flag2 }) => flag2.length)) + 2;
  const exitCodes = exitCodeHelp(ctx);
  const human2 = [
    `finitemonkey ${ctx.version}`,
    ctx.t("help.tagline"),
    "",
    `${ctx.t("help.usage")}: finitemonkey <${ctx.t("help.command")}> [flags]`,
    "",
    `${ctx.t("help.commands")}:`,
    ...commands.map((help) => `  ${pad(help.name, width)}${summaryLine(ctx, help)}`),
    "",
    `${ctx.t("help.flags")}:`,
    ...flags.map(({ flag: flag2, summary }) => `  ${pad(flag2, flagWidth)}${summary}`),
    "",
    `${ctx.t("help.exit_codes")}:`,
    ...exitCodes.map(({ summary }) => `  ${summary}`),
    "",
    ctx.t("help.more")
  ];
  return success({ commands, flags, exitCodes }, human2);
};
var helpFor = (ctx, spec2) => {
  const help = describe2(ctx, spec2);
  const human2 = [
    `${ctx.t("help.usage")}: ${help.usage}`,
    "",
    summaryLine(ctx, help),
    ...help.options.length > 0 ? ["", `${ctx.t("help.options")}: ${help.options.join(", ")}`] : []
  ];
  return success({ command: help }, human2);
};
var topicHelp = (ctx, registry, topic) => {
  const resolved = resolveCommand(registry, topic);
  if (resolved !== void 0) return helpFor(ctx, resolved.spec);
  const problem3 = usageProblem("unknown_command", "error.unknown_command", "finitemonkey help", {
    command: topic.join(" ")
  });
  return failureFrom(ctx.t, problem3);
};
var helpCommand = {
  path: ["help"],
  summaryKey: "command.help.summary",
  usage: "finitemonkey help [command]",
  status: "ready",
  maxPositionals: 3,
  run: (ctx, args, registry) => Promise.resolve(
    args.positionals.length === 0 ? overview(ctx, registry) : topicHelp(ctx, registry, args.positionals)
  )
};

// src/hooks/events.ts
var HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "ConfigChange",
  "Notification",
  "SessionEnd"
];
var HOOK_POLICIES = {
  SessionStart: { failClosed: false },
  UserPromptSubmit: { failClosed: true },
  PreToolUse: { failClosed: true },
  PostToolUse: { failClosed: false },
  Stop: { failClosed: true },
  SubagentStart: { failClosed: false },
  SubagentStop: { failClosed: true },
  PreCompact: { failClosed: false },
  ConfigChange: { failClosed: true },
  Notification: { failClosed: false },
  SessionEnd: { failClosed: false }
};
var squash = (value) => value.replace(/[-_\s]/g, "").toLowerCase();
var parseHookEvent = (raw) => HOOK_EVENTS.find((event) => squash(event) === squash(raw));
var DEFAULT_HOOK_DEADLINE_MS = 3e3;
var LONG_HOOK_DEADLINE_MS = 57e4;
var SESSION_HOOK_DEADLINE_MS = 2e4;
var EVENT_DEADLINES = {
  Stop: LONG_HOOK_DEADLINE_MS,
  SubagentStop: LONG_HOOK_DEADLINE_MS,
  SessionStart: SESSION_HOOK_DEADLINE_MS,
  PreCompact: SESSION_HOOK_DEADLINE_MS
};
var deadlineFor = (event, raw) => {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return EVENT_DEADLINES[event] ?? DEFAULT_HOOK_DEADLINE_MS;
};

// src/hooks/fields.ts
var textField = (record2, ...names) => {
  for (const name of names) {
    const value = record2[name];
    if (typeof value === "string") return value;
  }
  return void 0;
};
var toolName = (raw) => textField(raw, "tool_name") ?? "";
var toolInput = (raw) => {
  const value = raw["tool_input"];
  return isRecord(value) ? value : {};
};
var editsOf = (input) => {
  const single2 = textField(input, "old_string");
  const replacement = textField(input, "new_string");
  if (single2 !== void 0 && replacement !== void 0) {
    return [{ oldText: single2, newText: replacement, all: input["replace_all"] === true }];
  }
  const edits = input["edits"];
  if (!Array.isArray(edits)) return [];
  return edits.flatMap((edit) => {
    if (!isRecord(edit)) return [];
    const oldText = textField(edit, "old_string");
    const newText = textField(edit, "new_string");
    return oldText === void 0 || newText === void 0 ? [] : [{ oldText, newText, all: edit["replace_all"] === true }];
  });
};
var applyEdits = (before, edits) => edits.reduce(
  (text6, edit) => edit.all ? text6.split(edit.oldText).join(edit.newText) : text6.replace(edit.oldText, () => edit.newText),
  before
);

// src/guards/context.ts
var guardRoot = (input) => {
  const project = input.env["CLAUDE_PROJECT_DIR"];
  if (project !== void 0 && project !== "") return toAbsolutePath(project);
  return input.payload.cwd === void 0 ? input.cwd : toAbsolutePath(input.payload.cwd, input.cwd);
};
var grantFor = (input, guard) => {
  const { runtime } = input;
  return activeGrant(runtime, fmPaths(guardRoot(input)), guard, nowMs(runtime), input.payload.sessionId);
};
var deny = (reason, humanText) => {
  const output = {
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
    systemMessage: `finitemonkey: ${humanText}`
  };
  return { kind: "block", reason, output };
};
var FILE_TOOLS = /* @__PURE__ */ new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
var SHELL_TOOLS = /* @__PURE__ */ new Set(["Bash", "PowerShell"]);

// src/guards/bypass/detect.ts
var HOOK_ENV = /^(HUSKY|HUSKY_SKIP_HOOKS|SKIP|LEFTHOOK|LEFTHOOK_EXCLUDE|PRE_COMMIT_ALLOW_NO_CONFIG|DCG_BYPASS|FINITEMONKEY_\w*)$/;
var GIT_VALUE_OPTIONS = /* @__PURE__ */ new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--exec-path",
  "--config-env"
]);
var COMMIT_VALUE_SHORTS = /* @__PURE__ */ new Set(["m", "F", "C", "c", "t"]);
var VERIFY_SUBCOMMANDS = /* @__PURE__ */ new Set(["commit", "push", "merge", "am", "rebase", "cherry-pick", "revert", "pull"]);
var isHooksPath = (value) => /^core\.hookspath(=|$)/i.test(value);
var envFindings = (command) => {
  const pairs = Object.entries(command.env);
  const exported = command.argv[0] === "export" ? command.argv.slice(1).map((arg) => arg.split("=", 2)) : [];
  return [...pairs, ...exported].filter(([name = ""]) => HOOK_ENV.test(name)).map(([name = "", value = ""]) => ({ kind: "hook_env", detail: `${name}=${value}` }));
};
var splitGit = (args) => {
  let index = 0;
  const globals = [];
  while (index < args.length && (args[index] ?? "").startsWith("-")) {
    const arg = args[index] ?? "";
    globals.push(arg);
    if (GIT_VALUE_OPTIONS.has(arg)) globals.push(args[index + 1] ?? "");
    index += GIT_VALUE_OPTIONS.has(arg) ? 2 : 1;
  }
  return { globals, rest: args.slice(index) };
};
var commitHasShortN = (args) => {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "--") return false;
    if (!/^-[A-Za-z]/.test(arg)) continue;
    for (const char of arg.slice(1)) {
      if (char === "n") return true;
      if (COMMIT_VALUE_SHORTS.has(char)) {
        if (arg.endsWith(char)) index += 1;
        break;
      }
    }
  }
  return false;
};
var gitFindings = (args) => {
  const { globals, rest } = splitGit(args);
  const found = [];
  globals.forEach((arg, index) => {
    if (arg === "-c" && isHooksPath(globals[index + 1] ?? "") || /^--config-env=core\.hookspath/i.test(arg)) {
      found.push({ kind: "hooks_path", detail: `git -c ${globals[index + 1] ?? arg}` });
    }
  });
  const [sub = "", ...subArgs] = rest;
  if (VERIFY_SUBCOMMANDS.has(sub) && subArgs.includes("--no-verify"))
    found.push({ kind: "no_verify", detail: `git ${sub} --no-verify` });
  if (sub === "commit" && commitHasShortN(subArgs)) found.push({ kind: "no_verify", detail: "git commit -n" });
  if (sub === "config" && subArgs.some(isHooksPath) && !subArgs.includes("--get")) {
    found.push({ kind: "hooks_path", detail: "git config core.hooksPath" });
  }
  return found;
};
var FM_NAMES = /* @__PURE__ */ new Set(["finitemonkey", "fm"]);
var fmFindings = (argv) => {
  const start = argv[0] === "npx" || argv[0] === "pnpm" || argv[0] === "bunx" ? argv.findIndex((arg) => FM_NAMES.has(arg.replace(/@.*$/, ""))) : 0;
  const name = (argv[start] ?? "").replace(/@.*$/, "");
  return start >= 0 && FM_NAMES.has(name) && argv[start + 1] === "allow" ? [{ kind: "fm_allow", detail: "finitemonkey allow" }] : [];
};
var detectBypass = (commandLine) => parseShell(commandLine).flatMap((command) => [
  ...envFindings(command),
  ...command.argv[0] === "git" ? gitFindings(command.argv.slice(1)) : [],
  ...fmFindings(command.argv)
]);

// src/guards/bypass/hook.ts
var bypassGuard = (input) => {
  if (!SHELL_TOOLS.has(toolName(input.payload.raw))) return { kind: "allow" };
  const command = textField(toolInput(input.payload.raw), "command") ?? "";
  const findings = detectBypass(command);
  const first = findings[0];
  if (first === void 0 || grantFor(input, "bypass") !== void 0) return { kind: "allow" };
  const { t } = input;
  return deny(
    t(`gate.guard.bypass.${first.kind}`, { detail: first.detail }),
    t("gate.guard.bypass.human", { detail: first.detail })
  );
};

// src/guards/self/protected.ts
import { relative as relative3 } from "node:path";
var normalize = (path) => toPosixPath(path).replace(/^\.\//, "");
var selfTarget = (root, path) => {
  const raw = normalize(path);
  const local = raw.startsWith("/") || /^[A-Za-z]:\//.test(raw) ? normalize(relative3(root, path)) : raw;
  const inFm = /(^|\/)\.finitemonkey(\/|$)/.test(local);
  if (inFm && /(^|\/)\.finitemonkey\/allow(\/|$)/.test(local)) return "allow_store";
  if (inFm || /(^|\/)\.gitleaksignore$/.test(local)) return "policy";
  return void 0;
};
var WRITERS = /* @__PURE__ */ new Set([
  "rm",
  "rmdir",
  "mv",
  "cp",
  "touch",
  "truncate",
  "tee",
  "ln",
  "install",
  "chmod",
  "chown",
  "unlink",
  "dd",
  "rsync",
  "mkdir"
]);
var COPIERS = /* @__PURE__ */ new Set(["cp", "install", "rsync", "ln"]);
var IN_PLACE = /* @__PURE__ */ new Set(["sed", "perl", "ruby"]);
var INTERPRETERS = /* @__PURE__ */ new Set(["node", "python", "python3", "ruby", "perl", "deno", "bun", "php"]);
var GIT_WRITERS = /* @__PURE__ */ new Set(["checkout", "restore", "rm", "mv", "clean", "stash", "apply", "reset"]);
var FM_NAMES2 = /* @__PURE__ */ new Set(["finitemonkey", "fm"]);
var inline = (argv) => argv.some((arg) => arg === "-e" || arg === "-c" || arg === "--eval");
var writtenPaths = (command) => {
  const [name = "", ...args] = command.argv;
  const operands2 = args.filter((arg) => !arg.startsWith("-"));
  const ddTargets = args.filter((arg) => arg.startsWith("of=")).map((arg) => arg.slice(3));
  if (FM_NAMES2.has(name)) return command.redirects;
  if (COPIERS.has(name)) return [...command.redirects, ...operands2.slice(-1)];
  if (WRITERS.has(name)) return [...command.redirects, ...operands2, ...ddTargets];
  if (IN_PLACE.has(name) && args.some((arg) => /^-[a-zA-Z]*i/.test(arg) || arg.startsWith("--in-place"))) {
    return [...command.redirects, ...operands2];
  }
  if (INTERPRETERS.has(name) && inline(args)) return [...command.redirects, ...args];
  if (name === "git" && GIT_WRITERS.has(operands2[0] ?? "")) return [...command.redirects, ...operands2.slice(1)];
  return command.redirects;
};
var mentioned = (text6) => {
  if (/\.finitemonkey[\\/]allow/.test(text6)) return "allow_store";
  if (/\.finitemonkey|\.gitleaksignore/.test(text6)) return "policy";
  return void 0;
};
var bashSelfTargets = (root, commandLine) => parseShell(commandLine).flatMap(
  (command) => writtenPaths(command).flatMap((path) => {
    const kind = selfTarget(root, path) ?? mentioned(path);
    return kind === void 0 ? [] : [{ kind, path }];
  })
);

// src/guards/self/hook.ts
var targets = (input) => {
  const tool = toolName(input.payload.raw);
  const args = toolInput(input.payload.raw);
  const root = guardRoot(input);
  if (FILE_TOOLS.has(tool)) {
    const path = textField(args, "file_path", "notebook_path") ?? "";
    const kind = path === "" ? void 0 : selfTarget(root, path);
    return kind === void 0 ? [] : [{ kind, path }];
  }
  return SHELL_TOOLS.has(tool) ? bashSelfTargets(root, textField(args, "command") ?? "") : [];
};
var selfGuard = (input) => {
  const found = targets(input);
  const store = found.find((item) => item.kind === "allow_store");
  const { t } = input;
  if (store !== void 0)
    return deny(
      t("gate.guard.self.allow_store", { file: store.path }),
      t("gate.guard.self.human", { file: store.path })
    );
  const first = found[0];
  if (first === void 0 || grantFor(input, "self") !== void 0) return { kind: "allow" };
  return deny(t("gate.guard.self.policy", { file: first.path }), t("gate.guard.self.human", { file: first.path }));
};

// src/guards/tests/hook.ts
import { join as join18, relative as relative4 } from "node:path";
var localPath = (root, path) => toPosixPath(relative4(root, toAbsolutePath(path, root)));
var read = (input, path) => {
  const text6 = input.runtime.readText(path);
  return text6.ok ? text6.value : void 0;
};
var proposed = (tool, args, before) => {
  if (tool === "Write") return textField(args, "content") ?? "";
  return before === void 0 ? void 0 : applyEdits(before, editsOf(args));
};
var fileViolations = (input, root) => {
  const tool = toolName(input.payload.raw);
  const args = toolInput(input.payload.raw);
  const file = textField(args, "file_path") ?? "";
  if (tool === "NotebookEdit" || file === "") return [];
  const local = localPath(root, file);
  if (!isTestFile(local) && !isProtectedConfig(local)) return [];
  const before = read(input, toAbsolutePath(file, root));
  const after = proposed(tool, args, before);
  if (after === void 0) return [];
  const accepted2 = readTrust(input.runtime, fmPaths(root)).configs[local];
  if (before === void 0) return compareNewTestFile(local, after);
  return [...compareTestFile(local, before, after), ...compareConfig(local, before, after, accepted2)];
};
var shellViolations = (input, root) => {
  const command = textField(toolInput(input.payload.raw), "command") ?? "";
  return parseShell(command).flatMap(
    (simple) => writtenPaths(simple).flatMap((path) => {
      const local = localPath(root, path);
      const exists = input.runtime.stat(toAbsolutePath(join18(root, local))) !== void 0;
      if (!exists) return [];
      if (isProtectedConfig(local)) return [{ kind: "config_changed", path: local }];
      return isTestFile(local) ? [{ kind: "test_removed", path: local }] : [];
    })
  );
};
var testsGuard = (input) => {
  const tool = toolName(input.payload.raw);
  const root = guardRoot(input);
  const found = FILE_TOOLS.has(tool) ? fileViolations(input, root) : SHELL_TOOLS.has(tool) ? shellViolations(input, root) : [];
  const first = found[0];
  if (first === void 0 || grantFor(input, "tests") !== void 0) return { kind: "allow" };
  const { t } = input;
  const params2 = { file: first.path, before: first.before ?? 0, after: first.after ?? 0 };
  const reason = SHELL_TOOLS.has(tool) ? t("gate.guard.tests.shell", params2) : t(`gate.tests.${first.kind}`, params2);
  return deny(t("gate.guard.tests.model", { detail: reason }), t("gate.guard.tests.human", { detail: reason }));
};

// src/gate/hooks/config.ts
import { join as join19 } from "node:path";
var CONFIG_FILE2 = "config-hooks.json";
var GUARDED_SOURCES = /* @__PURE__ */ new Set(["user_settings", "project_settings", "local_settings"]);
var countIn = (value) => {
  if (typeof value === "string") return /\bfinitemonkey\b|\bfm hook\b/.test(value) ? 1 : 0;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countIn(item), 0);
  return isRecord(value) ? Object.values(value).reduce((sum, item) => sum + countIn(item), 0) : 0;
};
var censusOf = (text6) => {
  if (text6 === void 0) return { hooks: 0, disabled: false };
  const parsed = parseJsonObject(text6);
  if (!parsed.ok) return void 0;
  return { hooks: countIn(parsed.value["hooks"]), disabled: parsed.value["disableAllHooks"] === true };
};
var settingsFiles = (paths, env) => [
  toAbsolutePath(join19(paths.root, ".claude", "settings.json")),
  toAbsolutePath(join19(paths.root, ".claude", "settings.local.json")),
  ...env["HOME"] === void 0 ? [] : [toAbsolutePath(join19(env["HOME"], ".claude", "settings.json"))]
];
var read2 = (runtime, path) => {
  const text6 = runtime.readText(path);
  return text6.ok ? text6.value : void 0;
};
var known = (runtime, paths) => {
  const raw = readJsonFile(runtime, paths.cache(CONFIG_FILE2))?.["hooks"];
  return isRecord(raw) ? Object.fromEntries(Object.entries(raw).filter((entry2) => typeof entry2[1] === "number")) : {};
};
var save = (runtime, paths, counts) => {
  writeJsonFile(runtime, paths.cache(CONFIG_FILE2), { hooks: { ...counts } });
};
var recordConfigHooks = (runtime, paths, env) => {
  const counts = Object.fromEntries(
    settingsFiles(paths, env).map((file) => [file, censusOf(read2(runtime, file))?.hooks ?? 0])
  );
  save(runtime, paths, { ...known(runtime, paths), ...counts });
};
var configChange = (input) => {
  const source = textField(input.payload.raw, "source", "config_source") ?? "";
  const file = textField(input.payload.raw, "file_path", "config_path");
  const paths = projectPaths(input);
  if (!GUARDED_SOURCES.has(source) || file === void 0 || paths === void 0) return { kind: "allow" };
  const { runtime, t } = input;
  const path = toAbsolutePath(file, paths.root);
  const census = censusOf(read2(runtime, path));
  const before = known(runtime, paths)[path] ?? 0;
  if (census === void 0 || census.hooks >= before && !census.disabled) {
    if (census !== void 0) save(runtime, paths, { ...known(runtime, paths), [path]: census.hooks });
    return { kind: "allow" };
  }
  const disabled = census.disabled;
  if (activeGrant(runtime, paths, "config", nowMs(runtime), input.payload.sessionId) !== void 0) {
    save(runtime, paths, { ...known(runtime, paths), [path]: census.hooks });
    return allowWith({ systemMessage: human(t("gate.config.released", { file })) });
  }
  const reason = t(disabled ? "gate.config.disabled" : "gate.config.removed", {
    file,
    before,
    after: census.hooks
  });
  return {
    kind: "block",
    reason,
    output: { decision: "block", reason, systemMessage: human(t("gate.config.human", { file })) }
  };
};

// src/evidence/log.ts
var logEvent = (runtime, paths, event, data) => runtime.appendText(paths.log, `${JSON.stringify({ at: runtime.now(), event, ...data })}
`).ok;

// src/guards/release/markers.ts
var LINE = /^\s*(?:finitemonkey|fm):\s+(allow|approve|trust)\s+(\S+)(?:\s+(.*))?$/i;
var NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,80}$/;
var NOT_FROM_PERSON = [
  /<task-notification\b/i,
  /<agent-message\b/i,
  /^\s*\[julius2claude\]/,
  /\[Subagent hand-back\]/i
];
var comesFromPerson = (prompt) => !NOT_FROM_PERSON.some((pattern) => pattern.test(prompt));
var toMarker = (verb, target, rest) => {
  if (!NAME.test(target)) return void 0;
  if (verb === "trust") return { type: "trust", task: target };
  if (verb === "allow") {
    return rest.length >= 3 ? { type: "allow", guard: target.toLowerCase(), reason: rest } : void 0;
  }
  const slash = target.indexOf("/");
  const task = slash < 0 ? void 0 : target.slice(0, slash);
  const check2 = slash < 0 ? target : target.slice(slash + 1);
  if (check2 === "") return void 0;
  return { type: "approve", check: check2, reason: rest, ...task === void 0 || task === "" ? {} : { task } };
};
var parseMarkers = (prompt) => {
  if (!comesFromPerson(prompt)) return [];
  return prompt.split(/\r?\n/).flatMap((line2) => {
    const match = LINE.exec(line2);
    if (match === null) return [];
    const marker = toMarker((match[1] ?? "").toLowerCase(), match[2] ?? "", (match[3] ?? "").trim());
    return marker === void 0 ? [] : [marker];
  });
};

// src/gate/hooks/counter.ts
var OFFICIAL_STOP_CAP = 8;
var NO_PROGRESS_MAX = 3;
var CAP_MARGIN = 2;
var maxBlocks = (env) => {
  const parsed = Number.parseInt(env["CLAUDE_CODE_STOP_HOOK_BLOCK_CAP"] ?? "", 10);
  const cap = Number.isFinite(parsed) && parsed > 0 ? parsed : OFFICIAL_STOP_CAP;
  return Math.max(1, cap - CAP_MARGIN);
};
var failureSignature = (report2) => sha256Hex(
  JSON.stringify([
    report2.treeHash,
    report2.items.filter((item) => item.status === "failed").map((item) => [item.id, item.notes])
  ])
);
var nextBlock = (previous, report2, env) => {
  const signature = failureSignature(report2);
  const sameTask = previous?.task === report2.task;
  const consecutive = (sameTask ? previous.consecutive : 0) + 1;
  const same = sameTask && previous.signature === signature ? previous.same + 1 : 1;
  if (consecutive > maxBlocks(env) || same > NO_PROGRESS_MAX) return { kind: "exhausted", blocks: consecutive - 1 };
  return { kind: "block", counter: { task: report2.task, signature, consecutive, same } };
};
var saveCounter = (store, paths, counter) => {
  return writeState(store, paths, withBlocks(readState(store, paths), counter)).ok;
};
var readCounter = (store, paths) => readState(store, paths).blocks;

// src/gate/hooks/prompt.ts
var RELEASABLE = /* @__PURE__ */ new Set(["tests", "bypass", "self", "config"]);
var trust = (input, paths, task) => {
  const { runtime } = input;
  const taskId = task === IMPLICIT_ID ? void 0 : task;
  const ready = prepareGate({
    runtime,
    cwd: paths.root,
    env: {},
    sessionId: void 0,
    budgetMs: 0,
    fast: true,
    noSkip: true,
    ...taskId === void 0 ? {} : { taskId }
  });
  if (ready.kind !== "ready" || ready.prepared.ctx.contract.id !== task) return false;
  const lock = readTrust(runtime, paths);
  const text6 = runtime.readText(paths.task(task));
  return writeTrust(runtime, paths, {
    ...lock,
    contracts: { ...lock.contracts, [task]: ready.prepared.loaded.hash },
    approved: task === IMPLICIT_ID || !text6.ok ? lock.approved : { ...lock.approved, [task]: text6.value }
  }).ok;
};
var apply = (input, paths, markers) => {
  const { runtime, t } = input;
  const now = nowMs(runtime);
  const at = new Date(now).toISOString();
  const sessionId = input.payload.sessionId;
  const grants = [];
  const approvals = [];
  const said = [];
  const active = readState(runtime, paths).active ?? IMPLICIT_ID;
  for (const marker of markers) {
    if (marker.type === "allow" && RELEASABLE.has(marker.guard)) {
      grants.push({
        guard: marker.guard,
        reason: marker.reason,
        grantedAt: at,
        expiresAt: expiryFrom(now),
        ...sessionId === void 0 ? {} : { sessionId }
      });
      said.push(t("gate.release.allowed", { guard: marker.guard, until: expiryFrom(now) }));
    } else if (marker.type === "allow") said.push(t("gate.release.unknown_guard", { guard: marker.guard }));
    else if (marker.type === "approve") {
      approvals.push({ task: marker.task ?? active, check: marker.check, reason: marker.reason, at });
      said.push(t("gate.release.approved", { task: marker.task ?? active, check: marker.check }));
    } else
      said.push(
        t(trust(input, paths, marker.task) ? "gate.release.trusted" : "gate.release.trust_failed", {
          task: marker.task
        })
      );
    logEvent(runtime, paths, `person.${marker.type}`, { ...marker, sessionId: sessionId ?? null });
  }
  if (grants.length + approvals.length > 0) saveRelease(runtime, paths, now, { grants, approvals });
  return said;
};
var promptRelease = (input) => {
  const prompt = textField(input.payload.raw, "prompt", "prompt_text") ?? "";
  if (!comesFromPerson(prompt)) return { kind: "allow" };
  const paths = projectPaths(input);
  if (paths === void 0) return { kind: "allow" };
  if (readCounter(input.runtime, paths) !== void 0) saveCounter(input.runtime, paths, void 0);
  const markers = parseMarkers(prompt);
  if (markers.length === 0) return { kind: "allow" };
  return allowWith({ systemMessage: human(apply(input, paths, markers).join(" ")) });
};

// src/gate/hooks/snapshot.ts
var currentReport = (runtime, paths, sessionId, taskId) => {
  const ready = prepareGate({
    runtime,
    cwd: paths.root,
    env: {},
    sessionId,
    budgetMs: 0,
    fast: true,
    noSkip: true,
    ...taskId === void 0 ? {} : { taskId }
  });
  if (ready.kind !== "ready") return void 0;
  const { ctx, loaded } = ready.prepared;
  return buildReport2({
    contract: ctx.contract,
    ledger: readLedger(runtime, paths.evidence(ctx.contract.id)),
    treeHash: ctx.treeHash,
    base: ctx.base,
    source: loaded.source,
    contractEdited: loaded.editedOnDisk,
    fastPath: true
  });
};
var ids = (report2, status) => report2.items.filter((item) => item.status === status).map((item) => item.id).join(", ") || "-";
var snapshotOf = (t, report2, grants, at) => ({
  at,
  task: report2?.task ?? "",
  goal: report2?.goal ?? "",
  implicit: report2?.implicit ?? true,
  tree: report2?.treeHash ?? "",
  passed: report2 === void 0 ? "-" : ids(report2, "passed"),
  failed: report2 === void 0 ? "-" : report2.items.filter((item) => item.status === "failed").map((item) => `${item.id} (${itemDetails(t, item).join(", ")})`).join("; ") || "-",
  unverified: report2 === void 0 ? "-" : ids(report2, "unverified"),
  grants: grants.join(", ") || "-"
});
var saveSnapshot = (runtime, paths, t, sessionId) => {
  const now = nowMs(runtime);
  const grants = readGrants(runtime, paths).filter((grant) => Date.parse(grant.expiresAt) > now).map((grant) => `${grant.guard} → ${grant.expiresAt}`);
  const snapshot2 = snapshotOf(t, currentReport(runtime, paths, sessionId), grants, new Date(now).toISOString());
  return writeState(runtime, paths, { ...readState(runtime, paths), snapshot: snapshot2 }).ok;
};
var text5 = (snapshot2, key) => {
  const value = snapshot2[key];
  return typeof value === "string" ? value : "";
};
var snapshotFacts = (t, snapshot2) => {
  if (snapshot2 === void 0 || text5(snapshot2, "at") === "") return void 0;
  const task = text5(snapshot2, "task");
  return t(task === "" || task === "implicit" ? "gate.context.state_implicit" : "gate.context.state", {
    at: text5(snapshot2, "at"),
    task,
    goal: text5(snapshot2, "goal"),
    tree: text5(snapshot2, "tree"),
    passed: text5(snapshot2, "passed"),
    failed: text5(snapshot2, "failed"),
    unverified: text5(snapshot2, "unverified"),
    grants: text5(snapshot2, "grants")
  });
};

// src/gate/hooks/status.ts
var STATUS_FILE = "gate-status.json";
var KINDS = ["passed", "failed", "incomplete", "not_run", "not_done"];
var writeGateStatus = (runtime, paths, status) => writeJsonFile(runtime, paths.cache(STATUS_FILE), { ...status, at: runtime.now() }).ok;
var readGateStatus = (runtime, paths) => {
  const raw = readJsonFile(runtime, paths.cache(STATUS_FILE));
  const status = KINDS.find((kind) => kind === raw?.["status"]);
  const task = raw?.["task"];
  const detail = raw?.["detail"];
  const at = raw?.["at"];
  if (status === void 0 || typeof task !== "string" || typeof detail !== "string" || typeof at !== "string")
    return void 0;
  return { status, task, detail, at };
};

// src/gate/hooks/session.ts
var REINJECT_SOURCES = /* @__PURE__ */ new Set(["compact", "resume"]);
var startBaseline = (runtime, paths, tree) => {
  if (readBaseline(runtime, paths)?.treeHash !== tree) runtime.spawnSelf(["gate", "--baseline"], paths.root);
};
var notRunLine = (t, runtime, paths) => {
  const status = readGateStatus(runtime, paths);
  if (status?.status === "not_run") return [t("gate.human.last_not_run", { at: status.at, detail: status.detail })];
  if (status?.status === "not_done") return [t("gate.human.last_not_done", { at: status.at, detail: status.detail })];
  return [];
};
var markSession = (input, paths) => {
  const { runtime } = input;
  const sessionId = input.payload.sessionId;
  const git = gitAt(runtime, paths.root);
  if (sessionId === void 0 || headSha(git) === void 0) return;
  const tree = treeHash(git);
  if (tree === void 0) return;
  writeSession(runtime, paths, { sessionId, startTree: tree, at: nowMs(runtime) });
  startBaseline(runtime, paths, tree);
  if (cachedPrs(runtime, paths) === void 0) runtime.spawnSelf(["gate", "--prs"], paths.root);
};
var sessionStart = (input) => {
  const paths = projectPaths(input);
  if (paths === void 0) return { kind: "allow" };
  const { t, runtime } = input;
  const source = textField(input.payload.raw, "source") ?? "startup";
  if (source !== "compact") markSession(input, paths);
  recordConfigHooks(runtime, paths, input.env);
  const lines3 = [...notRunLine(t, runtime, paths), ...openPrsLine(t, runtime, paths)];
  const systemMessage = lines3.length === 0 ? void 0 : human(lines3.join(" "));
  const facts = REINJECT_SOURCES.has(source) ? snapshotFacts(t, readState(runtime, paths).snapshot) : void 0;
  if (facts !== void 0) return allowWith(contextOutput("SessionStart", facts, systemMessage));
  return systemMessage === void 0 ? { kind: "allow" } : allowWith({ systemMessage });
};
var preCompact = (input) => {
  const paths = projectPaths(input);
  if (paths !== void 0) saveSnapshot(input.runtime, paths, input.t, input.payload.sessionId);
  return { kind: "allow" };
};

// src/gate/hooks/stop.ts
var failureDetail = (t, failure4) => {
  switch (failure4.kind) {
    case "not_a_repo":
      return t("gate.fail.not_a_repo");
    case "no_tree_hash":
      return t("gate.fail.no_tree_hash");
    case "ledger_unwritable":
      return t("gate.fail.ledger_unwritable");
    case "contract":
      return t(failure4.problem.kind === "not_found" ? "gate.fail.contract_missing" : "gate.fail.contract_invalid", {
        task: failure4.problem.id,
        issues: failure4.problem.kind === "invalid" ? failure4.problem.issues.join("; ") : ""
      });
  }
};
var failingList = (t, report2) => report2.items.filter((item) => item.status === "failed").map((item) => `${item.id} (${itemDetails(t, item).join(", ")})`).join("; ");
var touchesTests = (report2) => report2.items.some(
  (item) => item.status === "failed" && item.notes.some((entry2) => entry2.key.startsWith("gate.tests."))
);
var markDone = (input, report2, root) => {
  if (report2.implicit) return;
  const state = readState(input.runtime, root);
  if (state.active !== report2.task) return;
  writeState(input.runtime, root, closeTask(state, report2.task));
};
var onFailed = (input, report2, paths) => {
  const { t, runtime, env } = input;
  const verdict = nextBlock(readCounter(runtime, paths), report2, env);
  if (verdict.kind === "exhausted") {
    saveCounter(runtime, paths, void 0);
    writeGateStatus(runtime, paths, { status: "not_done", task: report2.task, detail: failingList(t, report2) });
    return allowWith({
      systemMessage: human(t("gate.human.not_done", { blocks: verdict.blocks, list: failingList(t, report2) }))
    });
  }
  saveCounter(runtime, paths, verdict.counter);
  writeGateStatus(runtime, paths, { status: "failed", task: report2.task, detail: failingList(t, report2) });
  const reason = blockReason(t, report2, textField(input.payload.raw, "last_assistant_message"));
  const message = [
    t("gate.human.held", { count: report2.counts.failed }),
    ...touchesTests(report2) ? [t("gate.human.witness")] : []
  ];
  return {
    kind: "block",
    reason,
    persistent: true,
    output: { decision: "block", reason, systemMessage: human(message.join(" ")) }
  };
};
var onReport = (input, report2, paths) => {
  const { t, runtime } = input;
  if (report2.verdict === "failed") return onFailed(input, report2, paths);
  saveCounter(runtime, paths, void 0);
  if (report2.verdict === "incomplete") {
    const list4 = unverifiedSummary(t, report2);
    writeGateStatus(runtime, paths, { status: "incomplete", task: report2.task, detail: list4 });
    return allowWith({ systemMessage: human(t("gate.human.incomplete", { list: list4 })) });
  }
  writeGateStatus(runtime, paths, { status: "passed", task: report2.task, detail: "" });
  markDone(input, report2, paths);
  return allowWith({ systemMessage: human(t("gate.human.passed", { count: report2.counts.passed })) });
};
var conclude = (input, run3) => {
  const { t, runtime } = input;
  if (run3.kind === "skipped") return { kind: "allow" };
  const root = findRepoRoot(runtime, sessionCwd(input));
  if (root === void 0)
    return allowWith({ systemMessage: human(t("gate.human.not_run", { detail: t("gate.fail.not_a_repo") })) });
  const paths = fmPaths(root);
  if (run3.kind === "done") return onReport(input, run3.report, paths);
  const detail = failureDetail(t, run3.failure);
  writeGateStatus(runtime, paths, { status: "not_run", task: "", detail });
  return allowWith({ systemMessage: human(t("gate.human.not_run", { detail })) });
};
var safeRun = (input) => {
  try {
    return runGate({
      runtime: input.runtime,
      cwd: sessionCwd(input),
      env: input.env,
      sessionId: input.payload.sessionId,
      budgetMs: gateBudget(input),
      fast: true
    });
  } catch (error) {
    return { kind: "crashed", detail: error instanceof Error ? error.message : String(error) };
  }
};
var stopGate = (input) => {
  const run3 = safeRun(input);
  if (run3.kind !== "crashed") return conclude(input, run3);
  return allowWith({ systemMessage: human(input.t("gate.human.not_run", { detail: run3.detail })) });
};
var isOwnWorktree = (input) => {
  if (input.payload.cwd === void 0) return false;
  const runtime = input.runtime;
  const front = findRepoRoot(runtime, sessionCwd(input));
  const main2 = findRepoRoot(runtime, input.cwd);
  return front !== void 0 && main2 !== void 0 && front !== main2;
};
var subagentStopGate = (input) => isOwnWorktree(input) ? stopGate(input) : { kind: "allow" };

// src/gate/hooks/subagent.ts
import { join as join20 } from "node:path";
var NO_CONTRACT_AGENTS = /(^|:)(reviewer|verifier|explore|plan|claude-code-guide|statusline-setup)$/i;
var requirementText = (t, check2) => {
  const key = `gate.require.${check2.kind}`;
  const known2 = [
    "command",
    "tests",
    "diff",
    "placeholders",
    "git",
    "pr",
    "manual",
    "secrets",
    "worktree",
    "merge"
  ].includes(check2.kind);
  return `${check2.id} ${t(known2 ? key : "gate.require.other", { command: check2.run ?? check2.kind, kind: check2.kind })}`;
};
var contractFacts = (t, contract, briefing) => [
  t("gate.context.front", { task: contract.id, goal: contract.goal, file: taskRelative(contract.id) }),
  t("gate.context.done_means", { list: contract.acceptance.map((check2) => requirementText(t, check2)).join("; ") }),
  ...contract.scope.paths.length > 0 ? [t("gate.context.scope", { paths: contract.scope.paths.join(", ") })] : [],
  ...briefing ? [t("gate.context.briefing", { file: ".finitemonkey/briefing.md" })] : []
].join("\n");
var subagentStart = (input) => {
  const agentType = textField(input.payload.raw, "agent_type") ?? "";
  const paths = projectPaths(input);
  if (paths === void 0 || NO_CONTRACT_AGENTS.test(agentType)) return { kind: "allow" };
  const { runtime, t } = input;
  const active = readState(runtime, paths).active;
  if (active === void 0) return { kind: "allow" };
  const disk = (relative7) => {
    const text6 = runtime.readText(toAbsolutePath(join20(paths.root, relative7)));
    return text6.ok ? text6.value : void 0;
  };
  const loaded = loadTask(runtime, paths, { disk, base: () => void 0 }, active);
  if (!loaded.ok) return { kind: "allow" };
  const briefing = runtime.stat(toAbsolutePath(join20(paths.dir, "briefing.md"))) !== void 0;
  return { kind: "allow", output: contextOutput("SubagentStart", contractFacts(t, loaded.value.contract, briefing)) };
};

// src/gate/hooks/index.ts
var PORTAO_HANDLERS = {
  PreToolUse: [selfGuard, bypassGuard, testsGuard],
  UserPromptSubmit: [promptRelease],
  Stop: [stopGate],
  SubagentStop: [subagentStopGate],
  SubagentStart: [subagentStart],
  PreCompact: [preCompact],
  SessionStart: [sessionStart],
  ConfigChange: [configChange]
};

// src/prod/guard.ts
import { join as join22 } from "node:path";

// src/git/command-text.ts
var MAX_SHOWN = 160;
var shown = (text6) => {
  const flat = text6.replace(/\s+/g, " ").trim();
  return flat.length > MAX_SHOWN ? `${flat.slice(0, MAX_SHOWN - 3)}...` : flat;
};
var commandText = (command) => shown([command.program, ...command.args].join(" "));

// src/prod/readonly.ts
var READ_PROGRAMS = /* @__PURE__ */ new Set([
  "cat",
  "less",
  "more",
  "head",
  "tail",
  "grep",
  "egrep",
  "fgrep",
  "zgrep",
  "zcat",
  "rg",
  "ls",
  "ll",
  "df",
  "du",
  "free",
  "uptime",
  "whoami",
  "id",
  "hostname",
  "uname",
  "ps",
  "pgrep",
  "pidof",
  "journalctl",
  "stat",
  "file",
  "wc",
  "date",
  "echo",
  "pwd",
  "which",
  "type",
  "lsof",
  "netstat",
  "ss",
  "dig",
  "nslookup",
  "ping",
  "top",
  "htop",
  "vmstat",
  "iostat",
  "nproc",
  "lscpu",
  "lsblk",
  "w",
  "last",
  "history",
  "true",
  "test",
  "[",
  "sort",
  "uniq",
  "cut",
  "awk",
  "jq",
  "dmesg",
  "tree",
  "realpath",
  "readlink",
  "basename",
  "dirname",
  "sha256sum",
  "md5sum"
]);
var GIT_READ = /* @__PURE__ */ new Set(["status", "log", "diff", "show", "rev-parse", "describe", "ls-files", "blame", "shortlog"]);
var GIT_LIST = /* @__PURE__ */ new Set(["remote", "branch", "tag", "stash"]);
var DOCKER_READ = /* @__PURE__ */ new Set([
  "ps",
  "logs",
  "images",
  "inspect",
  "info",
  "version",
  "stats",
  "top",
  "events",
  "port",
  "diff",
  "history",
  "ls",
  "df",
  "show",
  "config"
]);
var DOCKER_GROUPS = /* @__PURE__ */ new Set([
  "container",
  "image",
  "compose",
  "system",
  "volume",
  "network",
  "context",
  "builder",
  "node",
  "service",
  "stack"
]);
var SYSTEMCTL_READ = /* @__PURE__ */ new Set([
  "status",
  "is-active",
  "is-enabled",
  "is-failed",
  "list-units",
  "list-unit-files",
  "show",
  "cat",
  "list-timers"
]);
var KUBECTL_READ = /* @__PURE__ */ new Set([
  "get",
  "describe",
  "logs",
  "top",
  "explain",
  "version",
  "api-resources",
  "api-versions",
  "cluster-info",
  "diff",
  "events",
  "auth"
]);
var HELM_READ = /* @__PURE__ */ new Set([
  "list",
  "ls",
  "status",
  "get",
  "history",
  "show",
  "template",
  "lint",
  "version",
  "search",
  "env"
]);
var CURL_WRITE = /^(?:-X|--request|-d|--data.*|-F|--form|-T|--upload-file|-o|--output|-O|--remote-name)$/;
var firstPositional = (args, valueFlags = /* @__PURE__ */ new Set()) => {
  const out = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg.startsWith("-")) {
      if (valueFlags.has(arg)) index += 1;
    } else out.push(arg);
  }
  return out;
};
var DOCKER_VALUE_FLAGS = /* @__PURE__ */ new Set([
  "-H",
  "--host",
  "-c",
  "--context",
  "--config",
  "-l",
  "--log-level",
  "-f",
  "--file",
  "-p",
  "--project-name"
]);
var KUBE_VALUE_FLAGS = /* @__PURE__ */ new Set([
  "--context",
  "-n",
  "--namespace",
  "--kubeconfig",
  "--cluster",
  "--user",
  "-o",
  "--output",
  "-l",
  "--selector",
  "-c",
  "--container",
  "--kube-context"
]);
var dockerReadOnly = (args) => {
  const words = firstPositional(args, DOCKER_VALUE_FLAGS);
  const [first, second] = words;
  if (first === void 0) return true;
  if (DOCKER_GROUPS.has(first))
    return second === void 0 || DOCKER_READ.has(second) || first === "compose" && second === "top";
  return DOCKER_READ.has(first);
};
var kubectlReadOnly = (program, args) => {
  const [verb, object] = firstPositional(args, KUBE_VALUE_FLAGS);
  if (verb === void 0) return true;
  if (program === "helm") return HELM_READ.has(verb);
  if (verb === "config") return object === "view" || object === "get-contexts" || object === "current-context";
  if (verb === "rollout") return object === "status" || object === "history";
  return KUBECTL_READ.has(verb);
};
var writesFile = (command) => command.redirects.some(
  (redirect) => (redirect.op === ">" || redirect.op === ">>" || redirect.op === ">|") && !/^(?:\/dev\/null|&?\d)$/.test(redirect.target) && !redirect.op.startsWith("<")
);
var gitReadOnly = (args) => {
  const [verb, ...rest] = firstPositional(args, /* @__PURE__ */ new Set(["-C", "-c"]));
  if (verb === void 0) return true;
  if (GIT_READ.has(verb)) return true;
  return GIT_LIST.has(verb) && (rest.length === 0 || verb === "stash" && rest[0] === "list");
};
var programReadOnly = (command) => {
  const { program, args } = command;
  if (program === "git") return gitReadOnly(args);
  if (program === "docker" || program === "docker-compose")
    return dockerReadOnly(program === "docker-compose" ? ["compose", ...args] : args);
  if (program === "systemctl") return SYSTEMCTL_READ.has(firstPositional(args)[0] ?? "status");
  if (program === "kubectl" || program === "helm") return kubectlReadOnly(program, args);
  if (program === "curl") return !args.some((arg) => CURL_WRITE.test(arg));
  if (program === "find")
    return !args.some((arg) => arg === "-delete" || arg.startsWith("-exec") || arg.startsWith("-ok"));
  if (program === "sed") return !args.some((arg) => arg.startsWith("-i") || arg === "--in-place");
  if (program === "awk") return !args.some((arg) => arg.includes("system(") || arg.includes(">"));
  return READ_PROGRAMS.has(program);
};
var readOnlyCommand = (command) => !writesFile(command) && programReadOnly(command);
var readOnlyScript = (script) => {
  const normalized = normalizeCommand(script);
  return !normalized.incomplete && normalized.commands.every(readOnlyCommand);
};
var SQL_READ = /^\s*(?:select|show|explain|describe|desc|with|\\d\S*|\\l|\\dt|\\x|table)\b/i;
var SQL_WRITE = /\b(?:insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|merge|call|do|vacuum|reindex|cluster|lock|set\s+role)\b/i;
var readOnlySql = (sql) => sql.split(";").map((statement) => statement.trim()).filter((statement) => statement !== "").every((statement) => SQL_READ.test(statement) && !SQL_WRITE.test(statement));
var REDIS_READ = /* @__PURE__ */ new Set([
  "get",
  "mget",
  "keys",
  "scan",
  "info",
  "ttl",
  "pttl",
  "type",
  "exists",
  "strlen",
  "hget",
  "hgetall",
  "hkeys",
  "lrange",
  "llen",
  "smembers",
  "scard",
  "zrange",
  "zcard",
  "ping",
  "dbsize",
  "config"
]);
var readOnlyRedis = (words) => {
  const [first, second] = words;
  if (first === void 0) return false;
  if (first.toLowerCase() === "config") return (second ?? "").toLowerCase() === "get";
  return REDIS_READ.has(first.toLowerCase());
};

// src/prod/remote.ts
var SSH_VALUE = "bcDEeFIiJLlmOopQRSWwB";
var SCP_VALUE = "cFiJloPSX";
var RSYNC_LONG_VALUE = /* @__PURE__ */ new Set([
  "--rsh",
  "--rsync-path",
  "--filter",
  "--exclude",
  "--include",
  "--port",
  "--password-file",
  "--chmod",
  "--log-file",
  "--exclude-from",
  "--include-from",
  "--files-from"
]);
var parseSsh = (command) => {
  const { args } = command;
  let index = 0;
  let noCommand = false;
  while (index < args.length && (args[index] ?? "").startsWith("-")) {
    const arg = args[index] ?? "";
    if (arg === "--") {
      index += 1;
      break;
    }
    if (arg.includes("N")) noCommand = true;
    const last = arg.charAt(arg.length - 1);
    index += arg.length === 2 && SSH_VALUE.includes(last) ? 2 : 1;
  }
  const destination = args[index];
  if (destination === void 0) return void 0;
  return { destination: destination.replace(/^ssh:\/\//, ""), remote: args.slice(index + 1), noCommand };
};
var REMOTE_PATH = /^(?:(?:scp|rsync|sftp):\/\/)?(?:[^@/:\s]+@)?(\[[^\]]+\]|[A-Za-z0-9][A-Za-z0-9.-]*)(?::|::|\/)/;
var remoteHostOf = (operand) => {
  if (/^[A-Za-z]:[\\/]/.test(operand) || operand.startsWith("/") || operand.startsWith(".")) return void 0;
  const url = /^(?:scp|rsync|sftp):\/\//.test(operand);
  const match = REMOTE_PATH.exec(operand);
  if (match === null) return void 0;
  if (!url && !operand.slice(match[0].length - 1).startsWith(":")) return void 0;
  return (match[1] ?? "").replace(/^\[|\]$/g, "");
};
var copyOperands = (command, shortValue) => {
  const out = [];
  for (let index = 0; index < command.args.length; index += 1) {
    const arg = command.args[index] ?? "";
    if (arg.startsWith("--")) {
      if (!arg.includes("=") && RSYNC_LONG_VALUE.has(arg)) index += 1;
    } else if (arg.startsWith("-") && arg.length > 1) {
      if (arg.length === 2 && shortValue.includes(arg.charAt(1))) index += 1;
    } else out.push(arg);
  }
  return out;
};
var parseCopy = (command) => {
  const operands2 = copyOperands(command, command.program === "scp" ? SCP_VALUE : "efTB");
  return { sources: operands2.slice(0, -1), target: operands2[operands2.length - 1] };
};
var remoteHostsOf = (command) => {
  if (command.program === "ssh") {
    const call = parseSsh(command);
    return call === void 0 ? [] : [call.destination];
  }
  if (command.program === "scp" || command.program === "rsync") {
    const call = parseCopy(command);
    return [...call.sources, ...call.target === void 0 ? [] : [call.target]].flatMap((operand) => {
      const host = remoteHostOf(operand);
      return host === void 0 ? [] : [host];
    });
  }
  return [];
};

// src/prod/targets.ts
import { join as join21 } from "node:path";
var DEPLOY_FILES = [
  "deploy.sh",
  "scripts/deploy.sh",
  "docker-compose.prod.yml",
  "docker-compose.production.yml",
  "compose.prod.yml",
  "compose.production.yml"
];
var SSH_URL = /ssh:\/\/(?:[^@\s/]+@)?([A-Za-z0-9.-]+)/g;
var HOST_KEY = /^\s*-?\s*(?:host|hostname|server|ssh_host|deploy_host|remote_host)\s*:\s*["']?([A-Za-z0-9][A-Za-z0-9.-]*)["']?\s*$/i;
var hostKey = (raw) => raw.trim().toLowerCase().replace(/^[^@]*@/, "").replace(/^\[([^\]]+)\].*$/, "$1").replace(/:\d+$/, "").replace(/\.$/, "");
var shellLine = (line2) => line2.replace(/^\s*(?:-\s*)?(?:run:\s*\|?)?/, "");
var hostsInText = (text6) => {
  const urls = [...text6.matchAll(SSH_URL)].map((match) => match[1] ?? "");
  const lines3 = text6.split(/\r?\n/);
  const keyed = lines3.flatMap((line2) => {
    const match = HOST_KEY.exec(line2);
    return match?.[1] === void 0 ? [] : [match[1]];
  });
  const commands = lines3.flatMap((line2) => normalizeCommand(shellLine(line2)).commands.flatMap(remoteHostsOf));
  return [...urls, ...keyed, ...commands].filter((host) => host !== "" && !host.includes("$"));
};
var workflowFiles = (runtime, root) => {
  const listed3 = runtime.listDir(toAbsolutePath(join21(root, ".github", "workflows")));
  if (!listed3.ok) return [];
  return listed3.value.filter((name) => /deploy/i.test(name) && /\.ya?ml$/i.test(name)).map((name) => `.github/workflows/${name}`);
};
var detectedHosts = (runtime, root, files) => files.flatMap((file) => {
  const text6 = runtime.readText(toAbsolutePath(join21(root, file)));
  return text6.ok ? hostsInText(text6.value) : [];
});
var loadProdTargets = (runtime, root, config) => {
  const workflows = workflowFiles(runtime, root);
  const deployFiles = [...workflows, ...DEPLOY_FILES];
  const hosts = [
    ...configList(config, "prod", "hosts"),
    ...configList(config, "prod", "databases"),
    ...detectedHosts(runtime, root, deployFiles)
  ];
  const declaredDeploy = configAt(config, "prod", "deploy");
  const existing = deployFiles.find((file) => runtime.stat(toAbsolutePath(join21(root, file))) !== void 0);
  return {
    hosts: new Set(hosts.map(hostKey).filter((host) => host !== "")),
    kubeContexts: configList(config, "prod", "kube_contexts"),
    dockerContexts: configList(config, "prod", "docker_contexts"),
    deployPath: typeof declaredDeploy === "string" ? declaredDeploy : existing
  };
};
var isProdContext = (name, declared) => declared.includes(name) || /(?:^|[-_.:/])(?:prod|production)(?:$|[-_.:/])/i.test(name);

// src/prod/classify.ts
var hit = (effect, target, tool) => ({ effect, target, tool });
var sshHit = (command, isProd) => {
  const call = parseSsh(command);
  if (call === void 0 || !isProd(call.destination)) return void 0;
  const host = hostKey(call.destination);
  if (call.remote.length === 0) {
    if (command.stdin !== void 0) return hit(readOnlyScript(command.stdin) ? "read" : "effect", host, "ssh");
    return hit(call.noCommand ? "read" : "interactive", host, "ssh");
  }
  return hit(readOnlyScript(call.remote.join(" ")) ? "read" : "effect", host, "ssh");
};
var copyHit = (command, isProd) => {
  const call = parseCopy(command);
  const targetHost = call.target === void 0 ? void 0 : remoteHostOf(call.target);
  if (targetHost !== void 0 && isProd(targetHost)) return hit("effect", hostKey(targetHost), command.program);
  const source = call.sources.map(remoteHostOf).find((host) => host !== void 0 && isProd(host));
  return source === void 0 ? void 0 : hit("read", hostKey(source), command.program);
};
var valueAfter = (args, ...names) => {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    const equals = names.find((name) => arg.startsWith(`${name}=`));
    if (equals !== void 0) return arg.slice(equals.length + 1);
    if (names.includes(arg)) return args[index + 1];
  }
  return void 0;
};
var dockerHit = (command, targets2, isProd) => {
  const host = valueAfter(command.args, "-H", "--host") ?? command.env["DOCKER_HOST"];
  const context = valueAfter(command.args, "-c", "--context") ?? command.env["DOCKER_CONTEXT"];
  const remote = host === void 0 ? void 0 : host.replace(/^(?:ssh|tcp|https?):\/\//, "");
  const switching = command.args[0] === "context" && command.args[1] === "use" ? command.args[2] : void 0;
  if (switching !== void 0 && isProdContext(switching, targets2.dockerContexts))
    return hit("effect", switching, "docker context");
  const prodHost = remote !== void 0 && isProd(remote) ? hostKey(remote) : void 0;
  const prodContext = context !== void 0 && isProdContext(context, targets2.dockerContexts) ? context : void 0;
  const target = prodHost ?? prodContext;
  if (target === void 0) return void 0;
  return hit(dockerReadOnly(command.args) ? "read" : "effect", target, "docker");
};
var kubeHit = (command, targets2) => {
  const context = valueAfter(command.args, "--context", "--kube-context");
  const [verb, object, name] = command.args.filter((arg) => !arg.startsWith("-"));
  if (verb === "config" && object === "use-context" && name !== void 0 && isProdContext(name, targets2.kubeContexts)) {
    return hit("effect", name, command.program);
  }
  if (context === void 0 || !isProdContext(context, targets2.kubeContexts)) return void 0;
  return hit(kubectlReadOnly(command.program, command.args) ? "read" : "effect", context, command.program);
};
var URL_HOST = /^(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?):\/\/(?:[^@/]*@)?([^/:?,]+)/i;
var DATABASE_TOOLS = /* @__PURE__ */ new Set([
  "psql",
  "mysql",
  "mariadb",
  "mongosh",
  "mongo",
  "redis-cli",
  "pg_dump",
  "mysqldump",
  "pg_restore"
]);
var DUMPS = /* @__PURE__ */ new Set(["pg_dump", "mysqldump"]);
var databaseHost = (command) => {
  const flag2 = valueAfter(command.args, "-h", "--host");
  if (flag2 !== void 0) return flag2;
  const url = [...command.args, command.env["DATABASE_URL"] ?? ""].map((arg) => URL_HOST.exec(arg)?.[1]).find((host) => host !== void 0);
  return url ?? command.env["PGHOST"];
};
var databaseReadOnly = (command) => {
  if (DUMPS.has(command.program)) return true;
  if (command.program === "redis-cli")
    return readOnlyRedis(
      command.args.filter((arg, index) => !arg.startsWith("-") && !(command.args[index - 1] ?? "").startsWith("-"))
    );
  const sql = valueAfter(command.args, "-c", "--command", "-e", "--execute", "--eval");
  return sql !== void 0 && readOnlySql(sql);
};
var databaseHit = (command, isProd) => {
  const host = databaseHost(command);
  if (host === void 0 || !isProd(host)) return void 0;
  return hit(databaseReadOnly(command) ? "read" : "effect", hostKey(host), command.program);
};
var prodHit = (command, targets2, isProd) => {
  switch (command.program) {
    case "ssh":
      return sshHit(command, isProd);
    case "scp":
    case "rsync":
      return copyHit(command, isProd);
    case "docker":
    case "docker-compose":
      return dockerHit(command, targets2, isProd);
    case "kubectl":
    case "helm":
      return kubeHit(command, targets2);
    default:
      return DATABASE_TOOLS.has(command.program) ? databaseHit(command, isProd) : void 0;
  }
};

// src/prod/guard.ts
var PROD_PROGRAMS = /* @__PURE__ */ new Set([
  "ssh",
  "scp",
  "rsync",
  "docker",
  "docker-compose",
  "kubectl",
  "helm",
  "psql",
  "mysql",
  "mariadb",
  "mongosh",
  "mongo",
  "redis-cli",
  "pg_dump",
  "mysqldump",
  "pg_restore"
]);
var EVIDENCE_FILE = ".finitemonkey/prod-evidence.jsonl";
var SSH_LOOKUP_MS = 1500;
var sshHostname = (runtime, root, destination) => {
  if (!/^[A-Za-z0-9._@-]+$/.test(destination)) return void 0;
  const result = runtime.exec({ command: "ssh", args: ["-G", destination], cwd: root, timeoutMs: SSH_LOOKUP_MS });
  if (result.exitCode !== 0) return void 0;
  const line2 = result.stdout.split("\n").find((entry2) => entry2.startsWith("hostname "));
  return line2 === void 0 ? void 0 : hostKey(line2.slice("hostname ".length));
};
var isProdHostOf = (runtime, root, targets2) => memoBy((raw) => {
  const { hosts } = targets2();
  if (hosts.size === 0) return false;
  const key = hostKey(raw);
  if (hosts.has(key)) return true;
  const resolved = sshHostname(runtime, root, raw.replace(/^[^@]*@/, ""));
  return resolved !== void 0 && hosts.has(resolved);
});
var blockOf = (t, hit2, command, deploy) => ({
  kind: "block",
  reason: hit2.effect === "interactive" ? t("prod.block.interactive", { command, target: hit2.target }) : t("prod.block.effect", { command, target: hit2.target, deploy: deploy ?? t("prod.deploy.unknown") })
});
var prodGuard = (runtime, root, t) => {
  const targets2 = memo2(() => loadProdTargets(runtime, root, loadProjectConfig(runtime, root)));
  const isProd = isProdHostOf(runtime, root, targets2);
  return {
    decide: (command) => {
      if (!PROD_PROGRAMS.has(command.program)) return void 0;
      const hit2 = prodHit(command, targets2(), isProd);
      if (hit2 === void 0) return void 0;
      const text6 = commandText(command);
      return hit2.effect === "read" ? { kind: "read", hit: hit2, command: text6 } : blockOf(t, hit2, text6, targets2().deployPath);
    }
  };
};
var recordEvidence = (runtime, root, owner, reads) => {
  const lines3 = reads.flatMap(
    (read3) => read3.kind === "read" ? [
      JSON.stringify({
        at: runtime.now(),
        owner,
        tool: read3.hit.tool,
        target: read3.hit.target,
        command: read3.command
      })
    ] : []
  );
  if (lines3.length === 0) return;
  const path = toAbsolutePath(join22(root, EVIDENCE_FILE));
  runtime.mkdir(toAbsolutePath(join22(root, ".finitemonkey")));
  const before = runtime.readText(path);
  const text6 = before.ok ? before.value : "";
  runtime.writeAtomic(path, `${text6}${text6 === "" || text6.endsWith("\n") ? "" : "\n"}${lines3.join("\n")}
`);
};

// src/secrets/guards/tool-input.ts
var toolName2 = (payload) => optionalString(payload.raw, "tool_name") ?? "";
var toolInput2 = (payload) => {
  const input = payload.raw["tool_input"];
  return isRecord(input) ? input : {};
};
var editTexts = (input, file) => {
  const edits = input["edits"];
  if (!Array.isArray(edits)) return [];
  return edits.flatMap((edit) => {
    if (!isRecord(edit)) return [];
    const text6 = optionalString(edit, "new_string");
    return text6 === void 0 ? [] : [{ file, text: text6, whole: false }];
  });
};
var writtenTexts = (tool, input) => {
  const file = optionalString(input, "file_path") ?? optionalString(input, "notebook_path") ?? "";
  const single2 = (key, whole) => {
    const text6 = optionalString(input, key);
    return text6 === void 0 ? [] : [{ file, text: text6, whole }];
  };
  switch (tool) {
    case "Write":
      return single2("content", true);
    case "Edit":
      return single2("new_string", false);
    case "MultiEdit":
      return editTexts(input, file);
    case "NotebookEdit":
      return single2("new_source", false);
    default:
      return [];
  }
};
var stringLeaves = (value, out = []) => {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) stringLeaves(item, out);
  else if (isRecord(value)) for (const item of Object.values(value)) stringLeaves(item, out);
  return out;
};

// src/git/invocation.ts
var WITH_VALUE = /* @__PURE__ */ new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--exec-path",
  "--super-prefix",
  "--config-env",
  "--attr-source"
]);
var addConfig = (globals, entry2) => {
  const equals = entry2.indexOf("=");
  const key = (equals < 0 ? entry2 : entry2.slice(0, equals)).toLowerCase();
  globals.config[key] = equals < 0 ? "true" : entry2.slice(equals + 1);
};
var globalOption = (globals, name, value) => {
  if (name === "-C") globals.dirs.push(value);
  else if (name === "-c") addConfig(globals, value);
  else if (name === "--work-tree") globals.dirs.push(value);
};
var gitInvocation = (command) => {
  if (command.program !== "git") return void 0;
  const globals = { dirs: [], config: {} };
  const { args } = command;
  let index = 0;
  while (index < args.length && (args[index] ?? "").startsWith("-")) {
    const arg = args[index] ?? "";
    const equals = arg.indexOf("=");
    const name = equals > 2 && arg.startsWith("--") ? arg.slice(0, equals) : arg;
    if (WITH_VALUE.has(name) && equals < 0) {
      globalOption(globals, name, args[index + 1] ?? "");
      index += 2;
    } else {
      if (equals > 0) globalOption(globals, name, arg.slice(equals + 1));
      index += 1;
    }
  }
  return {
    dirs: globals.dirs,
    config: globals.config,
    subcommand: args[index] ?? "",
    args: args.slice(index + 1),
    command
  };
};
var withAlias = (invocation, expansion) => ({
  ...invocation,
  subcommand: expansion[0] ?? "",
  args: [...expansion.slice(1), ...invocation.args]
});

// src/git/path-key.ts
import { posix as posix2 } from "node:path";
var WSL_MOUNT2 = /^\/mnt\/([a-zA-Z])(\/|$)/;
var DRIVE = /^([a-zA-Z]):(\/|$)/;
var pathKey = (path) => {
  const posixPath = toPosixPath(path).replace(
    WSL_MOUNT2,
    (_match, letter, slash) => `${letter}:${slash || "/"}`
  );
  const drive = DRIVE.exec(posixPath);
  const normalized = posix2.normalize(drive === null ? posixPath : posixPath.slice(2) || "/");
  const trimmed = normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
  return drive === null ? trimmed : `${(drive[1] ?? "").toLowerCase()}:${trimmed}`.toLowerCase();
};
var isWithin = (child2, parent) => {
  const childKey = pathKey(child2);
  const parentKey = pathKey(parent);
  if (childKey === parentKey) return true;
  const base = parentKey.endsWith("/") ? parentKey : `${parentKey}/`;
  return childKey.startsWith(base);
};
var isRootLike = (path, home) => {
  const key = pathKey(path);
  if (key === "/" || /^[a-z]:\/?$/.test(key)) return true;
  return home !== void 0 && home !== "" && key === pathKey(home);
};
var resolveFrom = (base, ...parts) => parts.reduce((current, part2) => {
  if (part2 === void 0 || part2 === "") return current;
  const next2 = toPosixPath(part2);
  if (next2.startsWith("/") || DRIVE.test(next2)) return next2;
  return posix2.join(toPosixPath(current), next2);
}, toPosixPath(base));

// src/git/pathspec.ts
import { posix as posix3 } from "node:path";
var MAGIC = /^:(?:\(([^)]*)\)|([!^/]*))(.*)$/s;
var GLOB = /[*?[]/;
var specOf = (raw, prefix) => {
  const posixRaw = toPosixPath(raw);
  const magic = MAGIC.exec(posixRaw);
  const words = magic === null ? "" : magic[1] ?? magic[2] ?? "";
  const rest = magic === null ? posixRaw : magic[3] ?? "";
  const exclude = /(?:^|,)exclude(?:,|$)|[!^]/.test(words);
  const top = /(?:^|,)top(?:,|$)|\//.test(words);
  const joined = posix3.normalize(top ? rest : posix3.join(prefix === "" ? "." : prefix, rest));
  return { pattern: joined === "./" ? "." : joined.replace(/\/$/, ""), exclude };
};
var globRegex3 = (pattern) => {
  const escaped = pattern.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}(?:/.*)?$`);
};
var matchesOne = (file, pattern) => {
  if (pattern === "." || pattern === "") return true;
  if (GLOB.test(pattern)) return globRegex3(pattern).test(file);
  return file === pattern || file.startsWith(`${pattern}/`);
};
var matchPathspecs = (file, specs, prefix) => {
  const parsed = specs.map((raw) => specOf(raw, prefix));
  const include = parsed.filter((spec2) => !spec2.exclude);
  const included = include.length === 0 || include.some((spec2) => matchesOne(file, spec2.pattern));
  return included && !parsed.some((spec2) => spec2.exclude && matchesOne(file, spec2.pattern));
};
var isBroadPathspec = (spec2) => {
  const posixSpec = toPosixPath(spec2);
  return posixSpec === "." || posixSpec === "./" || posixSpec === ":/" || posixSpec === "*" || GLOB.test(posixSpec);
};

// src/git/verdict.ts
var PASS = { kind: "pass" };
var block2 = (rule, subject2 = "") => ({ kind: "block", rule, subject: subject2 });
var snapshot = (op) => ({ kind: "snapshot", op });
var discard = (op, scope2, pathspecs = []) => ({
  kind: "discard",
  op,
  discard: { scope: scope2, pathspecs }
});
var SEVERITY = { pass: 0, snapshot: 1, discard: 2, block: 3 };
var worst = (verdicts) => verdicts.reduce((current, next2) => SEVERITY[next2.kind] > SEVERITY[current.kind] ? next2 : current, PASS);

// src/git/options.ts
var canonical = (name, spec2) => {
  if (spec2.known.includes(name)) return name;
  const matches = spec2.known.filter((option) => option.startsWith(name));
  return matches.length === 1 ? matches[0] ?? name : name;
};
var addValue = (building, name, value) => {
  building.values.set(name, [...building.values.get(name) ?? [], value]);
  building.flags.add(name);
};
var longOption = (building, arg, next2, spec2) => {
  const equals = arg.indexOf("=");
  const name = canonical(equals < 0 ? arg : arg.slice(0, equals), spec2);
  if (equals >= 0) {
    addValue(building, name, arg.slice(equals + 1));
    return 1;
  }
  if (spec2.withValue.includes(name) && next2 !== void 0) {
    addValue(building, name, next2);
    return 2;
  }
  building.flags.add(name);
  return 1;
};
var shortCluster = (building, arg, next2, spec2) => {
  for (let index = 1; index < arg.length; index += 1) {
    const letter = arg.charAt(index);
    const name = `-${letter}`;
    if (spec2.shortWithValue.includes(letter)) {
      const attached = arg.slice(index + 1);
      if (attached !== "") {
        addValue(building, name, attached);
        return 1;
      }
      if (next2 === void 0) {
        building.flags.add(name);
        return 1;
      }
      addValue(building, name, next2);
      return 2;
    }
    building.flags.add(name);
  }
  return 1;
};
var parseOptions = (args, spec2) => {
  const building = { flags: /* @__PURE__ */ new Set(), values: /* @__PURE__ */ new Map(), positionals: [] };
  let index = 0;
  while (index < args.length) {
    const arg = args[index] ?? "";
    const next2 = args[index + 1];
    if (arg === "--") {
      return { ...building, paths: args.slice(index + 1), dashdash: true };
    }
    if (arg.startsWith("--")) index += longOption(building, arg, next2, spec2);
    else if (arg.startsWith("-") && arg.length > 1 && !/^-\d+$/.test(arg)) {
      index += shortCluster(building, arg, next2, spec2);
    } else {
      building.positionals.push(arg);
      index += 1;
    }
  }
  return { ...building, paths: [], dashdash: false };
};
var hasAny = (parsed, ...names) => names.some((name) => parsed.flags.has(name));
var valuesOf = (parsed, ...names) => names.flatMap((name) => parsed.values.get(name) ?? []);
var optionSpec = (known2, withValue = [], shortWithValue = "") => ({
  known: known2,
  withValue,
  shortWithValue
});

// src/git/rules/branch.ts
var BRANCH = optionSpec(
  [
    "--delete",
    "--force",
    "--move",
    "--copy",
    "--remotes",
    "--all",
    "--list",
    "--set-upstream-to",
    "--unset-upstream",
    "--track",
    "--no-track",
    "--contains",
    "--no-contains",
    "--merged",
    "--no-merged",
    "--show-current",
    "--edit-description",
    "--format",
    "--sort",
    "--points-at",
    "--column",
    "--verbose",
    "--quiet",
    "--create-reflog",
    "--ignore-case"
  ],
  ["--set-upstream-to", "--contains", "--no-contains", "--merged", "--no-merged", "--format", "--sort", "--points-at"],
  "u"
);
var REBASE = optionSpec(
  [
    "--continue",
    "--abort",
    "--skip",
    "--quit",
    "--edit-todo",
    "--show-current-patch",
    "--onto",
    "--interactive",
    "--root",
    "--autosquash",
    "--autostash",
    "--exec",
    "--strategy",
    "--strategy-option",
    "--update-refs",
    "--keep-base",
    "--merge",
    "--rebase-merges"
  ],
  ["--onto", "--exec", "--strategy", "--strategy-option"],
  "xsX"
);
var MERGE = optionSpec(
  ["--strategy", "--strategy-option", "--message", "--file", "--into-name", "--abort", "--continue", "--quit"],
  ["--strategy", "--strategy-option", "--message", "--file", "--into-name"],
  "sXmF"
);
var SIDES = /* @__PURE__ */ new Set(["ours", "theirs"]);
var branchVerdict = (invocation, facts) => {
  const parsed = parseOptions(invocation.args, BRANCH);
  if (hasAny(parsed, "--remotes", "-r")) return PASS;
  const forced = hasAny(parsed, "--force", "-f");
  const deleting = hasAny(parsed, "-D") || hasAny(parsed, "--delete", "-d") && forced;
  if (deleting) {
    const unmerged = parsed.positionals.find((name) => !facts.branchContained(name));
    return unmerged === void 0 ? PASS : block2("branch-unmerged", unmerged);
  }
  return hasAny(parsed, "-M", "-C") || forced && parsed.positionals.length > 0 ? snapshot("branch --force") : PASS;
};
var sideOption = (values, strategies) => values.find((value) => SIDES.has(value)) ?? strategies.find((value) => value === "ours");
var mergeSideVerdict = (invocation) => {
  const parsed = parseOptions(invocation.args, MERGE);
  const side = sideOption(valuesOf(parsed, "-X", "--strategy-option"), valuesOf(parsed, "-s", "--strategy"));
  return side === void 0 ? PASS : block2("merge-side", `${invocation.subcommand} ${side}`);
};
var rebaseVerdict = (invocation, facts) => {
  const parsed = parseOptions(invocation.args, REBASE);
  if (hasAny(parsed, "--continue", "--abort", "--skip", "--quit", "--edit-todo", "--show-current-patch")) return PASS;
  const side = sideOption(valuesOf(parsed, "-X", "--strategy-option"), []);
  if (side !== void 0) return block2("merge-side", `rebase -X ${side}`);
  const named = hasAny(parsed, "--root") ? parsed.positionals[0] : parsed.positionals[1];
  const branch = named ?? facts.currentBranch();
  if (branch === void 0) return snapshot("rebase");
  if (facts.isProtected(branch)) return block2("rebase-protected", branch);
  if (facts.sharedBranch(branch)) return block2("rebase-shared", branch);
  return snapshot("rebase");
};

// src/git/rules/discard.ts
var RESET = optionSpec(
  ["--hard", "--soft", "--mixed", "--merge", "--keep", "--quiet", "--patch", "--intent-to-add", "--pathspec-from-file"],
  ["--pathspec-from-file"]
);
var CHECKOUT = optionSpec(
  [
    "--force",
    "--ours",
    "--theirs",
    "--merge",
    "--conflict",
    "--patch",
    "--detach",
    "--orphan",
    "--track",
    "--no-track",
    "--quiet",
    "--progress",
    "--overwrite-ignore",
    "--ignore-other-worktrees",
    "--recurse-submodules",
    "--pathspec-from-file"
  ],
  ["--conflict", "--orphan", "--pathspec-from-file"],
  "bB"
);
var RESTORE = optionSpec(
  [
    "--source",
    "--staged",
    "--worktree",
    "--patch",
    "--ours",
    "--theirs",
    "--merge",
    "--conflict",
    "--overlay",
    "--no-overlay",
    "--quiet",
    "--progress",
    "--ignore-unmerged",
    "--recurse-submodules",
    "--pathspec-from-file"
  ],
  ["--source", "--conflict", "--pathspec-from-file"],
  "s"
);
var SWITCH = optionSpec(
  [
    "--create",
    "--force-create",
    "--detach",
    "--force",
    "--discard-changes",
    "--merge",
    "--conflict",
    "--quiet",
    "--track",
    "--no-track",
    "--orphan",
    "--guess",
    "--no-guess"
  ],
  ["--create", "--force-create", "--conflict", "--orphan"],
  "cC"
);
var CLEAN = optionSpec(["--force", "--dry-run", "--quiet", "--exclude", "--interactive"], ["--exclude"], "e");
var choosesSide = (parsed, paths) => hasAny(parsed, "--ours", "--theirs") && paths.some(isBroadPathspec);
var resetVerdict = (invocation) => {
  const parsed = parseOptions(invocation.args, RESET);
  if (hasAny(parsed, "--hard")) return discard("reset --hard", "tracked");
  if (hasAny(parsed, "--merge")) return discard("reset --merge", "tracked");
  if (hasAny(parsed, "--keep")) return snapshot("reset --keep");
  return PASS;
};
var checkoutPaths = (parsed, facts) => {
  if (parsed.dashdash) return { ref: parsed.positionals.length > 0, paths: parsed.paths };
  const [first, ...rest] = parsed.positionals;
  if (first === void 0) return { ref: false, paths: [] };
  if (facts.isRef(first)) return { ref: true, paths: rest };
  return { ref: false, paths: parsed.positionals };
};
var checkoutVerdict = (invocation, facts) => {
  const parsed = parseOptions(invocation.args, CHECKOUT);
  if (hasAny(parsed, "--patch", "-p")) return PASS;
  const { ref, paths } = checkoutPaths(parsed, facts);
  if (choosesSide(parsed, paths)) return block2("merge-side", `checkout --ours/--theirs ${paths.join(" ")}`);
  if (hasAny(parsed, "--force", "-f")) return discard("checkout -f", "tracked");
  if (paths.length > 0) return discard("checkout -- <paths>", ref ? "all" : "worktree", paths);
  const reset = valuesOf(parsed, "-B");
  if (reset.some((name) => facts.branchExists(name))) return snapshot("checkout -B");
  return PASS;
};
var restoreVerdict = (invocation) => {
  const parsed = parseOptions(invocation.args, RESTORE);
  const staged = hasAny(parsed, "--staged", "-S");
  const worktree = hasAny(parsed, "--worktree", "-W") || !staged;
  if (!worktree || hasAny(parsed, "--patch", "-p")) return PASS;
  const paths = [...parsed.positionals, ...parsed.paths];
  if (choosesSide(parsed, paths)) return block2("merge-side", `restore --ours/--theirs ${paths.join(" ")}`);
  const sourced = hasAny(parsed, "--source", "-s");
  return discard("restore", sourced ? "all" : staged ? "tracked" : "worktree", paths);
};
var switchVerdict = (invocation, facts) => {
  const parsed = parseOptions(invocation.args, SWITCH);
  if (hasAny(parsed, "--discard-changes", "--force", "-f")) return discard("switch --discard-changes", "tracked");
  const reset = valuesOf(parsed, "-C", "--force-create");
  if (reset.some((name) => facts.branchExists(name))) return snapshot("switch -C");
  return PASS;
};
var cleanVerdict = (invocation) => {
  const parsed = parseOptions(invocation.args, CLEAN);
  if (hasAny(parsed, "--dry-run", "-n") && !hasAny(parsed, "--interactive", "-i")) return PASS;
  return block2("clean", ["clean", ...invocation.args].join(" "));
};
var stashVerdict = (invocation) => {
  const action = invocation.args[0] ?? "";
  if (action === "drop" || action === "clear") return block2("stash-drop", `stash ${action}`);
  if (action === "pop" || action === "apply") return snapshot(`stash ${action}`);
  return PASS;
};

// src/git/rules/history.ts
var GC = optionSpec(["--prune", "--no-prune", "--aggressive", "--auto", "--quiet", "--force", "--keep-largest-pack"]);
var UPDATE_REF = optionSpec(
  ["--delete", "--stdin", "--no-deref", "--create-reflog", "--message"],
  ["--message"],
  "m"
);
var PRUNE = optionSpec(["--dry-run", "--verbose", "--progress", "--expire"], ["--expire"]);
var IMMEDIATE = /* @__PURE__ */ new Set(["now", "all"]);
var subject = (invocation) => [invocation.subcommand, ...invocation.args].join(" ");
var reflogVerdict = (invocation) => {
  const action = invocation.args[0] ?? "";
  return action === "expire" || action === "delete" ? block2("history", subject(invocation)) : PASS;
};
var gcVerdict = (invocation) => {
  const prune2 = valuesOf(parseOptions(invocation.args, GC), "--prune");
  return prune2.some((value) => IMMEDIATE.has(value)) ? block2("history", subject(invocation)) : PASS;
};
var updateRefVerdict = (invocation) => hasAny(parseOptions(invocation.args, UPDATE_REF), "-d", "--delete", "--stdin") ? block2("history", subject(invocation)) : PASS;
var pruneVerdict = (invocation) => hasAny(parseOptions(invocation.args, PRUNE), "-n", "--dry-run") ? PASS : block2("history", subject(invocation));
var replaceVerdict = (invocation) => {
  const listing2 = invocation.args.length === 0 || invocation.args.some((arg) => arg === "-l" || arg === "--list");
  return listing2 ? PASS : block2("history", subject(invocation));
};
var HISTORY_RULES = {
  reflog: reflogVerdict,
  gc: gcVerdict,
  "update-ref": updateRefVerdict,
  prune: pruneVerdict,
  replace: replaceVerdict,
  "filter-branch": (invocation) => block2("history", subject(invocation)),
  "filter-repo": (invocation) => block2("history", subject(invocation))
};

// src/git/rules/push.ts
var PUSH_OPTIONS = optionSpec(
  [
    "--force",
    "--force-with-lease",
    "--no-force-with-lease",
    "--force-if-includes",
    "--no-force-if-includes",
    "--mirror",
    "--delete",
    "--prune",
    "--all",
    "--branches",
    "--tags",
    "--follow-tags",
    "--set-upstream",
    "--dry-run",
    "--porcelain",
    "--verbose",
    "--quiet",
    "--progress",
    "--no-verify",
    "--verify",
    "--atomic",
    "--signed",
    "--push-option",
    "--repo",
    "--receive-pack",
    "--exec",
    "--recurse-submodules"
  ],
  ["--push-option", "--repo", "--receive-pack", "--exec"],
  "o"
);
var branchName = (ref) => {
  if (ref.startsWith("refs/tags/")) return void 0;
  return ref.replace(/^refs\/heads\//, "");
};
var refspecTarget = (refspec, current) => {
  const plain = refspec.replace(/^\+/, "");
  const colon = plain.indexOf(":");
  const destination = colon < 0 ? plain : plain.slice(colon + 1);
  if (destination === "HEAD" || colon < 0 && plain === "HEAD") return current;
  if (destination === "" || destination.startsWith("refs/tags/")) return void 0;
  return branchName(destination);
};
var pushDestinations = (parsed, facts) => {
  if (hasAny(parsed, "--all", "--branches", "--mirror")) return "all";
  const refspecs = parsed.positionals.slice(1).filter((refspec) => refspec !== ":");
  const current = facts.currentBranch();
  if (refspecs.length === 0) {
    if (hasAny(parsed, "--tags") || current === void 0) return [];
    return [facts.upstream(current)?.branch ?? current];
  }
  return refspecs.flatMap((refspec) => {
    const target = refspecTarget(refspec, current);
    return target === void 0 ? [] : [target];
  });
};
var leaseVerdict = (parsed, facts) => {
  const leases = valuesOf(parsed, "--force-with-lease");
  const explicit = leases.length > 0 && leases.every((lease) => /^[^:]+:.+$/.test(lease));
  if (!explicit || !hasAny(parsed, "--force-if-includes")) return block2("force-push", "--force-with-lease");
  const current = facts.currentBranch();
  const leased = leases.map((lease) => branchName(lease.slice(0, lease.indexOf(":"))));
  const destinations = pushDestinations(parsed, facts);
  const own = current !== void 0 && !facts.isProtected(current) && leased.every((name) => name === current) && destinations !== "all" && destinations.every((name) => name === current);
  return own ? PASS : block2("lease-not-own", leased.join(", "));
};
var pushVerdict = (invocation, facts) => {
  const parsed = parseOptions(invocation.args, PUSH_OPTIONS);
  if (hasAny(parsed, "--mirror")) return block2("push-mirror");
  const refspecs = parsed.positionals.slice(1);
  const deleted = refspecs.find((refspec) => /^\+?:./.test(refspec));
  if (hasAny(parsed, "--delete", "-d", "--prune") || deleted !== void 0) {
    return block2("push-delete", deleted?.replace(/^\+?:/, "") ?? refspecs.join(" "));
  }
  const forced = refspecs.find((refspec) => refspec.startsWith("+"));
  if (hasAny(parsed, "--force", "-f") || forced !== void 0) return block2("force-push", forced ?? "--force");
  if (hasAny(parsed, "--force-with-lease")) return leaseVerdict(parsed, facts);
  return PASS;
};

// src/git/rules/protected.ts
var COMMITS_ON_CURRENT = /* @__PURE__ */ new Set(["commit", "merge", "cherry-pick", "revert", "am", "rebase"]);
var LEAVES = /* @__PURE__ */ new Set(["--abort", "--quit", "--skip", "--dry-run", "--show-current-patch"]);
var commitVerdict = (invocation, facts) => {
  if (invocation.args.some((arg) => LEAVES.has(arg))) return PASS;
  if (invocation.subcommand === "rebase") return PASS;
  const current = facts.currentBranch();
  return current !== void 0 && facts.isProtected(current) ? block2("protected-commit", current) : PASS;
};
var pushVerdict2 = (invocation, facts) => {
  const parsed = parseOptions(invocation.args, PUSH_OPTIONS);
  if (hasAny(parsed, "--dry-run", "-n")) return PASS;
  const destinations = pushDestinations(parsed, facts);
  if (destinations === "all") return block2("protected-push", facts.defaultBranch());
  const hit2 = destinations.find((name) => facts.isProtected(name));
  return hit2 === void 0 ? PASS : block2("protected-push", hit2);
};
var protectedVerdict = (invocation, facts) => {
  if (invocation.subcommand === "push") return pushVerdict2(invocation, facts);
  if (COMMITS_ON_CURRENT.has(invocation.subcommand)) return commitVerdict(invocation, facts);
  return PASS;
};

// src/git/rules/worktree.ts
var WORKTREE = optionSpec(["--force", "--detach", "--checkout", "--lock", "--reason", "--quiet"], ["--reason"], "b");
var worktreeVerdict = (invocation) => {
  const [action, ...rest] = invocation.args;
  if (action !== "remove") return PASS;
  const parsed = parseOptions(rest, WORKTREE);
  return hasAny(parsed, "--force", "-f") ? block2("worktree-force", parsed.positionals.join(" ")) : PASS;
};

// src/git/rules/index.ts
var RULES3 = {
  push: pushVerdict,
  reset: resetVerdict,
  checkout: checkoutVerdict,
  restore: restoreVerdict,
  switch: switchVerdict,
  clean: cleanVerdict,
  stash: stashVerdict,
  branch: branchVerdict,
  worktree: worktreeVerdict,
  rebase: rebaseVerdict,
  merge: mergeSideVerdict,
  pull: mergeSideVerdict,
  "cherry-pick": mergeSideVerdict,
  revert: mergeSideVerdict,
  ...HISTORY_RULES
};
var BUILTIN_SUBCOMMANDS = /* @__PURE__ */ new Set([
  ...Object.keys(RULES3),
  "add",
  "am",
  "bisect",
  "blame",
  "cat-file",
  "commit",
  "config",
  "describe",
  "diff",
  "fetch",
  "grep",
  "init",
  "log",
  "ls-files",
  "ls-remote",
  "merge-base",
  "mv",
  "remote",
  "rev-list",
  "rev-parse",
  "rm",
  "show",
  "status",
  "tag"
]);
var gitVerdict = (invocation, facts) => {
  const rule = RULES3[invocation.subcommand];
  const destructive = rule === void 0 ? PASS : rule(invocation, facts);
  if (destructive.kind === "block") return destructive;
  return worst([destructive, protectedVerdict(invocation, facts)]);
};

// src/git/switch-target.ts
var CREATES = /* @__PURE__ */ new Set(["-c", "-C", "-b", "-B", "--create", "--force-create", "--orphan"]);
var operands = (args) => {
  if (args.includes("--")) return void 0;
  return args.filter((arg) => !arg.startsWith("-"));
};
var switchTarget = (invocation, facts) => {
  if (invocation.subcommand !== "switch" && invocation.subcommand !== "checkout") return void 0;
  const created3 = invocation.args.findIndex((arg) => CREATES.has(arg));
  if (created3 >= 0) return invocation.args[created3 + 1];
  const names = operands(invocation.args);
  const [name] = names ?? [];
  if (names?.length !== 1 || name === void 0) return void 0;
  return invocation.subcommand === "switch" || facts.branchExists(name) ? name : void 0;
};

// src/git/guard.ts
var MAX_ALIAS_DEPTH = 3;
var expandAlias = (runtime, repo, invocation, depth = 0) => {
  if (depth >= MAX_ALIAS_DEPTH || BUILTIN_SUBCOMMANDS.has(invocation.subcommand) || invocation.subcommand === "")
    return invocation;
  const inline3 = invocation.config[`alias.${invocation.subcommand.toLowerCase()}`];
  const configured = inline3 ?? runtime.git(["config", "--get", `alias.${invocation.subcommand}`], repo.root).stdout.trim();
  if (configured === "" || configured.startsWith("!")) return invocation;
  const words = normalizeCommand(`git ${configured}`).commands[0]?.args ?? [];
  return expandAlias(runtime, repo, withAlias(invocation, words), depth + 1);
};
var targetsOf2 = (entries, spec2, prefix) => entries.filter((entry2) => {
  if (spec2.scope === "tracked") return entry2.kind !== "untracked";
  if (spec2.scope === "worktree") return entry2.kind !== "untracked" && entry2.unstaged;
  return true;
}).filter((entry2) => spec2.pathspecs.length === 0 || matchPathspecs(entry2.path, spec2.pathspecs, prefix)).map((entry2) => entry2.path);
var shellAliasCommands = (invocation, runtime, repo) => {
  const configured = invocation.config[`alias.${invocation.subcommand.toLowerCase()}`] ?? runtime.git(["config", "--get", `alias.${invocation.subcommand}`], repo.root).stdout.trim();
  return configured.startsWith("!") ? normalizeCommand(configured.slice(1)).commands : [];
};
var withChain = (facts, chain) => {
  const branch = chain?.branch;
  return branch === void 0 ? facts : { ...facts, currentBranch: () => branch };
};
var decide = (context, repo, verdict, facts, text6) => {
  switch (verdict.kind) {
    case "pass":
      return { kind: "pass" };
    case "block":
      return { kind: "block", rule: verdict.rule, subject: verdict.subject, command: text6 };
    case "snapshot":
      return { kind: "snapshot", repo, op: verdict.op, command: text6 };
    case "discard": {
      const entries = facts.dirty();
      if (entries === void 0) return { kind: "unknown", command: text6 };
      const foreign = foreignFiles(
        context.runtime,
        repo,
        context.owner,
        targetsOf2(entries, verdict.discard, facts.prefix)
      );
      return foreign.length > 0 ? { kind: "foreign", files: foreign, command: text6 } : { kind: "snapshot", repo, op: verdict.op, command: text6 };
    }
  }
};
var guardGitCommand = (context, command, depth = 0) => {
  const invocation = gitInvocation(command);
  if (invocation === void 0) return [];
  const dir = resolveFrom(context.cwd, command.dir, ...invocation.dirs);
  const repo = openRepo(context.runtime, toAbsolutePath(dir));
  if (repo === void 0) return [];
  const facts = withChain(context.facts?.(repo) ?? repoFacts(context.runtime, repo), context.chain);
  const expanded = expandAlias(context.runtime, repo, invocation);
  const target = switchTarget(expanded, facts);
  if (target !== void 0 && context.chain !== void 0) context.chain.branch = target;
  const nested = depth < MAX_ALIAS_DEPTH ? shellAliasCommands(expanded, context.runtime, repo).flatMap(
    (inner) => guardGitCommand(context, inner, depth + 1)
  ) : [];
  return [...nested, decide(context, repo, gitVerdict(expanded, facts), facts, commandText(command))];
};

// src/git/rm-guard.ts
var RECURSIVE_SHORT = /^-[A-Za-z]*[rR][A-Za-z]*$/;
var PS_RECURSE = /^-r(?:e(?:c(?:u(?:r(?:s(?:e)?)?)?)?)?)?$/i;
var PS_VALUE_PARAMS = ["filter", "include", "exclude", "credential", "stream"];
var GLOB2 = /[*?[]/;
var posixTargets = (command) => {
  const dashdash = command.args.indexOf("--");
  const options = dashdash < 0 ? command.args : command.args.slice(0, dashdash);
  const recursive = options.some((arg) => RECURSIVE_SHORT.test(arg) || arg === "--recursive");
  if (!recursive) return void 0;
  const operands2 = options.filter((arg) => !arg.startsWith("-"));
  return dashdash < 0 ? operands2 : [...operands2, ...command.args.slice(dashdash + 1)];
};
var takesValue = (previous) => {
  const name = previous.startsWith("-") ? previous.slice(1).toLowerCase() : "";
  return name.length >= 2 && PS_VALUE_PARAMS.some((param) => param.startsWith(name));
};
var powershellTargets = (command) => {
  const recursive = command.args.some((arg) => PS_RECURSE.test(arg) || /^\/s$/i.test(arg));
  if (!recursive) return void 0;
  return command.args.flatMap((arg, index) => {
    if (arg.startsWith("-") || /^\/[a-z]$/i.test(arg)) return [];
    return takesValue(command.args[index - 1] ?? "") ? [] : arg.split(",");
  });
};
var removalTargets = (command) => {
  if (command.program === "rm") return posixTargets(command);
  if (command.program === "remove-item") return powershellTargets(command);
  return void 0;
};
var globBase = (target) => {
  const at = target.search(GLOB2);
  if (at < 0) return target;
  const slash = target.lastIndexOf("/", at);
  return slash < 0 ? "." : target.slice(0, slash) || "/";
};
var containsGitDir = (runtime, path) => runtime.stat(toAbsolutePath(resolveFrom(path, ".git"))) !== void 0;
var targetVerdict = (runtime, context, command, raw) => {
  if (raw.startsWith("$") || raw.startsWith("~") || raw.startsWith("%")) {
    return /^~\/*\*?$/.test(raw) || /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?\//.test(raw) ? block2("rm-root", raw) : PASS;
  }
  if (/(?:^|\/)\.git\/?$/.test(raw.replace(/\\/g, "/"))) return block2("rm-worktree", raw);
  const glob = GLOB2.test(raw);
  const path = resolveFrom(context.cwd, command.dir, glob ? globBase(raw) : raw);
  const real = runtime.realpath(path);
  if (isRootLike(real, context.home) || isRootLike(path, context.home)) return block2("rm-root", raw);
  const worktree = context.worktrees().find((tree) => isWithin(tree, real) || isWithin(tree, path));
  if (worktree !== void 0) return block2("rm-worktree", raw);
  if (!glob && containsGitDir(runtime, real)) return block2("rm-worktree", raw);
  return PASS;
};
var rmVerdict = (runtime, context, command) => {
  const targets2 = removalTargets(command);
  if (targets2 === void 0) return PASS;
  for (const target of targets2) {
    const verdict = targetVerdict(runtime, context, command, target);
    if (verdict.kind === "block") return verdict;
  }
  return PASS;
};
var listWorktrees = (runtime, cwd) => {
  const listed3 = runtime.git(["worktree", "list", "--porcelain"], toAbsolutePath(cwd));
  if (!listed3.ok) return [];
  return listed3.stdout.split("\n").filter((line2) => line2.startsWith("worktree ")).map((line2) => pathKey(line2.slice("worktree ".length)));
};

// src/git/hooks/context.ts
var SHELL_TOOLS2 = /* @__PURE__ */ new Set(["Bash", "PowerShell"]);
var ownerOf2 = (payload) => ownerKey(optionalString(payload.raw, "agent_id") ?? payload.sessionId);
var shellText = (payload) => {
  if (!SHELL_TOOLS2.has(toolName2(payload))) return void 0;
  const command = optionalString(toolInput2(payload), "command") ?? "";
  return command.trim() === "" ? void 0 : command;
};

// src/git/hooks/messages.ts
var RULE_KEYS = {
  "force-push": "git.block.force_push",
  "lease-not-own": "git.block.lease_not_own",
  "push-delete": "git.block.push_delete",
  "push-mirror": "git.block.push_mirror",
  clean: "git.block.clean",
  "stash-drop": "git.block.stash_drop",
  "branch-unmerged": "git.block.branch_unmerged",
  "worktree-force": "git.block.worktree_force",
  "rm-worktree": "git.block.rm_worktree",
  "rm-root": "git.block.rm_root",
  "rebase-protected": "git.block.rebase_protected",
  "rebase-shared": "git.block.rebase_shared",
  "merge-side": "git.block.merge_side",
  history: "git.block.history",
  "protected-commit": "git.block.protected_commit",
  "protected-push": "git.block.protected_push"
};
var MAX_FILES2 = 8;
var ruleMessage = (t, rule, command, subject2) => t(RULE_KEYS[rule], { command, subject: subject2 === "" ? command : subject2 });
var fileList = (items) => {
  const head = items.slice(0, MAX_FILES2).join(", ");
  return items.length > MAX_FILES2 ? `${head} (+${String(items.length - MAX_FILES2)})` : head;
};
var foreignLabel = (t, file) => t(file.reason === "before-session" ? "git.foreign.before" : "git.foreign.other", { path: file.path });
var outcomeMessage = (t, outcome) => {
  switch (outcome.kind) {
    case "block":
      return ruleMessage(t, outcome.rule, outcome.command, outcome.subject);
    case "foreign":
      return t("git.block.foreign", {
        command: outcome.command,
        files: fileList(outcome.files.map((file) => foreignLabel(t, file)))
      });
    case "unknown":
      return t("git.block.unknown", { command: outcome.command });
    case "pass":
    case "snapshot":
      return void 0;
  }
};

// src/git/hooks/pre-tool.ts
var ALLOW = { kind: "allow" };
var rmOutcome = (input, command, worktrees) => {
  if (removalTargets(command) === void 0) return void 0;
  const verdict = rmVerdict(input.runtime, { cwd: input.cwd, home: input.runtime.homeDir(), worktrees }, command);
  return verdict.kind === "block" ? ruleMessage(input.t, verdict.rule, commandText(command), verdict.subject) : void 0;
};
var snapshotsOf = (input, owner, pending) => {
  const done = /* @__PURE__ */ new Map();
  for (const item of pending) {
    if (done.has(item.repo.root)) continue;
    const taken = takeSnapshot(input.runtime, item.repo, { op: item.op, owner, command: item.command });
    if (!taken.ok) {
      return {
        kind: "block",
        reason: input.t("git.block.snapshot_failed", { command: item.command, detail: taken.error })
      };
    }
    done.set(item.repo.root, input.t("git.snapshot.context", { command: item.command, ref: taken.value.ref }));
  }
  if (done.size === 0) return ALLOW;
  const context = [...done.values()].join("\n");
  return { kind: "allow", output: { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: context } } };
};
var review = (input, commands, owner) => {
  const worktrees = memo2(() => listWorktrees(input.runtime, input.cwd));
  const repo = memo2(() => openRepo(input.runtime, input.cwd));
  const prod = memo2(() => prodGuard(input.runtime, repo()?.root ?? input.cwd, input.t));
  const snapshots = [];
  const reads = [];
  const chain = { branch: void 0 };
  for (const command of commands) {
    const removal = rmOutcome(input, command, worktrees);
    if (removal !== void 0) return { blocked: removal, snapshots, reads };
    const decision = PROD_PROGRAMS.has(command.program) ? prod().decide(command) : void 0;
    if (decision?.kind === "block") return { blocked: decision.reason, snapshots, reads };
    if (decision !== void 0) reads.push(decision);
    for (const outcome of guardGitCommand({ runtime: input.runtime, cwd: input.cwd, owner, chain }, command)) {
      const message = outcomeMessage(input.t, outcome);
      if (message !== void 0) return { blocked: message, snapshots, reads };
      if (outcome.kind === "snapshot") snapshots.push(outcome);
    }
  }
  return { blocked: void 0, snapshots, reads };
};
var gitPreToolUse = (input) => {
  const text6 = shellText(input.payload);
  if (text6 === void 0) return ALLOW;
  const commands = normalizeCommand(text6, dialectOf(toolName2(input.payload))).commands;
  if (commands.length === 0) return ALLOW;
  const owner = ownerOf2(input.payload);
  const result = review(input, commands, owner);
  if (result.blocked !== void 0) return { kind: "block", reason: result.blocked };
  if (result.reads.length > 0) {
    recordEvidence(
      input.runtime,
      openRepo(input.runtime, input.cwd)?.root ?? toAbsolutePath(input.cwd),
      owner,
      result.reads
    );
  }
  return snapshotsOf(input, owner, result.snapshots);
};

// src/git/hooks/session.ts
import { dirname as dirname5, relative as relative5 } from "node:path";
var ALLOW2 = { kind: "allow" };
var EDIT_TOOLS = /* @__PURE__ */ new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
var gitSessionStart = (input) => {
  const repo = openRepo(input.runtime, input.cwd);
  if (repo !== void 0) recordBaseline(input.runtime, repo, ownerOf2(input.payload));
  return ALLOW2;
};
var editedPath = (input) => {
  const inputs = toolInput2(input.payload);
  const raw = optionalString(inputs, "file_path") ?? optionalString(inputs, "notebook_path");
  if (raw === void 0 || raw === "") return void 0;
  const file = toAbsolutePath(raw, input.cwd);
  const repo = openRepo(input.runtime, toAbsolutePath(dirname5(file))) ?? openRepo(input.runtime, input.cwd);
  if (repo === void 0) return void 0;
  const path = toPosixPath(relative5(input.runtime.realpath(repo.root), input.runtime.realpath(file)));
  return path === "" || path.startsWith("..") || path.startsWith(STATE_PREFIX) ? void 0 : { repo, path };
};
var gitPostToolUse = (input) => {
  const tool = toolName2(input.payload);
  if (EDIT_TOOLS.has(tool)) {
    const edited = editedPath(input);
    if (edited !== void 0) recordEdits(input.runtime, edited.repo, ownerOf2(input.payload), [edited.path]);
    return ALLOW2;
  }
  if (!SHELL_TOOLS2.has(tool)) return ALLOW2;
  const repo = openRepo(input.runtime, input.cwd);
  if (repo !== void 0) recordShellChanges(input.runtime, repo, ownerOf2(input.payload));
  return ALLOW2;
};

// src/git/hooks/index.ts
var GIT_HANDLERS = {
  SessionStart: [gitSessionStart],
  SubagentStart: [gitSessionStart],
  PreToolUse: [gitPreToolUse],
  PostToolUse: [gitPostToolUse]
};

// src/secrets/guards/describe.ts
var MAX_LISTED6 = 5;
var describeFindings = (t, items) => {
  const listed3 = items.slice(0, MAX_LISTED6).map(({ ruleId, where }) => t("secrets.found_item", { rule: ruleId, where }));
  const rest = items.length - listed3.length;
  return rest > 0 ? `${listed3.join("; ")}; ${t("secrets.found_more", { count: rest })}` : listed3.join("; ");
};
var lineWhere = (t, finding2) => t("secrets.where.line", { line: finding2.line, column: finding2.column });

// src/secrets/guards/exposure.ts
var HOOK_ACTOR = "finitemonkey";
var liveFindings = (input, texts) => {
  const baseline = loadBaseline(input.runtime, input.cwd);
  const accepted2 = acceptedFingerprints(baseline.ok ? baseline.value : EMPTY_BASELINE, input.runtime.now());
  return texts.flatMap((text6) => scanText(text6, { rules: CREDENTIAL_RULES })).filter((finding2) => !accepted2.has(finding2.fingerprint));
};
var record = (input, findings, draft, where) => {
  const ids2 = findings.map((finding2) => {
    const saved = recordIncident(
      input.runtime,
      input.cwd,
      { ...draft, rule: finding2.ruleId, fingerprint: finding2.fingerprint, where: `${where}:${String(finding2.line)}` },
      HOOK_ACTOR
    );
    return saved.ok ? saved.value.id : input.t("secrets.incident.unsaved", { detail: saved.error });
  });
  return [...new Set(ids2)].join(", ");
};
var secretsUserPromptSubmit = (input) => {
  const prompt = optionalString(input.payload.raw, "prompt") ?? "";
  const findings = liveFindings(input, [prompt]);
  if (findings.length === 0) return { kind: "allow" };
  const incident = record(input, findings, { source: "prompt", state: "exposicao-local" }, "prompt");
  const items = findings.map((finding2) => ({ ruleId: finding2.ruleId, where: lineWhere(input.t, finding2) }));
  return {
    kind: "block",
    reason: input.t("secrets.block.prompt", { found: describeFindings(input.t, items), incident })
  };
};
var secretsPostToolUse = (input) => {
  const findings = liveFindings(input, stringLeaves(input.payload.raw["tool_response"]));
  if (findings.length === 0) return { kind: "allow" };
  const tool = toolName2(input.payload) || "tool";
  const incident = record(input, findings, { source: "tool-output", state: "aberto" }, `tool-output:${tool}`);
  const items = findings.map((finding2) => ({ ruleId: finding2.ruleId, where: lineWhere(input.t, finding2) }));
  const context = input.t("secrets.post.context", { tool, found: describeFindings(input.t, items), incident });
  return {
    kind: "allow",
    output: { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: context } }
  };
};

// src/secrets/guards/pre-tool.ts
import { relative as relative6 } from "node:path";

// src/secrets/guards/bash-rules.ts
var READERS = /* @__PURE__ */ new Set([
  "cat",
  "bat",
  "batcat",
  "less",
  "more",
  "head",
  "tail",
  "nl",
  "tac",
  "strings",
  "xxd",
  "hexdump",
  "od",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "ag",
  "ack",
  "awk",
  "gawk",
  "sed",
  "cut",
  "sort",
  "uniq",
  "jq",
  "yq",
  "base64",
  "type",
  "get-content",
  "gc",
  "select-string",
  "sls",
  "diff",
  "vim",
  "vi",
  "nano",
  "view",
  "dotenv"
]);
var SECRET_NAME = /(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PASS|PWD|CREDENTIAL)/i;
var PERSON_ONLY = /\b(?:finitemonkey|fm)(?:\.mjs)?\s+secrets\s+(?:accept\b|incident\s+(?:rotated|close)\b)/;
var LISTS_ENV = /* @__PURE__ */ new Set(["get-childitem", "gci", "dir", "ls"]);
var onlyFlags = (args) => args.every((arg) => arg.startsWith("-"));
var readTarget = (segment) => {
  const redirected = segment.redirectedFrom.find(isSensitivePath);
  if (redirected !== void 0) return redirected;
  const program = segment.program.toLowerCase();
  if (!READERS.has(program)) return void 0;
  if (program === "sed" && segment.args.some((arg) => arg.startsWith("-i"))) return void 0;
  return segment.args.find((arg) => !arg.startsWith("-") && isSensitivePath(arg));
};
var dumpsEnv = (segment) => {
  const program = segment.program.toLowerCase();
  if (program === "env" || program === "printenv") {
    if (onlyFlags(segment.args)) return true;
    return program === "printenv" && segment.args.some((arg) => SECRET_NAME.test(arg));
  }
  if (program === "set" || program === "export" || program === "declare") {
    return segment.args.length === 0 || segment.args.every((arg) => arg === "-p" || arg === "-x");
  }
  return LISTS_ENV.has(program) && segment.args.some((arg) => /^env:/i.test(arg));
};
var bashFindings = (command, segments) => {
  const person = PERSON_ONLY.exec(command);
  if (person !== null) return [{ kind: "person-only", command: person[0] }];
  return segments.flatMap((segment) => {
    const target = readTarget(segment);
    if (target !== void 0) return [{ kind: "read", target }];
    if (dumpsEnv(segment)) return [{ kind: "env-dump", command: [segment.program, ...segment.args].join(" ") }];
    return [];
  });
};
var GIT_GLOBALS_WITH_VALUE = /* @__PURE__ */ new Set(["-C", "-c", "--git-dir", "--work-tree"]);
var commitIntent = (segments) => {
  for (const segment of segments) {
    if (segment.program !== "git") continue;
    let index = 0;
    while (index < segment.args.length && (segment.args[index] ?? "").startsWith("-")) {
      index += GIT_GLOBALS_WITH_VALUE.has(segment.args[index] ?? "") ? 2 : 1;
    }
    if (segment.args[index] !== "commit") continue;
    const flags = segment.args.slice(index + 1);
    const all = flags.some((flag2) => flag2 === "--all" || /^-[A-Za-z]*a[A-Za-z]*$/.test(flag2));
    return { includeUnstaged: all };
  }
  return void 0;
};

// src/secrets/guards/shell.ts
var SEPARATORS2 = /\|\||&&|[|;&\n]/;
var TOKEN = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
var ASSIGNMENT4 = /^[A-Za-z_][A-Za-z0-9_]*=/;
var OUTPUT_REDIRECT = /^(?:\d|&)?>{1,2}\|?$/;
var OUTPUT_ATTACHED = /^(?:\d|&)?>{1,2}\|?\S/;
var WRAPPERS3 = /* @__PURE__ */ new Set(["sudo", "command", "exec", "time", "nice", "nohup", "builtin"]);
var tokensOf = (text6) => Array.from(text6.matchAll(TOKEN), (match) => match[1] ?? match[2] ?? match[3] ?? "");
var splitRedirects = (tokens) => {
  const words = [];
  const inputs = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (OUTPUT_REDIRECT.test(token)) {
      index += 1;
    } else if (OUTPUT_ATTACHED.test(token)) {
      continue;
    } else if (token === "<") {
      inputs.push(tokens[index + 1] ?? "");
      index += 1;
    } else if (token.startsWith("<") && !token.startsWith("<<")) {
      inputs.push(token.slice(1));
    } else {
      words.push(token);
    }
  }
  return { words, inputs };
};
var segmentOf = (text6) => {
  const { words, inputs } = splitRedirects(tokensOf(text6));
  let index = 0;
  while (index < words.length && (ASSIGNMENT4.test(words[index] ?? "") || WRAPPERS3.has(words[index] ?? ""))) index += 1;
  const program = words[index];
  if (program === void 0) return inputs.length > 0 ? { program: "", args: [], redirectedFrom: inputs } : void 0;
  return { program: program.split(/[\\/]/).pop() ?? program, args: words.slice(index + 1), redirectedFrom: inputs };
};
var segmentsOf = (command) => command.split(SEPARATORS2).flatMap((part2) => {
  const segment = segmentOf(part2);
  return segment === void 0 ? [] : [segment];
});

// src/secrets/guards/pre-tool.ts
var ALLOW3 = { kind: "allow" };
var relativeFile = (cwd, file) => {
  if (file === "") return file;
  const rel = relative6(cwd, file).split("\\").join("/");
  return rel.startsWith("..") || rel === "" ? file : rel;
};
var writeDecision = (input, tool) => {
  const { t } = input;
  for (const written of writtenTexts(tool, toolInput2(input.payload))) {
    const file = relativeFile(input.cwd, written.file);
    const found = scanText(written.text, { path: file });
    if (found.length === 0) continue;
    const items = found.map((finding2) => ({
      ruleId: finding2.ruleId,
      where: written.whole ? t("secrets.where.file", { file, line: finding2.line, column: finding2.column }) : t("secrets.where.new_text", { file, line: finding2.line })
    }));
    return { kind: "block", reason: t("secrets.block.write", { file, found: describeFindings(t, items) }) };
  }
  return ALLOW3;
};
var bashMessage = (t, finding2) => {
  switch (finding2.kind) {
    case "read":
      return t("secrets.block.read", { target: finding2.target });
    case "env-dump":
      return t("secrets.block.env_dump", { command: finding2.command });
    case "person-only":
      return t("secrets.block.person_only", { command: finding2.command });
  }
};
var commitDecision = (input, includeUnstaged) => {
  const staged = scanStaged(input.runtime, input.cwd, includeUnstaged);
  if (!staged.ok || staged.value.length === 0) return ALLOW3;
  const items = staged.value.map((finding2) => ({
    ruleId: finding2.ruleId,
    where: input.t("secrets.where.file", { file: finding2.file, line: finding2.line, column: finding2.column })
  }));
  return { kind: "block", reason: input.t("secrets.block.commit", { found: describeFindings(input.t, items) }) };
};
var bashDecision = (input) => {
  const command = optionalString(toolInput2(input.payload), "command") ?? "";
  if (command === "") return ALLOW3;
  const segments = segmentsOf(command);
  const [first] = bashFindings(command, segments);
  if (first !== void 0) return { kind: "block", reason: bashMessage(input.t, first) };
  const found = scanText(command);
  if (found.length > 0) {
    const items = found.map((finding2) => ({ ruleId: finding2.ruleId, where: lineWhere(input.t, finding2) }));
    return { kind: "block", reason: input.t("secrets.block.bash", { found: describeFindings(input.t, items) }) };
  }
  const commit2 = commitIntent(segments);
  return commit2 === void 0 ? ALLOW3 : commitDecision(input, commit2.includeUnstaged);
};
var readDecision = (input) => {
  const inputs = toolInput2(input.payload);
  const target = optionalString(inputs, "file_path") ?? optionalString(inputs, "path") ?? "";
  if (target === "" || !isSensitivePath(target)) return ALLOW3;
  return { kind: "block", reason: input.t("secrets.block.read", { target: relativeFile(input.cwd, target) }) };
};
var WRITERS2 = /* @__PURE__ */ new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
var SHELLS3 = /* @__PURE__ */ new Set(["Bash", "PowerShell"]);
var READS = /* @__PURE__ */ new Set(["Read", "Grep"]);
var secretsPreToolUse = (input) => {
  const tool = toolName2(input.payload);
  if (WRITERS2.has(tool)) return writeDecision(input, tool);
  if (SHELLS3.has(tool)) return bashDecision(input);
  if (READS.has(tool)) return readDecision(input);
  return ALLOW3;
};

// src/hooks/handlers.ts
var allow = () => ({ kind: "allow" });
var DECISION_RANK = { allow: 0, defer: 0, ask: 1, deny: 2 };
var joinText = (left, right) => {
  if (typeof left !== "string" || left === "") return right;
  if (typeof right !== "string" || right === "") return left;
  return `${left}
${right}`;
};
var mergeSpecific = (left, right) => {
  if (!isRecord(left)) return right;
  if (!isRecord(right)) return left;
  const merged = { ...left, ...right };
  merged["additionalContext"] = joinText(left["additionalContext"], right["additionalContext"]);
  const leftRank = DECISION_RANK[String(left["permissionDecision"])] ?? -1;
  const rightRank = DECISION_RANK[String(right["permissionDecision"])] ?? -1;
  if (leftRank > rightRank) {
    merged["permissionDecision"] = left["permissionDecision"];
    merged["permissionDecisionReason"] = left["permissionDecisionReason"];
  }
  return Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== void 0));
};
var mergeOutputs = (left, right) => {
  if (right === void 0) return left;
  const merged = { ...left, ...right };
  const systemMessage = joinText(left["systemMessage"], right["systemMessage"]);
  if (systemMessage !== void 0) merged["systemMessage"] = systemMessage;
  const specific = mergeSpecific(left["hookSpecificOutput"], right["hookSpecificOutput"]);
  if (specific !== void 0) merged["hookSpecificOutput"] = specific;
  return merged;
};
var composeDecisions = async (input, handlers) => {
  let output = {};
  for (const handler of handlers) {
    const decision = await handler(input);
    if (decision.kind === "block") return decision;
    output = mergeOutputs(output, decision.output);
  }
  return { kind: "allow", output };
};
var mergeHandlers = (...sets) => {
  const merged = {};
  for (const set of sets) {
    for (const event of HOOK_EVENTS) {
      const list4 = set[event];
      if (list4 !== void 0) merged[event] = [...merged[event] ?? [], ...list4];
    }
  }
  return merged;
};
var SECRETS_HANDLERS = {
  PreToolUse: [secretsPreToolUse],
  UserPromptSubmit: [secretsUserPromptSubmit],
  PostToolUse: [secretsPostToolUse]
};
var DEFAULT_HANDLERS = mergeHandlers(SECRETS_HANDLERS, PORTAO_HANDLERS, GIT_HANDLERS);

// src/hooks/payload.ts
var EMPTY_PAYLOAD = {
  hookEventName: void 0,
  sessionId: void 0,
  cwd: void 0,
  stopHookActive: false,
  raw: {}
};
var parseHookPayload = (event, text6, interactive) => {
  if (interactive && text6.trim() === "") return accept(EMPTY_PAYLOAD);
  const parsed = parseJsonObject(text6);
  if (!parsed.ok) return reject(`stdin: ${parsed.error}`);
  const payload = {
    hookEventName: optionalString(parsed.value, "hook_event_name"),
    sessionId: optionalString(parsed.value, "session_id"),
    cwd: optionalString(parsed.value, "cwd"),
    stopHookActive: parsed.value["stop_hook_active"] === true,
    raw: parsed.value
  };
  if (payload.hookEventName !== void 0 && payload.hookEventName !== event) {
    return reject(`payload is for ${payload.hookEventName}, not ${event}`);
  }
  return accept(payload);
};

// src/hooks/stdin.ts
var readAll = (source) => new Promise((resolve2, reject2) => {
  if (source.isTTY === true) {
    resolve2("");
    return;
  }
  const chunks = [];
  source.setEncoding?.("utf8");
  source.on("data", (chunk) => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  });
  source.on("end", () => {
    resolve2(chunks.join(""));
  });
  source.on("error", reject2);
});
var DeadlineError = class extends Error {
  ms;
  constructor(ms) {
    super(`deadline of ${String(ms)} ms exceeded`);
    this.name = "DeadlineError";
    this.ms = ms;
  }
};
var withDeadline = (work, ms, startTimer) => new Promise((resolve2, reject2) => {
  const cancel = startTimer(ms, () => {
    reject2(new DeadlineError(ms));
  });
  work.then(
    (value) => {
      cancel();
      resolve2(value);
    },
    (error) => {
      cancel();
      reject2(error instanceof Error ? error : new Error(String(error)));
    }
  );
});

// src/hooks/runner.ts
var messageOf2 = (error) => error instanceof Error ? error.message : String(error);
var decide2 = (input, handlers) => composeDecisions(input, handlers[input.event] ?? [allow]);
var evaluate = async (event, options) => {
  const text6 = await readAll(options.stdin);
  const parsed = parseHookPayload(event, text6, options.stdin.isTTY === true);
  if (!parsed.ok) return { kind: "failed", payload: void 0, detail: parsed.error };
  const payload = parsed.value;
  try {
    return {
      kind: "decided",
      payload,
      decision: await decide2(
        { event, payload, cwd: options.cwd, runtime: options.runtime, t: options.t, env: options.env ?? {} },
        options.handlers
      )
    };
  } catch (error) {
    return { kind: "failed", payload, detail: messageOf2(error) };
  }
};
var ALLOW_STDOUT = `${JSON.stringify({ continue: true })}
`;
var allowed = (output) => ({
  exitCode: 0,
  stdout: `${JSON.stringify({ continue: true, ...output })}
`,
  stderr: "",
  verdict: "allow"
});
var released = (event, detail, t) => ({
  exitCode: 0,
  stdout: ALLOW_STDOUT,
  stderr: `finitemonkey: ${t("hook.stop_released", { event, detail })}
`,
  verdict: "stop_released"
});
var failed3 = (event, detail, t) => HOOK_POLICIES[event].failClosed ? {
  exitCode: 2,
  stdout: "",
  stderr: `finitemonkey: ${t("hook.failed_closed", { event, detail })}
`,
  verdict: "failed_closed"
} : {
  exitCode: 0,
  stdout: "",
  stderr: `finitemonkey: ${t("hook.failed_open", { event, detail })}
`,
  verdict: "failed_open"
};
var conclude2 = (event, evaluation, t) => {
  const stopActive = evaluation.payload?.stopHookActive === true;
  if (evaluation.kind === "failed") {
    return stopActive ? released(event, evaluation.detail, t) : failed3(event, evaluation.detail, t);
  }
  const { decision } = evaluation;
  if (decision.kind === "allow") return allowed(decision.output);
  if (stopActive && decision.persistent !== true) return released(event, decision.reason, t);
  if (decision.output !== void 0) {
    return { exitCode: 0, stdout: `${JSON.stringify(decision.output)}
`, stderr: "", verdict: "block" };
  }
  return { exitCode: 2, stdout: "", stderr: `finitemonkey: ${decision.reason}
`, verdict: "block" };
};
var runHook = async (event, options) => {
  try {
    return conclude2(
      event,
      await withDeadline(evaluate(event, options), options.deadlineMs, options.startTimer),
      options.t
    );
  } catch (error) {
    return failed3(event, messageOf2(error), options.t);
  }
};

// src/install/plugin-yield.ts
import { join as join23 } from "node:path";

// src/install/layout.ts
var STATE_DIR = ".finitemonkey";
var SETTINGS_FILE = ".claude/settings.json";
var GITIGNORE_FILE = ".gitignore";
var CONFIG_FILE3 = ".finitemonkey/config.yml";
var LOCK_FILE = ".finitemonkey/lock.json";
var BACKUPS_DIR = ".finitemonkey/backups";
var LOCKS_DIR = ".finitemonkey/locks";
var INSTALL_LOCK = ".finitemonkey/locks/install.lock";
var LOCAL_BIN = "node_modules/finitemonkey/dist/finitemonkey.mjs";
var VENDOR_BIN = ".finitemonkey/runtime/dist/finitemonkey.mjs";
var VENDOR_PACKAGE = ".finitemonkey/runtime/package.json";
var LOCK_SCHEMA = "finitemonkey/lock@1";
var PLAN_SCHEMA = "finitemonkey/install-plan@1";
var GENERATED_MARKER = "finitemonkey:generated v=1";
var BLOCK_BEGIN = "# finitemonkey:begin v=1";
var BLOCK_END = "# finitemonkey:end";
var INSTALL_LOCK_STALE_MS = 5 * 60 * 1e3;
var PRESETS = ["neutral", "gabriel"];
var parsePreset = (raw) => raw === void 0 ? "neutral" : PRESETS.find((preset) => preset === raw);
var COMMITTED_STATE = ["config.yml", "runtime/", "tasks/", "rules.yml", "policy.yml", "findings/"];

// src/install/hook-entries.ts
var INSTALLED_HOOKS = [
  { event: "SessionStart", timeout: 30, guard: false },
  { event: "UserPromptSubmit", timeout: 10, guard: true },
  { event: "PreToolUse", timeout: 10, guard: true },
  { event: "PostToolUse", timeout: 30, guard: false },
  { event: "Stop", timeout: 600, guard: false },
  { event: "SubagentStart", timeout: 30, guard: false },
  { event: "SubagentStop", timeout: 600, guard: false },
  { event: "PreCompact", timeout: 30, guard: false },
  { event: "ConfigChange", timeout: 10, guard: true }
];
var PROJECT_BIN = `\${CLAUDE_PROJECT_DIR}/${LOCAL_BIN}`;
var VENDORED_BIN = `\${CLAUDE_PROJECT_DIR}/${VENDOR_BIN}`;
var isScript = (path) => /\.(c|m)?js$/i.test(path);
var execForm = (runner, event) => {
  if (runner.kind === "local") return { command: "node", args: [PROJECT_BIN, "hook", event] };
  if (runner.kind === "vendored") return { command: "node", args: [VENDORED_BIN, "hook", event] };
  if (isScript(runner.path)) return { command: "node", args: [runner.path, "hook", event] };
  return { command: runner.path, args: ["hook", event] };
};
var hookHandler = (runner, spec2, failClosedSupported) => {
  const failure4 = spec2.guard && failClosedSupported ? { onFailure: "block" } : {};
  const { command, args } = execForm(runner, spec2.event);
  return { type: "command", command, args, timeout: spec2.timeout, ...failure4 };
};
var OWN_SHELL = /(^|[\s/"'])finitemonkey(@[^\s"]+|\.mjs|\.cmd|\.exe)?"?\s+hook\s/;
var OWN_SCRIPT = /finitemonkey(\.mjs|\.cmd|\.exe)?$/;
var stringsOf = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
var isOwnHandler = (handler) => {
  if (!isRecord(handler)) return false;
  const command = handler["command"];
  if (typeof command !== "string") return false;
  const args = stringsOf(handler["args"]);
  if (args.length === 0) return OWN_SHELL.test(`${command} `);
  const hookAt = args.indexOf("hook");
  if (hookAt < 0) return false;
  const target = hookAt === 0 ? command : args[hookAt - 1] ?? "";
  return OWN_SCRIPT.test(target);
};

// src/install/json-text.ts
var DEFAULT_STYLE = { indent: "  ", finalNewline: true };
var styleOf = (text6) => {
  const indented = /\n([ \t]+)\S/.exec(text6);
  return { indent: indented?.[1] ?? DEFAULT_STYLE.indent, finalNewline: text6.endsWith("\n") };
};
var renderJson = (value, style) => `${JSON.stringify(value, null, style.indent)}${style.finalNewline ? "\n" : ""}`;
var parseSettings = (text6) => text6 === void 0 || text6.trim() === "" ? { ok: true, value: {} } : parseJsonObject(text6);
var asList = (value) => Array.isArray(value) ? value : [];
var asRecord = (value) => isRecord(value) ? value : {};
var setKey = (record2, key, value) => {
  if (!(key in record2)) return value === void 0 ? record2 : { ...record2, [key]: value };
  return Object.fromEntries(
    Object.entries(record2).flatMap(([name, current]) => {
      if (name !== key) return [[name, current]];
      return value === void 0 ? [] : [[name, value]];
    })
  );
};

// src/install/settings-merge.ts
var SETTINGS_SCHEMA_URL = "https://json.schemastore.org/claude-code-settings.json";
var ATTRIBUTION_OFF = { commit: "", pr: "", sessionUrl: false };
var MARKETPLACE_ENTRY = { source: { source: "github", repo: "gabrielvieiraf/finitemonkey" } };
var MARKETPLACE_KEY = "finitemonkey";
var PLUGIN_ID = "finitemonkey@finitemonkey";
var withEntry = (settings, key, name, value) => {
  const inner = setKey(asRecord(settings[key]), name, value);
  return setKey(settings, key, Object.keys(inner).length === 0 ? void 0 : inner);
};
var hasEntry = (settings, key, name) => name in asRecord(settings[key]);
var replaceInGroup = (group, isOwn, take) => {
  if (!isRecord(group)) return group;
  const handlers = asList(group["hooks"]).flatMap((handler) => {
    if (!isOwn(handler)) return [handler];
    const replacement = take();
    return replacement === void 0 ? [] : [replacement];
  });
  return handlers.length === 0 ? void 0 : { ...group, hooks: handlers };
};
var mergeEvent = (groups, isOwn, wanted) => {
  let pending = wanted;
  const take = () => {
    const next2 = pending;
    pending = void 0;
    return next2;
  };
  const kept = groups.map((group) => replaceInGroup(group, isOwn, take)).filter((group) => group !== void 0);
  return pending === void 0 ? kept : [...kept, { hooks: [pending] }];
};
var mergeHooks = (hooks, isOwn, wanted) => {
  const events = [.../* @__PURE__ */ new Set([...Object.keys(hooks), ...Object.keys(wanted)])];
  const entries = events.flatMap((event) => {
    const groups = hooks[event];
    if (groups !== void 0 && !Array.isArray(groups)) return [[event, groups]];
    const merged = mergeEvent(asList(groups), isOwn, wanted[event]);
    return merged.length === 0 ? [] : [[event, merged]];
  });
  return Object.fromEntries(entries);
};
var withHooks = (settings, hooks) => {
  return setKey(settings, "hooks", Object.keys(hooks).length === 0 ? void 0 : hooks);
};
var withPermissions = (settings, deny2) => {
  const permissions = asRecord(settings["permissions"]);
  const next2 = setKey(permissions, "deny", deny2.length === 0 ? void 0 : deny2);
  return setKey(settings, "permissions", Object.keys(next2).length === 0 ? void 0 : next2);
};
var ownHookMatcher = (recorded) => (handler) => isOwnHandler(handler) || recorded.some((own) => JSON.stringify(own) === JSON.stringify(handler));
var mergeSettings = (current, wanted, recorded) => {
  const schema = Object.keys(current).length === 0;
  const base = schema ? { $schema: SETTINGS_SCHEMA_URL } : current;
  const hooks = mergeHooks(asRecord(base["hooks"]), ownHookMatcher(recorded), wanted.hooks);
  const existingDeny = asList(asRecord(base["permissions"])["deny"]);
  const deny2 = wanted.deny.filter((rule) => !existingDeny.includes(rule));
  const attribution = wanted.attributionOff && !("attribution" in base);
  const marketplace = wanted.marketplace && !hasEntry(base, "extraKnownMarketplaces", MARKETPLACE_KEY);
  const plugin = wanted.marketplace && !hasEntry(base, "enabledPlugins", PLUGIN_ID);
  let settings = withPermissions(withHooks(base, hooks), [...existingDeny, ...deny2]);
  if (attribution) settings = { ...settings, attribution: ATTRIBUTION_OFF };
  if (marketplace) settings = withEntry(settings, "extraKnownMarketplaces", MARKETPLACE_KEY, MARKETPLACE_ENTRY);
  if (plugin) settings = withEntry(settings, "enabledPlugins", PLUGIN_ID, true);
  return { settings, added: { schema, deny: deny2, attribution, marketplace, plugin } };
};
var sameAttribution = (value) => JSON.stringify(value) === JSON.stringify(ATTRIBUTION_OFF);
var unmergeSettings = (current, added, recorded) => {
  const hooks = mergeHooks(asRecord(current["hooks"]), ownHookMatcher(recorded), {});
  const deny2 = asList(asRecord(current["permissions"])["deny"]).filter(
    (rule) => typeof rule !== "string" || !added.deny.includes(rule)
  );
  let settings = withPermissions(withHooks(current, hooks), deny2);
  if (added.attribution && sameAttribution(settings["attribution"])) {
    settings = setKey(settings, "attribution", void 0);
  }
  if (added.marketplace) settings = withEntry(settings, "extraKnownMarketplaces", MARKETPLACE_KEY, void 0);
  if (added.plugin) settings = withEntry(settings, "enabledPlugins", PLUGIN_ID, void 0);
  if (added.schema && Object.keys(settings).length === 1 && settings["$schema"] === SETTINGS_SCHEMA_URL) return {};
  return settings;
};
var ownHandlersIn = (settings) => Object.values(asRecord(settings["hooks"])).flatMap((groups) => asList(groups)).flatMap((group) => asList(asRecord(group)["hooks"])).filter(isOwnHandler).length;

// src/install/plugin-yield.ts
var PLUGIN_VIA = "plugin";
var YIELD_STDOUT = `${JSON.stringify({ continue: true })}
`;
var projectOwnsHooks = (ctx) => {
  const root = ctx.env["CLAUDE_PROJECT_DIR"] ?? ctx.cwd;
  const text6 = ctx.runtime.readText(toAbsolutePath(join23(root, ...SETTINGS_FILE.split("/"))));
  if (!text6.ok) return false;
  const parsed = parseJsonObject(text6.value);
  return parsed.ok && ownHandlersIn(parsed.value) > 0;
};

// src/commands/hook.ts
var hookCommand = {
  path: ["hook"],
  summaryKey: "command.hook.summary",
  usage: `finitemonkey hook <${HOOK_EVENTS.join("|")}>`,
  status: "ready",
  maxPositionals: 1,
  options: { via: { type: "string" } },
  run: async (ctx, args) => {
    const raw = args.positionals[0] ?? "";
    const event = parseHookEvent(raw);
    if (event === void 0) {
      const params2 = { event: raw, events: HOOK_EVENTS.join(", ") };
      return failureFrom(
        ctx.t,
        usageProblem("unknown_hook_event", "error.unknown_hook_event", "finitemonkey help hook", params2)
      );
    }
    if (stringOption(args.values, "via") === PLUGIN_VIA && projectOwnsHooks(ctx)) {
      return { ok: true, exitCode: 0, data: { event, verdict: "allow" }, raw: { stdout: YIELD_STDOUT, stderr: "" } };
    }
    const outcome = await runHook(event, {
      stdin: ctx.io.stdin,
      deadlineMs: deadlineFor(event, ctx.env["FINITEMONKEY_HOOK_DEADLINE_MS"]),
      handlers: DEFAULT_HANDLERS,
      cwd: ctx.cwd,
      t: ctx.t,
      startTimer: ctx.runtime.startTimer,
      runtime: ctx.runtime,
      env: ctx.env
    });
    const data = { event, verdict: outcome.verdict };
    const output = { stdout: outcome.stdout, stderr: outcome.stderr };
    if (outcome.exitCode === 0) return { ok: true, exitCode: 0, data, raw: output };
    const message = outcome.stderr.trim();
    return {
      ok: false,
      exitCode: 2,
      data,
      raw: output,
      error: { code: "hook_blocked", message, fix: "finitemonkey doctor" }
    };
  }
};

// src/commands/i18n-check.ts
import { join as join24 } from "node:path";

// src/i18n/languages.ts
var LANGUAGES = ["en", "pt-BR", "es"];
var SOURCE_LANG = "en";
var normalizeLang = (raw) => {
  if (raw === void 0) return void 0;
  const base = (raw.trim().split(/[.@:]/)[0] ?? "").replace(/_/g, "-").toLowerCase();
  if (base === "pt" || base.startsWith("pt-")) return "pt-BR";
  if (base === "es" || base.startsWith("es-")) return "es";
  if (base === "en" || base.startsWith("en-")) return "en";
  return void 0;
};
var LANG_ENV_ORDER = ["FINITEMONKEY_LANG", "LC_ALL", "LC_MESSAGES", "LANG"];
var detectLang = (flag2, env) => {
  const fromFlag = normalizeLang(flag2);
  if (fromFlag) return { lang: fromFlag, source: "flag" };
  for (const name of LANG_ENV_ORDER) {
    const lang = normalizeLang(env[name]);
    if (lang) return { lang, source: name };
  }
  return { lang: SOURCE_LANG, source: "default" };
};

// src/i18n/translate.ts
var PLACEHOLDER2 = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;
var interpolate = (template, params2 = {}) => template.replace(PLACEHOLDER2, (match, name) => {
  const value = params2[name];
  return value === void 0 ? match : String(value);
});
var placeholdersOf = (template) => [...new Set(Array.from(template.matchAll(PLACEHOLDER2), (match) => match[1] ?? ""))].sort();
var createTranslator = (lang, source = catalogs) => (key, params2) => interpolate(source[lang][key] ?? source[SOURCE_LANG][key] ?? key, params2);

// src/i18n/check.ts
var sameList = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
var valueProblems = (lang, catalog, reference) => Object.keys(catalog).sort().flatMap((key) => {
  const value = catalog[key];
  if (typeof value !== "string") return [{ lang, key, kind: "not_string" }];
  const problems = [];
  if (value.trim() === "") problems.push({ lang, key, kind: "empty" });
  if (!(key in reference)) problems.push({ lang, key, kind: "extra" });
  return problems;
});
var parityProblems = (lang, catalog, reference) => Object.keys(reference).sort().flatMap((key) => {
  const value = catalog[key];
  const source = reference[key];
  if (value === void 0) return [{ lang, key, kind: "missing" }];
  if (typeof value !== "string" || typeof source !== "string") return [];
  const expected = placeholdersOf(source);
  const actual = placeholdersOf(value);
  return sameList(expected, actual) ? [] : [{ lang, key, kind: "placeholder", expected, actual }];
});
var checkCatalogs = (input) => {
  const reference = input[SOURCE_LANG];
  const problems = LANGUAGES.flatMap(
    (lang) => lang === SOURCE_LANG ? valueProblems(lang, input[lang], reference) : [...valueProblems(lang, input[lang], reference), ...parityProblems(lang, input[lang], reference)]
  );
  return { languages: LANGUAGES, keys: Object.keys(reference).length, problems };
};

// src/commands/i18n-check.ts
var unreadable = (dir, file, detail) => ({
  code: "i18n_catalog_unreadable",
  messageKey: "error.i18n_catalog_unreadable",
  params: { file, detail },
  fix: `finitemonkey i18n check --dir ${dir}`,
  exitCode: ExitCode.NotConfigured
});
var readCatalog = (ctx, dir, lang) => {
  const file = toAbsolutePath(join24(dir, `${lang}.json`));
  const text6 = ctx.runtime.readText(file);
  if (!text6.ok) return reject(unreadable(dir, file, text6.error));
  const parsed = parseJsonObject(text6.value);
  return parsed.ok ? parsed : reject(unreadable(dir, file, parsed.error));
};
var loadCatalogs = (ctx, dir) => {
  const en = readCatalog(ctx, dir, "en");
  if (!en.ok) return en;
  const ptBR = readCatalog(ctx, dir, "pt-BR");
  if (!ptBR.ok) return ptBR;
  const es = readCatalog(ctx, dir, "es");
  if (!es.ok) return es;
  return accept({ en: en.value, "pt-BR": ptBR.value, es: es.value });
};
var describeProblem = (ctx, problem3) => {
  const kind = ctx.t(`i18n.problem.${problem3.kind}`, {
    expected: (problem3.expected ?? []).join(", "),
    actual: (problem3.actual ?? []).join(", ")
  });
  return `  ${problem3.lang}  ${problem3.key}  ${kind}`;
};
var runI18nCheck = (ctx, dir) => {
  const input = dir === void 0 ? accept(catalogs) : loadCatalogs(ctx, dir);
  if (!input.ok) return failureFrom(ctx.t, input.error);
  const report2 = checkCatalogs(input.value);
  const data = { ...report2, source: dir ?? "bundled" };
  const summary = ctx.t("i18n.summary", { languages: report2.languages.join(", "), keys: report2.keys });
  if (report2.problems.length === 0) return success(data, [summary, ctx.t("i18n.ok")]);
  return {
    ok: false,
    exitCode: ExitCode.CheckFailed,
    data,
    human: [summary, ...report2.problems.map((problem3) => describeProblem(ctx, problem3))],
    error: {
      code: "i18n_mismatch",
      message: ctx.t("error.i18n_mismatch", { count: report2.problems.length }),
      fix: ctx.t("i18n.fix", { file: dir ?? "src/i18n" })
    }
  };
};
var i18nCheckCommand = {
  path: ["i18n", "check"],
  summaryKey: "command.i18n_check.summary",
  usage: "finitemonkey i18n check [--dir <path>]",
  status: "ready",
  options: { dir: { type: "string" } },
  run: (ctx, args) => {
    const dir = stringOption(args.values, "dir");
    return Promise.resolve(runI18nCheck(ctx, dir === void 0 ? void 0 : toAbsolutePath(dir, ctx.cwd)));
  }
};

// src/install/apply.ts
import { dirname as dirname6 } from "node:path";

// src/install/hash.ts
import { createHash as createHash2 } from "node:crypto";
var hashText = (text6) => `sha256:${createHash2("sha256").update(text6, "utf8").digest("hex")}`;

// src/install/lock-file.ts
var ENTRY_KINDS = ["settings", "gitignore", "generated"];
var strings2 = (value) => Array.isArray(value) && value.every((item) => typeof item === "string") ? value : void 0;
var parseAdded = (value) => {
  if (!isRecord(value)) return void 0;
  const deny2 = strings2(value["deny"]);
  const { schema, attribution } = value;
  if (deny2 === void 0 || typeof schema !== "boolean" || typeof attribution !== "boolean") return void 0;
  const marketplace = value["marketplace"] === true;
  const plugin = value["plugin"] === true;
  return { schema, attribution, deny: deny2, marketplace, plugin };
};
var parseEntry2 = (value) => {
  if (!isRecord(value)) return void 0;
  const { path, kind, existed, hash, backup } = value;
  const known2 = ENTRY_KINDS.find((item) => item === kind);
  if (typeof path !== "string" || known2 === void 0 || typeof existed !== "boolean" || typeof hash !== "string") {
    return void 0;
  }
  const added = parseAdded(value["added"]);
  const handlers = Array.isArray(value["handlers"]) ? value["handlers"].filter(isRecord) : void 0;
  return {
    path,
    kind: known2,
    existed,
    hash,
    ...typeof backup === "string" ? { backup } : {},
    ...added === void 0 ? {} : { added },
    ...handlers === void 0 ? {} : { handlers }
  };
};
var parseEntries = (value) => {
  if (!Array.isArray(value)) return void 0;
  const entries = value.map(parseEntry2);
  return entries.every((entry2) => entry2 !== void 0) ? entries : void 0;
};
var fromRecord = (record2) => {
  const { schema, version, preset, installedAt, updatedAt } = record2;
  const known2 = PRESETS.find((item) => item === preset);
  const entries = parseEntries(record2["entries"]);
  const createdDirs = strings2(record2["createdDirs"]);
  if (schema !== LOCK_SCHEMA) return reject(`schema is not ${LOCK_SCHEMA}`);
  if (typeof version !== "string" || typeof installedAt !== "string" || typeof updatedAt !== "string") {
    return reject("version, installedAt and updatedAt must be text");
  }
  if (known2 === void 0 || entries === void 0 || createdDirs === void 0) {
    return reject("preset, entries or createdDirs is malformed");
  }
  return accept({ schema, version, preset: known2, installedAt, updatedAt, createdDirs, entries });
};
var parseLock = (text6) => {
  const parsed = parseJsonObject(text6);
  return parsed.ok ? fromRecord(parsed.value) : reject(parsed.error);
};
var renderLock = (lock) => `${JSON.stringify(lock, null, 2)}
`;

// src/install/claude-version.ts
var ON_FAILURE_MIN = [2, 1, 295];
var PROBE_MS = 8e3;
var parseClaudeVersion = (output) => {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(output);
  return match === null ? void 0 : [Number(match[1]), Number(match[2]), Number(match[3])];
};
var atLeast = (version, min) => {
  for (const [index, part2] of min.entries()) {
    const value = version[index] ?? 0;
    if (value !== part2) return value > part2;
  }
  return true;
};
var detectClaude = (probe) => {
  const result = probe("claude", ["--version"], PROBE_MS);
  const parsed = result.ok ? parseClaudeVersion(result.stdout) : void 0;
  if (parsed === void 0) return { version: void 0, failClosed: true };
  return { version: parsed.join("."), failClosed: atLeast(parsed, ON_FAILURE_MIN) };
};

// src/install/config-template.ts
var configTemplate = (t, preset, lang) => [
  `# ${GENERATED_MARKER}`,
  `# ${t("install.config.header")}`,
  "schemaVersion: 1",
  `preset: ${preset}`,
  `lang: ${lang}`,
  ""
].join("\n");
var hasMarker = (text6) => text6.includes(GENERATED_MARKER);

// src/install/deny-floor.ts
var DENY_FLOOR = {
  secrets: ["Read(./.env)", "Read(./.env.*)", "Read(./**/.env)", "Read(./**/.env.*)", "Read(./**/*.pem)"],
  git: [
    "Bash(git push --force *)",
    "Bash(git push -f *)",
    "Bash(git clean -f*)",
    "Bash(git reset --hard*)",
    "Bash(git worktree remove --force*)"
  ],
  proof: [
    "Edit(./.finitemonkey/evidence/**)",
    "Edit(./.finitemonkey/runtime/**)",
    "Edit(./.finitemonkey/lock.json)",
    "Edit(./.finitemonkey/log.jsonl)",
    "Edit(./.finitemonkey/state.md)",
    "Edit(./.finitemonkey/state.json)",
    "Edit(./.finitemonkey/trust.json)",
    "Edit(./.finitemonkey/allow/**)",
    "Edit(./.finitemonkey/cache/**)"
  ]
};
var DENY_RULES = [...DENY_FLOOR.secrets, ...DENY_FLOOR.git, ...DENY_FLOOR.proof];

// src/install/detect.ts
import { join as join25 } from "node:path";
var PACKAGE_MANAGERS = [
  { name: "pnpm", files: ["pnpm-lock.yaml"] },
  { name: "yarn", files: ["yarn.lock"] },
  { name: "bun", files: ["bun.lock", "bun.lockb"] },
  { name: "npm", files: ["package-lock.json", "npm-shrinkwrap.json"] }
];
var LANGUAGE_MARKERS = [
  { name: "typescript", files: ["tsconfig.json"] },
  { name: "javascript", files: ["package.json"] },
  { name: "python", files: ["pyproject.toml", "requirements.txt", "setup.py"] },
  { name: "go", files: ["go.mod"] },
  { name: "rust", files: ["Cargo.toml"] },
  { name: "ruby", files: ["Gemfile"] },
  { name: "java", files: ["pom.xml", "build.gradle", "build.gradle.kts"] }
];
var LOOP_PLUGINS = ["oh-my-claudecode", "ralph-loop", "ralph-wiggum", "everything-claude-code", "superclaude"];
var WORKFLOW_DIRS = [
  { dir: ".planning", name: "gsd" },
  { dir: ".bmad-core", name: "bmad" },
  { dir: ".specify", name: "spec-kit" },
  { dir: "openspec", name: "openspec" }
];
var fromPackageJson = (project) => {
  const text6 = project.read("package.json");
  const parsed = text6 === void 0 ? void 0 : parseJsonObject(text6);
  const field = parsed?.ok === true ? parsed.value["packageManager"] : void 0;
  if (typeof field !== "string") return void 0;
  return PACKAGE_MANAGERS.find(({ name }) => field.startsWith(`${name}@`))?.name;
};
var detectPackageManager = (project) => fromPackageJson(project) ?? PACKAGE_MANAGERS.find(({ files }) => files.some((file) => project.exists(file)))?.name;
var detectLanguages = (project) => LANGUAGE_MARKERS.filter(({ files }) => files.some((file) => project.exists(file))).map(({ name }) => name);
var handlersOf = (settings, event) => {
  const hooks = settings["hooks"];
  const groups = isRecord(hooks) ? hooks[event] : void 0;
  return asList(groups).flatMap((group) => asList(asRecord(group)["hooks"]));
};
var allHandlers = (settings) => {
  const hooks = settings["hooks"];
  return isRecord(hooks) ? Object.keys(hooks).flatMap((event) => handlersOf(settings, event)) : [];
};
var settingsInfo = (text6) => {
  if (text6 === void 0) return { exists: false, valid: true, userHooks: 0, ownHooks: 0 };
  const parsed = text6.trim() === "" ? { ok: true, value: {} } : parseJsonObject(text6);
  if (!parsed.ok) return { exists: true, valid: false, userHooks: 0, ownHooks: 0 };
  const handlers = allHandlers(parsed.value);
  const own = handlers.filter(isOwnHandler).length;
  return { exists: true, valid: true, userHooks: handlers.length - own, ownHooks: own };
};
var pluginAuthorities = (settings, source) => {
  const enabled = settings["enabledPlugins"];
  if (!isRecord(enabled)) return [];
  return Object.entries(enabled).filter(([, on]) => on === true).map(([id]) => id.split("@")[0] ?? id).flatMap((name) => {
    if (name === "finitemonkey") return [{ kind: "finitemonkey-plugin", source, name }];
    return LOOP_PLUGINS.includes(name) ? [{ kind: "loop-plugin", source, name }] : [];
  });
};
var scopeAuthorities = (text6, source) => {
  const parsed = text6 === void 0 ? void 0 : parseJsonObject(text6);
  if (parsed?.ok !== true) return [];
  const stops = ["Stop", "SubagentStop"].flatMap(
    (event) => handlersOf(parsed.value, event).filter((handler) => !isOwnHandler(handler)).map((handler) => {
      const command = isRecord(handler) ? handler["command"] : void 0;
      return { kind: "stop-hook", source, name: `${event}: ${typeof command === "string" ? command : "?"}` };
    })
  );
  return [...stops, ...pluginAuthorities(parsed.value, source)];
};
var userSettingsText = (project, env) => {
  const home = env["CLAUDE_CONFIG_DIR"] ?? env["HOME"] ?? env["USERPROFILE"];
  if (home === void 0) return void 0;
  const file = env["CLAUDE_CONFIG_DIR"] === void 0 ? join25(home, ".claude", "settings.json") : join25(home, "settings.json");
  const text6 = project.runtime.readText(toAbsolutePath(file));
  return text6.ok ? text6.value : void 0;
};
var detectAuthorities = (project, env) => [
  ...scopeAuthorities(project.read(SETTINGS_FILE), "project"),
  ...scopeAuthorities(project.read(".claude/settings.local.json"), "local"),
  ...scopeAuthorities(userSettingsText(project, env), "user"),
  ...WORKFLOW_DIRS.filter(({ dir }) => project.isDir(dir)).map(({ name }) => ({
    kind: "workflow",
    source: "project-dir",
    name
  }))
];
var chooseRunner = (project, bin) => {
  if (bin !== void 0) return { kind: "path", path: bin };
  return project.exists(LOCAL_BIN) ? { kind: "local" } : { kind: "vendored" };
};

// src/install/gitignore-block.ts
var gitignoreBlock = () => [
  BLOCK_BEGIN,
  `${STATE_DIR}/*`,
  ...COMMITTED_STATE.map((path) => `!${STATE_DIR}/${path}`),
  BLOCK_END
];
var lineBreak = (text6) => text6.includes("\r\n") ? "\r\n" : "\n";
var blockRange = (lines3) => {
  const start = lines3.findIndex((line2) => line2.trimEnd() === BLOCK_BEGIN);
  if (start < 0) return void 0;
  const end = lines3.findIndex((line2, index) => index > start && line2.trimEnd() === BLOCK_END);
  return end < 0 ? void 0 : { start, end };
};
var withBlock = (text6) => {
  const eol = text6 === void 0 ? "\n" : lineBreak(text6);
  const block4 = gitignoreBlock();
  if (text6 === void 0 || text6 === "") return `${block4.join(eol)}${eol}`;
  const lines3 = text6.split(eol);
  const range = blockRange(lines3);
  if (range !== void 0) return [...lines3.slice(0, range.start), ...block4, ...lines3.slice(range.end + 1)].join(eol);
  const separator = text6.endsWith(eol) ? "" : eol;
  return `${text6}${separator}${block4.join(eol)}${eol}`;
};
var withoutBlock = (text6) => {
  const eol = lineBreak(text6);
  const lines3 = text6.split(eol);
  const range = blockRange(lines3);
  if (range === void 0) return text6;
  return [...lines3.slice(0, range.start), ...lines3.slice(range.end + 1)].join(eol);
};

// src/install/vendor.ts
var isBundle = (text6) => text6.startsWith("#!/usr/bin/env node") && text6.includes("finitemonkey");
var isOwnPackage = (text6) => {
  const parsed = parseJsonObject(text6);
  return parsed.ok && parsed.value["name"] === "finitemonkey";
};
var vendoredPackage = (version) => `${JSON.stringify({ name: "finitemonkey", version, private: true, type: "module" }, null, 2)}
`;
var vendoredFiles = (bundle, version) => [
  { path: VENDOR_BIN, template: bundle, isOurs: isBundle },
  { path: VENDOR_PACKAGE, template: vendoredPackage(version), isOurs: isOwnPackage }
];
var isBundlePath = (path) => path.endsWith(".mjs");

// src/install/plan.ts
var CHANGING = ["create", "merge", "update"];
var detect = (project, gitRoot2, input) => ({
  root: project.root,
  gitRoot: gitRoot2,
  packageManager: detectPackageManager(project),
  languages: detectLanguages(project),
  settings: settingsInfo(project.read(SETTINGS_FILE)),
  authorities: detectAuthorities(project, input.env),
  runner: chooseRunner(project, input.bin),
  claude: detectClaude(project.runtime.probe)
});
var readPreviousLock = (project) => {
  const text6 = project.read(LOCK_FILE);
  if (text6 === void 0) return accept(void 0);
  const parsed = parseLock(text6);
  return parsed.ok ? accept(parsed.value) : reject({ kind: "lock", detail: parsed.error });
};
var actionFor = (before, after, existing) => {
  if (before === void 0) return "create";
  return before === after ? "unchanged" : existing;
};
var union = (a, b) => [.../* @__PURE__ */ new Set([...a, ...b])];
var joinAdded = (previous, next2) => previous === void 0 ? next2 : {
  schema: previous.schema || next2.schema,
  attribution: previous.attribution || next2.attribution,
  deny: union(previous.deny, next2.deny),
  marketplace: previous.marketplace || next2.marketplace,
  plugin: previous.plugin || next2.plugin
};
var wantedHooks = (detection) => Object.fromEntries(
  INSTALLED_HOOKS.map((spec2) => [spec2.event, hookHandler(detection.runner, spec2, detection.claude.failClosed)])
);
var settingsItem = (project, detection, input, previous) => {
  const before = project.read(SETTINGS_FILE);
  const current = parseSettings(before);
  if (!current.ok) return reject({ kind: "settings", detail: current.error });
  const hooks = wantedHooks(detection);
  const wanted = {
    hooks,
    deny: DENY_RULES,
    attributionOff: input.preset === "gabriel",
    marketplace: input.marketplace
  };
  const merged = mergeSettings(current.value, wanted, previous?.handlers ?? []);
  const after = renderJson(merged.settings, before === void 0 ? DEFAULT_STYLE : styleOf(before));
  return accept({
    path: SETTINGS_FILE,
    kind: "settings",
    action: actionFor(before, after, "merge"),
    before,
    after,
    added: joinAdded(previous?.added, merged.added),
    handlers: Object.values(hooks)
  });
};
var gitignoreItem = (project) => {
  const before = project.read(GITIGNORE_FILE);
  const after = withBlock(before);
  return { path: GITIGNORE_FILE, kind: "gitignore", action: actionFor(before, after, "merge"), before, after };
};
var generatedItem = (project, file, previous) => {
  const before = project.read(file.path);
  const { template } = file;
  const base = { path: file.path, kind: "generated", before };
  if (before === void 0) return { ...base, action: "create", after: template };
  if (previous === void 0 && !file.isOurs(before)) {
    return { ...base, action: "skip-foreign", after: before, proposal: template };
  }
  if (hashText(before) !== previous?.hash) {
    return { ...base, action: before === template ? "unchanged" : "keep-edited", after: before, proposal: template };
  }
  return { ...base, action: actionFor(before, template, "update"), after: template };
};
var generatedFiles = (input, vendor) => {
  const config = { path: CONFIG_FILE3, template: configTemplate(input.t, input.preset, input.lang), isOurs: hasMarker };
  if (!vendor) return accept([config]);
  if (input.bundle === void 0) return reject({ kind: "bundle", detail: "the running finitemonkey is not a bundle" });
  return accept([config, ...vendoredFiles(input.bundle, input.version)]);
};
var entryFor = (lock, path) => lock?.entries.find((entry2) => entry2.path === path);
var buildPlan = (project, detection, input, previous) => {
  const settings = settingsItem(project, detection, input, entryFor(previous, SETTINGS_FILE));
  if (!settings.ok) return settings;
  const vendor = detection.runner.kind === "vendored" || entryFor(previous, VENDOR_BIN) !== void 0;
  const files = generatedFiles(input, vendor);
  if (!files.ok) return files;
  const generated = files.value.map((file) => generatedItem(project, file, entryFor(previous, file.path)));
  return accept({
    detection,
    preset: input.preset,
    items: [settings.value, gitignoreItem(project), ...generated],
    previous
  });
};
var hasChanges = (plan) => plan.items.some((item) => CHANGING.includes(item.action));
var needsWrite = (plan) => hasChanges(plan) || plan.previous === void 0;

// src/install/apply.ts
var stamp = (iso) => iso.replace(/[:.]/g, "-");
var ensureParent = (project, relative7) => project.runtime.mkdir(project.abs(dirname6(relative7)));
var writeText = (project, relative7, text6) => {
  const parent = ensureParent(project, relative7);
  const written = parent.ok ? project.runtime.writeAtomic(project.abs(relative7), text6) : parent;
  return written.ok ? accept(void 0) : reject({ path: relative7, detail: written.error });
};
var restore = (project, items) => {
  for (const item of items) {
    if (item.before === void 0) project.runtime.remove(project.abs(item.path));
    else project.runtime.writeAtomic(project.abs(item.path), item.before);
  }
};
var backupItems = (project, dir, items) => {
  const manifest = items.map((item) => ({ path: item.path, hash: hashText(item.before ?? "") }));
  for (const item of items) {
    const saved = writeText(project, `${dir}/${item.path}`, item.before ?? "");
    if (!saved.ok) return saved;
  }
  return writeText(project, `${dir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}
`);
};
var entryOf2 = (plan, item, backupDir) => {
  const previous = plan.previous?.entries.find((entry2) => entry2.path === item.path);
  const existed = previous?.existed ?? item.before !== void 0;
  const backup = previous?.backup ?? (existed && backupDir !== void 0 ? `${backupDir}/${item.path}` : void 0);
  const hash = item.action === "keep-edited" ? previous?.hash ?? hashText(item.proposal ?? item.after) : hashText(item.after);
  return {
    path: item.path,
    kind: item.kind,
    existed,
    hash,
    ...backup === void 0 ? {} : { backup },
    ...item.added === void 0 ? {} : { added: item.added },
    ...item.handlers === void 0 ? {} : { handlers: item.handlers }
  };
};
var nextLock = (plan, version, now, backupDir, createdDirs) => ({
  schema: LOCK_SCHEMA,
  version,
  preset: plan.preset,
  installedAt: plan.previous?.installedAt ?? now,
  updatedAt: now,
  createdDirs: plan.previous?.createdDirs ?? createdDirs,
  entries: plan.items.filter((item) => item.action !== "skip-foreign").map((item) => entryOf2(plan, item, backupDir))
});
var needsBackup = (plan, item) => item.before !== void 0 && plan.previous?.entries.find((entry2) => entry2.path === item.path)?.backup === void 0;
var writeAll = (project, items) => {
  const done = [];
  for (const item of items) {
    const written = writeText(project, item.path, item.after);
    if (!written.ok) {
      restore(project, done);
      return written;
    }
    done.push(item);
  }
  return accept(void 0);
};
var createdBy = (project) => [".claude", STATE_DIR].filter((dir) => !project.exists(dir));
var commit = (project, plan, version, createdDirs) => {
  const now = project.runtime.now();
  const changing = plan.items.filter((item) => CHANGING.includes(item.action));
  const toBackup = changing.filter((item) => needsBackup(plan, item));
  const backupDir = toBackup.length === 0 ? void 0 : `${BACKUPS_DIR}/${stamp(now)}`;
  if (backupDir !== void 0) {
    const saved = backupItems(project, backupDir, toBackup);
    if (!saved.ok) return saved;
  }
  const written = writeAll(project, changing);
  if (!written.ok) return written;
  const lock = nextLock(plan, version, now, backupDir, createdDirs);
  const locked = writeText(project, LOCK_FILE, renderLock(lock));
  if (!locked.ok) {
    restore(project, changing);
    return locked;
  }
  return accept({ lock, written: changing.map((item) => item.path), backup: backupDir });
};
var withInstallLock = (project, work) => {
  const dir = project.runtime.mkdir(project.abs(LOCKS_DIR));
  if (!dir.ok) return reject({ path: LOCKS_DIR, detail: dir.error });
  const lock = project.runtime.lock(project.abs(INSTALL_LOCK), {
    staleMs: INSTALL_LOCK_STALE_MS,
    owner: "finitemonkey"
  });
  if (!lock.ok) return reject({ path: INSTALL_LOCK, detail: lock.error });
  try {
    return work();
  } finally {
    lock.value();
  }
};
var applyPlan = (project, plan, version) => {
  const created3 = createdBy(project);
  return withInstallLock(project, () => commit(project, plan, version, created3));
};

// src/install/diff.ts
var MAX_DIFF_LINES = 120;
var table = (a, b) => {
  const rows = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    const row = rows[i] ?? [];
    const below = rows[i + 1] ?? [];
    for (let j = b.length - 1; j >= 0; j -= 1) {
      row[j] = a[i] === b[j] ? (below[j + 1] ?? 0) + 1 : Math.max(below[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  return rows;
};
var walk = (a, b) => {
  const lcs = table(a, b);
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const left = a[i];
    const right = b[j];
    if (left !== void 0 && left === right) {
      ops.push(["=", left]);
      i += 1;
      j += 1;
    } else if (right !== void 0 && (left === void 0 || (lcs[i]?.[j + 1] ?? 0) >= (lcs[i + 1]?.[j] ?? 0))) {
      ops.push(["+", right]);
      j += 1;
    } else {
      ops.push(["-", left ?? ""]);
      i += 1;
    }
  }
  return ops;
};
var splitLines = (text6) => text6 === "" ? [] : text6.replace(/\r?\n$/, "").split(/\r?\n/);
var lineDiff = (path, before, after) => {
  const changes = walk(splitLines(before), splitLines(after)).filter(([op]) => op !== "=");
  if (changes.length === 0) return [];
  const lines3 = changes.map(([op, line2]) => `${op} ${line2}`);
  const shown2 = lines3.slice(0, MAX_DIFF_LINES);
  const hidden = lines3.length - shown2.length;
  return [`--- ${path}`, `+++ ${path}`, ...shown2, ...hidden > 0 ? [`… ${String(hidden)} more`] : []];
};

// src/install/report.ts
var jsonDetection = (detection) => ({
  gitRoot: detection.gitRoot,
  packageManager: detection.packageManager ?? null,
  languages: detection.languages,
  settings: detection.settings,
  authorities: detection.authorities,
  runner: detection.runner.kind,
  claudeVersion: detection.claude.version ?? null,
  failClosedHooks: detection.claude.failClosed
});
var authorityWarning = (t, authority) => ({
  code: `authority_${authority.kind}`,
  message: t(`install.warn.${authority.kind === "finitemonkey-plugin" ? "plugin" : "authority"}`, {
    name: authority.name,
    source: authority.source
  })
});
var itemWarning = (t, item) => {
  if (item.action === "skip-foreign")
    return [{ code: "foreign_file", message: t("install.warn.foreign", { path: item.path }) }];
  if (item.action === "keep-edited")
    return [{ code: "edited_file", message: t("install.warn.edited", { path: item.path }) }];
  return [];
};
var planWarnings = (t, plan) => [
  ...plan.detection.gitRoot ? [] : [{ code: "not_git", message: t("install.warn.not_git") }],
  ...plan.detection.claude.failClosed ? [] : [{ code: "fail_open", message: t("install.warn.fail_open", { version: plan.detection.claude.version ?? "?" }) }],
  ...plan.detection.authorities.map((authority) => authorityWarning(t, authority)),
  ...plan.items.flatMap((item) => itemWarning(t, item))
];
var planDiff = (plan) => plan.items.flatMap(
  (item) => item.action === "keep-edited" || item.action === "skip-foreign" ? lineDiff(item.path, item.before ?? "", item.proposal ?? item.after) : lineDiff(item.path, item.before ?? "", item.after)
);
var planData = (t, plan, mode, applied, backup) => ({
  schema: PLAN_SCHEMA,
  mode,
  applied,
  root: plan.detection.root,
  preset: plan.preset,
  detection: jsonDetection(plan.detection),
  actions: plan.items.map(({ path, action }) => ({ path, action })),
  warnings: planWarnings(t, plan),
  diff: planDiff(plan),
  ...backup === void 0 ? {} : { backup }
});
var pad2 = (text6, width) => text6.padEnd(width);
var planLines = (t, data, withDiff) => [
  t("install.plan.title", { root: data.root, preset: data.preset }),
  ...data.actions.map(({ path, action }) => `  ${pad2(action, 13)}${path}`),
  ...data.warnings.map(({ message }) => t("install.warning", { message })),
  ...withDiff ? data.diff : []
];

// src/install/project.ts
import { dirname as dirname7, join as join26 } from "node:path";
var projectAt = (root, runtime) => {
  const abs = (relative7) => toAbsolutePath(join26(root, ...relative7.split("/")));
  return {
    root,
    runtime,
    abs,
    read: (relative7) => {
      const text6 = runtime.readText(abs(relative7));
      return text6.ok ? text6.value : void 0;
    },
    exists: (relative7) => runtime.stat(abs(relative7)) !== void 0,
    isDir: (relative7) => runtime.stat(abs(relative7))?.kind === "dir"
  };
};
var findGitRoot = (start, runtime) => {
  let current = start;
  for (; ; ) {
    if (runtime.stat(toAbsolutePath(join26(current, ".git"))) !== void 0) return toAbsolutePath(current);
    const parent = dirname7(current);
    if (parent === current) return void 0;
    current = parent;
  }
};

// src/install/session.ts
var openProject = (ctx) => {
  const root = findGitRoot(ctx.cwd, ctx.runtime);
  return { project: projectAt(root ?? ctx.cwd, ctx.runtime), gitRoot: root !== void 0 };
};
var problem = (code, messageKey, fix, exitCode, params2) => ({
  code,
  messageKey,
  params: params2,
  fix,
  exitCode
});
var planProblem = (error) => {
  if (error.kind === "bundle") {
    return problem("install_failed", "error.install_failed", "npx finitemonkey@latest init", ExitCode.NotConfigured, {
      path: ".finitemonkey/runtime/dist/finitemonkey.mjs",
      detail: error.detail
    });
  }
  return error.kind === "settings" ? problem(
    "settings_unreadable",
    "error.settings_unreadable",
    "fix the JSON in .claude/settings.json, then run finitemonkey init again",
    ExitCode.NotConfigured,
    { detail: error.detail }
  ) : problem(
    "lock_unreadable",
    "error.lock_unreadable",
    "finitemonkey uninstall --purge --yes",
    ExitCode.NotConfigured,
    { detail: error.detail }
  );
};
var applyProblem = (failure4) => failure4.detail.startsWith("locked:") ? problem(
  "install_locked",
  "error.install_locked",
  "wait for the other finitemonkey run to finish, then try again",
  ExitCode.CheckFailed,
  { path: failure4.path }
) : problem("install_failed", "error.install_failed", "finitemonkey doctor", ExitCode.NotConfigured, {
  path: failure4.path,
  detail: failure4.detail
});
var notInstalled = () => problem("not_installed", "error.not_installed", "finitemonkey init", ExitCode.NotConfigured, {});
var confirmProblem = (command, question, fix) => problem("needs_confirmation", "error.needs_confirmation", fix, ExitCode.NeedsPerson, { command, question });
var invalidPreset = (raw) => problem("invalid_arguments", "error.invalid_preset", "finitemonkey init --preset neutral", ExitCode.Usage, {
  preset: raw
});
var selfBundle = (ctx) => {
  if (!isBundlePath(ctx.runtime.selfPath)) return void 0;
  const text6 = ctx.runtime.readText(ctx.runtime.selfPath);
  return text6.ok ? text6.value : void 0;
};
var planInputFor = (ctx, preset, bin, marketplace) => ({
  preset,
  lang: ctx.lang,
  bin,
  version: ctx.version,
  marketplace,
  bundle: selfBundle(ctx),
  env: ctx.env,
  t: ctx.t
});

// src/task/trust.ts
var trustImplicit = (runtime, root, files) => {
  const paths = fmPaths(root);
  const hash = contractHash(implicitContract(files));
  const trust2 = readTrust(runtime, paths);
  const written = writeTrust(runtime, paths, { ...trust2, contracts: { ...trust2.contracts, [IMPLICIT_ID]: hash } });
  return written.ok ? hash : void 0;
};

// src/commands/init.ts
var flagsFor = (request, preset) => [
  `finitemonkey ${request.mode} --yes`,
  ...request.mode === "init" && preset !== "neutral" ? [`--preset ${preset}`] : [],
  ...request.bin === void 0 ? [] : [`--bin "${request.bin}"`],
  ...request.marketplace ? ["--marketplace"] : []
].join(" ");
var presentPlan = (ctx, request, plan) => {
  const data = planData(ctx.t, plan, request.mode, false, void 0);
  const human2 = planLines(ctx.t, data, request.showDiff || ctx.dryRun);
  if (ctx.dryRun) return success(data, [...human2, ctx.t("install.dry_run")]);
  if (!needsWrite(plan)) return success(data, [...human2, ctx.t("install.nothing_to_do")]);
  const next2 = flagsFor(request, plan.preset);
  const problem3 = confirmProblem(request.mode, ctx.t("install.confirm_question"), next2);
  return { ...failureFrom(ctx.t, { ...problem3, data }, human2), next: next2 };
};
var applyAndReport = (ctx, request, plan) => {
  const project = openProject(ctx).project;
  const applied = applyPlan(project, plan, ctx.version);
  if (!applied.ok) return failureFrom(ctx.t, applyProblem(applied.error));
  trustImplicit(ctx.runtime, project.root, project);
  const data = planData(ctx.t, plan, request.mode, true, applied.value.backup);
  const done = ctx.t(request.mode === "init" ? "install.done_init" : "install.done_update");
  return success(data, [...planLines(ctx.t, data, request.showDiff), done]);
};
var runInstall = (ctx, request, presetFallback) => {
  const preset = request.preset === void 0 ? presetFallback : parsePreset(request.preset);
  if (preset === void 0) return failureFrom(ctx.t, invalidPreset(request.preset ?? ""));
  const { project, gitRoot: gitRoot2 } = openProject(ctx);
  const previous = readPreviousLock(project);
  if (!previous.ok) return failureFrom(ctx.t, planProblem(previous.error));
  const input = planInputFor(ctx, preset, request.bin, request.marketplace);
  const plan = buildPlan(project, detect(project, gitRoot2, input), input, previous.value);
  if (!plan.ok) return failureFrom(ctx.t, planProblem(plan.error));
  if (ctx.dryRun || !ctx.yes || !needsWrite(plan.value)) return presentPlan(ctx, request, plan.value);
  return applyAndReport(ctx, request, plan.value);
};
var initRequest = (args) => ({
  mode: "init",
  preset: stringOption(args.values, "preset"),
  bin: stringOption(args.values, "bin"),
  marketplace: args.values["marketplace"] === true,
  showDiff: false
});
var initCommand = {
  path: ["init"],
  summaryKey: "command.init.summary",
  usage: "finitemonkey init [--preset neutral|gabriel] [--bin <path>] [--marketplace] [--dry-run] [--yes]",
  status: "ready",
  options: {
    preset: { type: "string" },
    bin: { type: "string" },
    marketplace: { type: "boolean" }
  },
  run: (ctx, args) => Promise.resolve(runInstall(ctx, initRequest(args), "neutral"))
};

// src/commands/secrets-problems.ts
var baselineInvalid = (detail) => ({
  code: "secrets_baseline_invalid",
  messageKey: "secrets.error.baseline_invalid",
  params: { file: BASELINE_FILE2, detail },
  fix: `git checkout -- ${BASELINE_FILE2}`,
  exitCode: ExitCode.NotConfigured
});
var writeFailed = (file, detail) => ({
  code: "secrets_write_failed",
  messageKey: "secrets.error.write_failed",
  params: { file, detail },
  fix: "finitemonkey doctor",
  exitCode: ExitCode.Internal
});
var gitUnavailable = (detail) => ({
  code: "secrets_git_unavailable",
  messageKey: "secrets.error.git_unavailable",
  params: { detail },
  fix: "finitemonkey doctor",
  exitCode: ExitCode.NotConfigured
});

// src/commands/secrets-accept.ts
var DAY_MS = 864e5;
var daysOf = (values) => {
  const raw = stringOption(values, "days");
  if (raw === void 0) return EXCEPTION_MAX_DAYS;
  const days = Number.parseInt(raw, 10);
  return Number.isInteger(days) && days > 0 && days <= EXCEPTION_MAX_DAYS ? days : void 0;
};
var plusDays = (iso, days) => new Date(Date.parse(iso) + days * DAY_MS).toISOString();
var failure3 = (ctx, problem3) => failureFrom(ctx.t, problem3);
var inputProblem = (ctx, id, reason, days) => {
  const fix = "finitemonkey secrets accept <id> --reason <why> [--days 1-90] [--false-positive]";
  if (!isPerson(ctx)) {
    return needsPersonProblem("secrets.error.person_only", fix, { action: ctx.t("secrets.action.accept") });
  }
  if (id === "") return usageProblem("invalid_arguments", "error.invalid_arguments", fix, { detail: "<id>" });
  if (reason === void 0 || reason.trim() === "") {
    return usageProblem("invalid_arguments", "secrets.error.reason_required", fix);
  }
  if (days === void 0) {
    return usageProblem("invalid_arguments", "error.invalid_arguments", fix, {
      detail: `--days 1-${String(EXCEPTION_MAX_DAYS)}`
    });
  }
  return void 0;
};
var entryOf3 = (ctx, finding2, args) => {
  const now = ctx.runtime.now();
  return {
    id: finding2.id,
    rule: finding2.ruleId,
    file: finding2.file,
    line: finding2.line,
    fingerprint: finding2.fingerprint,
    state: args.falsePositive ? "falso-positivo" : "aceito",
    owner: personName(ctx),
    reason: args.reason,
    acceptedAt: now,
    expiresAt: plusDays(now, args.days)
  };
};
var acceptEntry = (ctx, args) => {
  const root = projectRoot(ctx);
  const baseline = loadBaseline(ctx.runtime, root);
  if (!baseline.ok) {
    return failure3(ctx, baselineInvalid(baseline.error));
  }
  const scanned = scanPath(ctx.runtime, root, ".");
  const finding2 = scanned.ok ? scanned.value.find((item) => item.id === args.id) : void 0;
  if (finding2 === void 0) {
    return failure3(
      ctx,
      usageProblem("secrets_finding_not_found", "secrets.error.finding_not_found", "finitemonkey secrets scan", {
        id: args.id
      })
    );
  }
  const entry2 = entryOf3(ctx, finding2, args);
  const entries = [...baseline.value.entries.filter((item) => item.id !== entry2.id), entry2];
  const saved = saveBaseline(ctx.runtime, root, { schema: baseline.value.schema, entries });
  if (!saved.ok) {
    return failure3(ctx, writeFailed(BASELINE_FILE2, saved.error));
  }
  const line2 = ctx.t("secrets.accept.done", {
    id: entry2.id,
    rule: entry2.rule,
    where: whereOf(finding2),
    state: entry2.state,
    expires: entry2.expiresAt.slice(0, 10),
    owner: entry2.owner
  });
  return success(entry2, [line2]);
};
var secretsAcceptCommand = {
  path: ["secrets", "accept"],
  summaryKey: "secrets.command.accept",
  usage: "finitemonkey secrets accept <finding-id> --reason <why> [--days 1-90] [--false-positive]",
  status: "ready",
  maxPositionals: 1,
  options: { reason: { type: "string" }, days: { type: "string" }, "false-positive": { type: "boolean" } },
  run: (ctx, args) => {
    const id = args.positionals[0] ?? "";
    const reason = stringOption(args.values, "reason");
    const days = daysOf(args.values);
    const problem3 = inputProblem(ctx, id, reason, days);
    if (problem3 !== void 0 || reason === void 0 || days === void 0) {
      return Promise.resolve(
        failure3(
          ctx,
          problem3 ?? usageProblem("invalid_arguments", "secrets.error.reason_required", "finitemonkey help secrets accept")
        )
      );
    }
    return Promise.resolve(
      acceptEntry(ctx, { id, reason, days, falsePositive: args.values["false-positive"] === true })
    );
  }
};

// src/commands/secrets-incident.ts
var INCIDENT_ACTIONS = ["list", "rotated", "close", "purge"];
var USAGE = "finitemonkey secrets incident [list | rotated <id> | close <id> | purge <id>]";
var TARGET = { rotated: "rotacionado", close: "fechado" };
var PURGE_STEPS = [
  "secrets.purge.step1",
  "secrets.purge.step2",
  "secrets.purge.step3",
  "secrets.purge.step4",
  "secrets.purge.step5"
];
var fail2 = (ctx, problem3) => failureFrom(ctx.t, problem3);
var notFound2 = (ctx, id) => fail2(
  ctx,
  usageProblem("secrets_incident_not_found", "secrets.error.incident_not_found", `finitemonkey secrets incident`, {
    id
  })
);
var itemLine = (ctx, incident) => ctx.t("secrets.incident.item", {
  id: incident.id,
  state: incident.state,
  rule: incident.rule,
  where: incident.where,
  created: incident.createdAt.slice(0, 10)
});
var list2 = (ctx, root) => {
  const incidents = listIncidents(ctx.runtime, root);
  const human2 = incidents.length === 0 ? [ctx.t("secrets.incident.none")] : [ctx.t("secrets.incident.title", { count: incidents.length }), ...incidents.map((item) => itemLine(ctx, item))];
  return success({ schema: "finitemonkey/secrets-incidents@1", incidents }, human2);
};
var notRotated = (ctx, incident) => fail2(ctx, {
  code: "secrets_not_rotated",
  messageKey: "secrets.error.not_rotated",
  params: { id: incident.id, state: incident.state },
  fix: `finitemonkey secrets incident rotated ${incident.id}`,
  exitCode: ExitCode.NeedsPerson
});
var move = (ctx, root, incident, action) => {
  const to = TARGET[action];
  if (!isPerson(ctx)) {
    return fail2(
      ctx,
      needsPersonProblem("secrets.error.person_only", `finitemonkey secrets incident ${action} ${incident.id}`, {
        action: ctx.t(`secrets.action.${action}`)
      })
    );
  }
  if (!canMove(incident.state, to))
    return action === "close" ? notRotated(ctx, incident) : fail2(
      ctx,
      usageProblem("invalid_arguments", "secrets.error.bad_transition", USAGE, {
        id: incident.id,
        from: incident.state,
        to
      })
    );
  const moved = moveIncident(incident, to, ctx.runtime.now(), personName(ctx));
  const saved = saveIncident(ctx.runtime, root, moved);
  if (!saved.ok) {
    return fail2(ctx, writeFailed(incident.id, saved.error));
  }
  return success(moved, [ctx.t("secrets.incident.marked", { id: moved.id, state: moved.state })]);
};
var purge = (ctx, incident) => {
  if (!isRotated(incident)) return notRotated(ctx, incident);
  const params2 = { id: incident.id, where: incident.where, commit: incident.firstCommit ?? "?" };
  const steps = PURGE_STEPS.map((key) => ctx.t(key, params2));
  return success({ id: incident.id, state: incident.state, steps }, [ctx.t("secrets.purge.title", params2), ...steps]);
};
var actionOf = (raw) => INCIDENT_ACTIONS.find((action) => action === (raw ?? "list"));
var secretsIncidentCommand = {
  path: ["secrets", "incident"],
  summaryKey: "secrets.command.incident",
  usage: USAGE,
  status: "ready",
  maxPositionals: 2,
  run: (ctx, args) => {
    const action = actionOf(args.positionals[0]);
    const root = projectRoot(ctx);
    if (action === void 0)
      return Promise.resolve(
        fail2(
          ctx,
          usageProblem("invalid_arguments", "error.invalid_arguments", USAGE, { detail: args.positionals[0] ?? "" })
        )
      );
    if (action === "list") return Promise.resolve(list2(ctx, root));
    const id = args.positionals[1] ?? "";
    const incident = readIncident(ctx.runtime, root, id);
    if (!incident.ok) return Promise.resolve(notFound2(ctx, id));
    return Promise.resolve(action === "purge" ? purge(ctx, incident.value) : move(ctx, root, incident.value, action));
  }
};

// src/commands/secrets-scan.ts
var SECRETS_SCAN_SCHEMA = "finitemonkey/secrets-scan@1";
var view = (finding2, status) => ({
  id: finding2.id,
  rule: finding2.ruleId,
  severity: finding2.severity,
  file: finding2.file,
  line: finding2.line,
  column: finding2.column,
  fingerprint: finding2.fingerprint,
  mask: maskToken(finding2),
  status,
  ...finding2.commit === void 0 ? {} : { commit: finding2.commit }
});
var modeOf2 = (values) => {
  const chosen = [values["staged"] === true, values["history"] === true, stringOption(values, "path") !== void 0];
  if (chosen.filter(Boolean).length > 1) return void 0;
  if (chosen[0] === true) return "staged";
  return chosen[1] === true ? "history" : "path";
};
var normalizedTarget = (target) => target.replace(/\\/g, "/").replace(/^\.\/?/, "").replace(/\/$/, "");
var scopeOf = (target) => {
  const prefix = normalizedTarget(target);
  return (file) => prefix === "" || file === prefix || file.startsWith(`${prefix}/`);
};
var runScan = async (ctx, root, mode, target) => {
  if (mode === "staged") return scanStaged(ctx.runtime, root);
  if (mode === "history") return scanHistory(ctx.runtime, root);
  return scanPath(ctx.runtime, root, normalizedTarget(target) || ".");
};
var historyIncidents = (ctx, root, fresh3) => fresh3.flatMap((finding2) => {
  if (ruleById(finding2.ruleId)?.kind !== "credential") return [];
  const draft = {
    rule: finding2.ruleId,
    fingerprint: finding2.fingerprint,
    where: whereOf(finding2),
    source: "history",
    state: "aberto",
    ...finding2.commit === void 0 ? {} : { firstCommit: finding2.commit }
  };
  const saved = recordIncident(ctx.runtime, root, draft, HOOK_ACTOR);
  return saved.ok ? [saved.value.id] : [];
});
var dataOf = (mode, outcome, incidents) => {
  const findings = [
    ...outcome.fresh.map((finding2) => view(finding2, "new")),
    ...outcome.known.map((finding2) => view(finding2, "known")),
    ...outcome.expired.map((finding2) => view(finding2, "expired"))
  ];
  return {
    schema: SECRETS_SCAN_SCHEMA,
    mode,
    baseline: BASELINE_FILE2,
    findings,
    fixed: outcome.fixed.map((entry2) => entry2.id),
    incidents,
    summary: {
      total: findings.length,
      new: outcome.fresh.length,
      known: outcome.known.length,
      expired: outcome.expired.length,
      fixed: outcome.fixed.length
    }
  };
};
var humanOf2 = (ctx, data) => [
  ctx.t("secrets.scan.title", { mode: data.mode, ...data.summary }),
  ...data.findings.map(
    (item) => ctx.t("secrets.scan.item", {
      status: item.status,
      rule: item.rule,
      where: `${item.file}:${String(item.line)}`,
      id: item.id,
      mask: item.mask
    })
  ),
  ...data.summary.total === 0 ? [ctx.t("secrets.scan.clean")] : []
];
var resultOf2 = (ctx, data) => {
  const human2 = humanOf2(ctx, data);
  const failing = data.summary.new + data.summary.expired;
  if (failing === 0) return success(data, human2);
  return failureFrom(
    ctx.t,
    {
      code: "secrets_found",
      messageKey: "secrets.error.found",
      params: { count: failing },
      fix: "finitemonkey secrets accept <id> --reason <why>",
      exitCode: ExitCode.CheckFailed,
      data
    },
    human2
  );
};
var prune = (ctx, root, baseline, outcome) => {
  if (outcome.fixed.length > 0) saveBaseline(ctx.runtime, root, withoutFixed(baseline, outcome.fixed));
};
var secretsScanCommand = {
  path: ["secrets", "scan"],
  summaryKey: "secrets.command.scan",
  usage: "finitemonkey secrets scan [--staged | --history | --path <dir>] [--json]",
  status: "ready",
  options: { staged: { type: "boolean" }, history: { type: "boolean" }, path: { type: "string" } },
  run: async (ctx, args) => {
    const mode = modeOf2(args.values);
    const fix = "finitemonkey help secrets scan";
    if (mode === void 0) return failureFrom(ctx.t, usageProblem("invalid_arguments", "secrets.error.one_mode", fix));
    const root = projectRoot(ctx);
    const target = stringOption(args.values, "path") ?? ".";
    const scanned = await runScan(ctx, root, mode, target);
    if (!scanned.ok) return failureFrom(ctx.t, gitUnavailable(scanned.error));
    const baseline = loadBaseline(ctx.runtime, root);
    if (!baseline.ok) return failureFrom(ctx.t, baselineInvalid(baseline.error));
    const outcome = ratchet(
      scanned.value,
      baseline.value,
      ctx.runtime.now(),
      mode === "path" ? scopeOf(target) : void 0
    );
    if (mode === "path") prune(ctx, root, baseline.value, outcome);
    const incidents = mode === "history" ? historyIncidents(ctx, root, outcome.fresh) : [];
    return resultOf2(ctx, dataOf(mode, outcome, incidents));
  }
};

// src/task/create.ts
import { join as join27 } from "node:path";

// src/core/yaml/write.ts
var PLAIN_SAFE = /^[A-Za-z_./][A-Za-z0-9_./ ()-]*$/;
var RESERVED2 = /^(true|false|null|~|-?\d.*)$/;
var scalarText = (value) => {
  if (value === null) return "null";
  if (typeof value !== "string") return String(value);
  return PLAIN_SAFE.test(value) && !RESERVED2.test(value) && !value.endsWith(" ") ? value : JSON.stringify(value);
};
var isScalar = (value) => value === null || typeof value !== "object";
var inline2 = (value) => {
  if (isScalar(value)) return scalarText(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value.every(isScalar) ? `[${value.map(scalarText).join(", ")}]` : void 0;
  }
  return Object.keys(value).length === 0 ? "{}" : void 0;
};
var lines2 = (value, indent) => {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const flat = inline2(item);
      if (flat !== void 0) return [`${indent}- ${flat}`];
      const [head = "", ...rest] = lines2(item, `${indent}  `);
      return [`${indent}- ${head.trimStart()}`, ...rest];
    });
  }
  if (isScalar(value)) return [`${indent}${scalarText(value)}`];
  return Object.entries(value).flatMap(([key, item]) => {
    const flat = inline2(item);
    const name = scalarText(key);
    return flat === void 0 ? [`${indent}${name}:`, ...lines2(item, `${indent}  `)] : [`${indent}${name}: ${flat}`];
  });
};
var stringifyYaml = (value) => `${lines2(value, "").join("\n")}
`;

// src/task/serialize.ts
var checkYaml = (check2) => ({
  id: check2.id,
  check: check2.kind,
  ...check2.run === void 0 ? {} : { run: check2.run },
  ...check2.timeoutS === void 0 ? {} : { timeout_s: check2.timeoutS },
  ...check2.require === void 0 ? {} : { require: [...check2.require] },
  ...check2.requireOpen === void 0 ? {} : { require_open: check2.requireOpen },
  ...check2.description === void 0 ? {} : { description: check2.description }
});
var contractYaml = (contract) => ({
  id: contract.id,
  goal: contract.goal,
  size: contract.size,
  ...contract.base === void 0 ? {} : { base: contract.base },
  scope: {
    paths: [...contract.scope.paths],
    ...contract.scope.diffBudget === void 0 ? {} : { diff_budget: { ...contract.scope.diffBudget } },
    tests_protected: contract.scope.testsProtected
  },
  acceptance: contract.acceptance.map(checkYaml),
  decisions_needed: [...contract.decisionsNeeded]
});
var contractJson = (contract) => ({
  id: contract.id,
  goal: contract.goal,
  size: contract.size,
  base: contract.base ?? null,
  implicit: contract.implicit,
  scope: {
    paths: contract.scope.paths,
    diffBudget: contract.scope.diffBudget ?? null,
    testsProtected: contract.scope.testsProtected
  },
  acceptance: contract.acceptance.map((check2) => ({ ...check2 })),
  decisionsNeeded: contract.decisionsNeeded
});

// src/task/create.ts
var explicitChecks = (draft) => [
  ...draft.runs.map((run3, index) => ({ id: `C${String(index + 1)}`, kind: "command", run: run3 })),
  draft.tests === void 0 ? { id: "tests", kind: "tests" } : { id: "tests", kind: "tests", run: draft.tests }
];
var draftChecks = (runtime, paths, draft) => {
  const disk = {
    read: (relative7) => {
      const text6 = runtime.readText(toAbsolutePath(join27(paths.root, relative7)));
      return text6.ok ? text6.value : void 0;
    },
    exists: (relative7) => runtime.stat(toAbsolutePath(join27(paths.root, relative7))) !== void 0
  };
  const detected = detectChecks(disk);
  const base = draft.runs.length > 0 || draft.tests !== void 0 ? explicitChecks(draft) : detected;
  const hasTests = base.some((check2) => check2.kind === "tests");
  return [
    ...base,
    ...hasTests ? [] : [{ id: "tests", kind: "tests" }],
    { id: "placeholders", kind: "placeholders" },
    { id: "secrets", kind: "secrets" },
    { id: "worktree", kind: "worktree" },
    { id: "merge", kind: "merge" },
    ...draft.paths.length > 0 || draft.budget !== void 0 ? [{ id: "diff", kind: "diff" }] : [],
    ...draft.git.length > 0 ? [{ id: "git", kind: "git", require: draft.git }] : [],
    { id: "pr", kind: "pr", requireOpen: draft.git.includes("pr_open") },
    ...draft.manual.map((description, index) => ({
      id: `M${String(index + 1)}`,
      kind: "manual",
      description
    }))
  ];
};
var createTask = (runtime, paths, draft) => {
  if (runtime.stat(paths.task(draft.id)) !== void 0) return reject({ kind: "exists", id: draft.id });
  const shape = {
    id: draft.id,
    goal: draft.goal,
    size: draft.size,
    ...draft.base === void 0 ? {} : { base: draft.base },
    scope: {
      paths: draft.paths,
      testsProtected: true,
      ...draft.budget === void 0 ? {} : { diffBudget: draft.budget }
    },
    acceptance: draftChecks(runtime, paths, draft),
    decisionsNeeded: [],
    implicit: false
  };
  const text6 = stringifyYaml(contractYaml(shape));
  const valid = validateContract(contractYaml(shape));
  if (!valid.ok) return reject({ kind: "invalid", issues: valid.error });
  const wrote = runtime.writeText(paths.task(draft.id), text6);
  if (!wrote.ok) return reject({ kind: "write", detail: wrote.error });
  const lock = readTrust(runtime, paths);
  writeTrust(runtime, paths, {
    ...lock,
    contracts: { ...lock.contracts, [draft.id]: contractHash(valid.value) },
    approved: { ...lock.approved, [draft.id]: text6 }
  });
  writeState(runtime, paths, { ...readState(runtime, paths), active: draft.id });
  return accept({ contract: valid.value, text: text6 });
};

// src/commands/task.ts
var problem2 = (code, messageKey, fix, params2 = {}, exitCode = ExitCode.Usage) => ({
  code,
  messageKey,
  params: params2,
  fix,
  exitCode
});
var projectOf = (ctx) => {
  const root = gitRoot(gitAt(ctx.runtime, ctx.cwd));
  return root === void 0 ? void 0 : fmPaths(root);
};
var noRepo = (ctx) => failureFrom(ctx.t, problem2("not_a_git_repo", "error.not_a_git_repo", "git init", {}, ExitCode.NotConfigured));
var list3 = (values, name) => {
  const value = values[name];
  const raw = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return raw.filter((item) => typeof item === "string" && item.trim() !== "");
};
var csv = (values, name) => list3(values, name).flatMap((item) => item.split(",").map((part2) => part2.trim())).filter((part2) => part2 !== "");
var positive2 = (values, name) => {
  const parsed = Number.parseInt(stringOption(values, name) ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : void 0;
};
var draftFrom = (ctx, paths, id, values) => {
  const files = positive2(values, "budget-files");
  const lines3 = positive2(values, "budget-lines");
  const size = SIZES.find((item) => item === stringOption(values, "size")) ?? "S";
  return {
    id,
    goal: stringOption(values, "goal") ?? id,
    size,
    base: headSha(gitAt(ctx.runtime, paths.root)),
    paths: csv(values, "paths"),
    runs: list3(values, "run"),
    tests: stringOption(values, "tests"),
    git: csv(values, "git").filter((item) => GIT_REQUIREMENTS.some((known2) => known2 === item)),
    manual: list3(values, "manual"),
    budget: files === void 0 && lines3 === void 0 ? void 0 : { ...files === void 0 ? {} : { files }, ...lines3 === void 0 ? {} : { lines: lines3 } }
  };
};
var createFailure = (ctx, failure4) => {
  if (failure4.kind === "exists") {
    return failureFrom(
      ctx.t,
      problem2("task_exists", "error.task_exists", `finitemonkey task show ${failure4.id}`, { task: failure4.id })
    );
  }
  const detail = failure4.kind === "invalid" ? failure4.issues.join("; ") : failure4.detail;
  return failureFrom(ctx.t, problem2("task_invalid", "error.task_invalid", "finitemonkey help task new", { detail }));
};
var newTask = (ctx, id, values) => {
  if (id === void 0)
    return failureFrom(
      ctx.t,
      problem2("invalid_arguments", "error.invalid_arguments", "finitemonkey help task new", { detail: "missing <id>" })
    );
  const paths = projectOf(ctx);
  if (paths === void 0) return noRepo(ctx);
  const created3 = createTask(ctx.runtime, paths, draftFrom(ctx, paths, id, values));
  if (!created3.ok) return createFailure(ctx, created3.error);
  const data = {
    schema: TASK_SCHEMA,
    file: paths.task(id),
    active: true,
    contract: contractJson(created3.value.contract)
  };
  return {
    ...success(data, [ctx.t("task.created", { task: id, file: paths.task(id) }), created3.value.text.trimEnd()]),
    next: "finitemonkey gate"
  };
};
var showTask = (ctx, id) => {
  const paths = projectOf(ctx);
  if (paths === void 0) return noRepo(ctx);
  const active = readState(ctx.runtime, paths).active;
  const target = id ?? active;
  const report2 = currentReport(ctx.runtime, paths, void 0, target);
  if (report2 === void 0) {
    return failureFrom(
      ctx.t,
      problem2(
        "task_not_found",
        "error.task_not_found",
        "finitemonkey task new <id> --goal <text>",
        { task: target ?? "-" },
        ExitCode.NotConfigured
      )
    );
  }
  return success({ schema: TASK_SCHEMA, active: active ?? null, report: report2 }, reportLines(ctx.t, report2));
};
var doneTask = (ctx, id) => {
  const paths = projectOf(ctx);
  if (paths === void 0) return noRepo(ctx);
  const target = id ?? readState(ctx.runtime, paths).active;
  const run3 = runGate({
    runtime: ctx.runtime,
    cwd: ctx.cwd,
    env: ctx.env,
    sessionId: void 0,
    budgetMs: DEFAULT_GATE_BUDGET_MS,
    fast: false,
    noSkip: true,
    ...target === void 0 ? {} : { taskId: target }
  });
  const result = runResult(ctx, run3, true);
  if (!result.ok || run3.kind !== "done" || run3.report.implicit) return result;
  writeState(ctx.runtime, paths, closeTask(readState(ctx.runtime, paths), run3.report.task));
  return { ...result, human: [...result.human ?? [], ctx.t("task.done", { task: run3.report.task })] };
};
var TASK_OPTIONS = {
  goal: { type: "string" },
  size: { type: "string" },
  paths: { type: "string", multiple: true },
  run: { type: "string", multiple: true },
  tests: { type: "string" },
  git: { type: "string" },
  manual: { type: "string", multiple: true },
  "budget-files": { type: "string" },
  "budget-lines": { type: "string" }
};
var taskNewCommand = {
  path: ["task", "new"],
  summaryKey: "command.task_new.summary",
  usage: "finitemonkey task new <id> --goal <text> [--size S|M|L] [--paths <globs>] [--run <cmd>]... [--tests <cmd>] [--git committed,pushed,pr_open] [--manual <text>]...",
  status: "ready",
  options: TASK_OPTIONS,
  maxPositionals: 1,
  run: (ctx, args) => Promise.resolve(newTask(ctx, args.positionals[0], args.values))
};
var taskShowCommand = {
  path: ["task", "show"],
  summaryKey: "command.task_show.summary",
  usage: "finitemonkey task show [<id>]",
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) => Promise.resolve(showTask(ctx, args.positionals[0]))
};
var taskDoneCommand = {
  path: ["task", "done"],
  summaryKey: "command.task_done.summary",
  usage: "finitemonkey task done [<id>]",
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) => Promise.resolve(doneTask(ctx, args.positionals[0]))
};

// src/install/uninstall.ts
var structural = (entry2, current) => {
  if (entry2.kind === "gitignore") {
    const text6 = withoutBlock(current);
    return text6 === "" && !entry2.existed ? void 0 : text6;
  }
  const parsed = parseSettings(current);
  if (!parsed.ok || entry2.added === void 0) return current;
  const settings = unmergeSettings(parsed.value, entry2.added, entry2.handlers ?? []);
  return Object.keys(settings).length === 0 && !entry2.existed ? void 0 : renderJson(settings, styleOf(current));
};
var unchanged = (project, entry2) => {
  if (!entry2.existed) return { path: entry2.path, action: "delete", after: void 0 };
  const original = entry2.backup === void 0 ? void 0 : project.read(entry2.backup);
  return original === void 0 ? void 0 : { path: entry2.path, action: "restore", after: original };
};
var removalFor = (project, entry2, options) => {
  const current = project.read(entry2.path);
  if (current === void 0) return { path: entry2.path, action: "gone", after: void 0 };
  if (entry2.kind === "generated" && options.keepGenerated) {
    return { path: entry2.path, action: "keep-generated", after: current };
  }
  if (hashText(current) === entry2.hash) {
    const exact2 = unchanged(project, entry2);
    if (exact2 !== void 0) return exact2;
  }
  if (entry2.kind === "generated") return { path: entry2.path, action: "keep-edited", after: current };
  const after = structural(entry2, current);
  return { path: entry2.path, action: after === void 0 ? "delete" : "unmerge", after };
};
var planRemoval = (project, lock, options) => ({
  items: lock.entries.map((entry2) => removalFor(project, entry2, options)),
  purge: options.purge,
  removeDirs: lock.createdDirs.filter((dir) => dir !== STATE_DIR)
});
var applyItem = (project, item) => {
  if (item.action === "delete") {
    const removed = project.runtime.remove(project.abs(item.path));
    return removed.ok ? removed : reject({ path: item.path, detail: removed.error });
  }
  if (item.after === void 0 || item.action === "gone" || item.action.startsWith("keep")) return accept(void 0);
  return writeText(project, item.path, item.after);
};
var isEmptyDir = (project, relative7) => {
  const listed3 = project.runtime.listDir(project.abs(relative7));
  return listed3.ok && listed3.value.length === 0;
};
var finish2 = (project, plan) => {
  const target = plan.purge ? STATE_DIR : LOCK_FILE;
  const removed = project.runtime.remove(project.abs(target));
  if (!removed.ok) return reject({ path: target, detail: removed.error });
  for (const dir of plan.removeDirs) if (isEmptyDir(project, dir)) project.runtime.remove(project.abs(dir));
  return accept(void 0);
};
var applyRemoval = (project, plan) => {
  const changed = withInstallLock(project, () => {
    for (const item of plan.items) {
      const done = applyItem(project, item);
      if (!done.ok) return done;
    }
    return accept(void 0);
  });
  return changed.ok ? finish2(project, plan) : changed;
};

// src/commands/uninstall.ts
var UNINSTALL_SCHEMA = "finitemonkey/uninstall-plan@1";
var OUTSIDE = ["claude plugin uninstall finitemonkey@finitemonkey"];
var dataOf2 = (root, plan, applied) => ({
  schema: UNINSTALL_SCHEMA,
  applied,
  purge: plan.purge,
  root,
  actions: plan.items.map(({ path, action }) => ({ path, action })),
  kept: plan.items.filter((item) => item.action.startsWith("keep")).map(({ path }) => path),
  outside: OUTSIDE
});
var linesOf2 = (ctx, data) => [
  ctx.t("install.uninstall.title", { root: data.root }),
  ...data.actions.map(({ path, action }) => `  ${action.padEnd(15)}${path}`),
  ...data.purge ? [ctx.t("install.uninstall.purge")] : [ctx.t("install.uninstall.keeps_state")],
  ...data.kept.map((path) => ctx.t("install.warn.edited_kept", { path })),
  ctx.t("install.uninstall.outside", { command: OUTSIDE.join(", ") })
];
var fixFor = (args) => [
  "finitemonkey uninstall --yes",
  ...args.values["purge"] === true ? ["--purge"] : [],
  ...args.values["keep-generated"] === true ? ["--keep-generated"] : []
].join(" ");
var runUninstall = (ctx, args) => {
  const { project } = openProject(ctx);
  const lock = readPreviousLock(project);
  if (!lock.ok) return failureFrom(ctx.t, planProblem(lock.error));
  if (lock.value === void 0) return failureFrom(ctx.t, notInstalled());
  const options = { purge: args.values["purge"] === true, keepGenerated: args.values["keep-generated"] === true };
  const plan = planRemoval(project, lock.value, options);
  const preview = dataOf2(project.root, plan, false);
  if (ctx.dryRun) return success(preview, [...linesOf2(ctx, preview), ctx.t("install.dry_run")]);
  if (!ctx.yes) {
    const next2 = fixFor(args);
    const problem3 = confirmProblem("uninstall", ctx.t("install.uninstall.question"), next2);
    return { ...failureFrom(ctx.t, { ...problem3, data: preview }, linesOf2(ctx, preview)), next: next2 };
  }
  const removed = applyRemoval(project, plan);
  if (!removed.ok) return failureFrom(ctx.t, applyProblem(removed.error));
  const data = dataOf2(project.root, plan, true);
  return success(data, [...linesOf2(ctx, data), ctx.t("install.uninstall.done")]);
};
var uninstallCommand = {
  path: ["uninstall"],
  summaryKey: "command.uninstall.summary",
  usage: "finitemonkey uninstall [--purge] [--keep-generated] [--dry-run] [--yes]",
  status: "ready",
  options: { purge: { type: "boolean" }, "keep-generated": { type: "boolean" } },
  run: (ctx, args) => Promise.resolve(runUninstall(ctx, args))
};

// src/commands/update.ts
var check = (ctx, bin) => {
  const { project, gitRoot: gitRoot2 } = openProject(ctx);
  const previous = readPreviousLock(project);
  if (!previous.ok) return failureFrom(ctx.t, planProblem(previous.error));
  if (previous.value === void 0) return failureFrom(ctx.t, notInstalled());
  const input = planInputFor(ctx, previous.value.preset, bin, false);
  const plan = buildPlan(project, detect(project, gitRoot2, input), input, previous.value);
  if (!plan.ok) return failureFrom(ctx.t, planProblem(plan.error));
  const data = planData(ctx.t, plan.value, "update", false, void 0);
  const human2 = planLines(ctx.t, data, true);
  if (!hasChanges(plan.value)) return success(data, [...human2, ctx.t("install.up_to_date")]);
  return {
    ok: false,
    exitCode: ExitCode.CheckFailed,
    data,
    human: human2,
    error: { code: "install_outdated", message: ctx.t("error.install_outdated"), fix: "finitemonkey update --yes" }
  };
};
var runUpdate = (ctx, args) => {
  const bin = stringOption(args.values, "bin");
  if (args.values["check"] === true) return check(ctx, bin);
  const { project } = openProject(ctx);
  const previous = readPreviousLock(project);
  if (!previous.ok) return failureFrom(ctx.t, planProblem(previous.error));
  if (previous.value === void 0) return failureFrom(ctx.t, notInstalled());
  const preset = stringOption(args.values, "preset");
  const request = { mode: "update", preset, bin, marketplace: false, showDiff: true };
  return runInstall(ctx, request, previous.value.preset);
};
var updateCommand = {
  path: ["update"],
  summaryKey: "command.update.summary",
  usage: "finitemonkey update [--check] [--preset neutral|gabriel] [--bin <path>] [--yes]",
  status: "ready",
  options: { check: { type: "boolean" }, preset: { type: "string" }, bin: { type: "string" } },
  run: (ctx, args) => Promise.resolve(runUpdate(ctx, args))
};

// src/commands/version.ts
var versionCommand = {
  path: ["version"],
  summaryKey: "command.version.summary",
  usage: "finitemonkey version",
  status: "ready",
  run: (ctx) => {
    const data = { version: ctx.version, node: ctx.runtime.nodeVersion, platform: ctx.platform };
    return Promise.resolve(success(data, [ctx.version]));
  }
};

// src/commands/index.ts
var REGISTRY = [
  initCommand,
  doctorCommand,
  updateCommand,
  uninstallCommand,
  i18nCheckCommand,
  hookCommand,
  gateCommand,
  taskNewCommand,
  taskShowCommand,
  taskDoneCommand,
  secretsScanCommand,
  secretsAcceptCommand,
  secretsIncidentCommand,
  snapshotCommand,
  undoCommand,
  rescueCommand,
  mergeVerifyCommand,
  versionCommand,
  helpCommand
];

// src/core/suggest.ts
var distance = (a, b) => {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j] ?? 0;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(above + 1, (row[j - 1] ?? 0) + 1, diagonal + cost);
      diagonal = above;
    }
  }
  return row[b.length] ?? 0;
};
var closest = (input, candidates) => {
  const group = candidates.find((name) => name.startsWith(`${input} `));
  if (group !== void 0) return group;
  const limit = Math.max(1, Math.floor(input.length / 3));
  let best;
  for (const name of candidates) {
    const score = distance(input, name.split(" ")[0] ?? name);
    if (score <= limit && (best === void 0 || score < best.score)) best = { name, score };
  }
  return best?.name;
};

// src/core/dispatch.ts
var unknownCommand = (registry, attempted) => {
  const suggestion = closest(attempted, registry.map(commandName));
  return suggestion === void 0 ? usageProblem("unknown_command", "error.unknown_command", "finitemonkey help", { command: attempted }) : usageProblem("unknown_command", "error.unknown_command_suggest", `finitemonkey ${suggestion}`, {
    command: attempted,
    suggestion
  });
};
var failWith = (ctx, name, problem3) => ({
  name,
  execute: () => Promise.resolve(failureFrom(ctx.t, problem3))
});
var invoke = (ctx, argv, spec2, registry) => {
  const name = commandName(spec2);
  const args = strictArgs(argv, spec2);
  if (!args.ok) return failWith(ctx, name, args.error);
  return { name, execute: () => spec2.run(ctx, args.value, registry) };
};
var builtin = (registry, name) => registry.find((spec2) => commandName(spec2) === name);
var dispatch = (ctx, argv, loose, registry) => {
  const resolved = resolveCommand(registry, loose.positionals);
  const attempted = loose.positionals[0];
  if (resolved === void 0 && attempted !== void 0) {
    return failWith(ctx, attempted, unknownCommand(registry, attempted));
  }
  const wanted = loose.version && !loose.help ? "version" : "help";
  if (resolved === void 0 || loose.version && !loose.help) {
    const spec2 = builtin(registry, wanted);
    if (spec2 === void 0) return failWith(ctx, wanted, unknownCommand(registry, wanted));
    return { name: wanted, execute: () => spec2.run(ctx, { values: {}, positionals: [] }, registry) };
  }
  if (loose.help) return { name: "help", execute: () => Promise.resolve(helpFor(ctx, resolved.spec)) };
  return invoke(ctx, argv, resolved.spec, registry);
};

// src/core/output.ts
var ISSUES_URL = "https://github.com/gabrielvieiraf/finitemonkey/issues";
var resultFromThrown = (thrown, t) => {
  if (thrown instanceof FmError) return failureFrom(t, thrown.problem);
  const detail = thrown instanceof Error ? thrown.message : String(thrown);
  return failureFrom(t, {
    code: "internal_error",
    messageKey: "error.internal",
    params: { detail },
    fix: ISSUES_URL,
    exitCode: ExitCode.Internal
  });
};
var block3 = (items) => items.length > 0 ? `${items.join("\n")}
` : "";
var write2 = (sink, text6) => {
  if (text6 !== "") sink.write(maskText(text6));
};
var render = (ctx, command, result) => {
  if (result.raw !== void 0) {
    write2(ctx.io.stdout, result.raw.stdout);
    write2(ctx.io.stderr, result.raw.stderr);
    return;
  }
  if (ctx.json) {
    ctx.io.stdout.write(`${JSON.stringify(maskDeep(toEnvelope(command, result)))}
`);
    return;
  }
  write2(ctx.io.stdout, block3(result.human ?? []));
  if (!result.ok) {
    const { message, fix } = result.error;
    write2(ctx.io.stderr, block3([ctx.t("output.error", { message }), ctx.t("output.fix", { fix })]));
  }
  if (result.next !== void 0) write2(ctx.io.stdout, block3([ctx.t("output.next", { next: result.next })]));
};

// src/core/run.ts
var run2 = async (options) => {
  const loose = looseArgs(options.argv);
  const detected = detectLang(loose.lang, options.env);
  const t = createTranslator(detected.lang);
  const ctx = {
    lang: detected.lang,
    langSource: detected.source,
    t,
    json: loose.json,
    yes: loose.yes,
    dryRun: loose.dryRun,
    cwd: options.cwd,
    env: options.env,
    platform: options.platform,
    version: options.version,
    io: options.io,
    runtime: options.runtime
  };
  let name = loose.positionals[0] ?? "";
  let result;
  try {
    if (loose.lang !== void 0 && normalizeLang(loose.lang) === void 0) {
      const problem3 = usageProblem("invalid_lang", "error.invalid_lang", "finitemonkey --lang en", {
        lang: loose.lang,
        languages: LANGUAGES.join(", ")
      });
      result = failureFrom(t, problem3);
    } else {
      const dispatched = dispatch(ctx, options.argv, loose, options.registry ?? REGISTRY);
      name = dispatched.name;
      result = await dispatched.execute();
    }
  } catch (thrown) {
    result = resultFromThrown(thrown, t);
  }
  render(ctx, name, result);
  return result.exitCode;
};

// src/core/version.ts
import { fileURLToPath as fileURLToPath3 } from "node:url";
var UNKNOWN_VERSION = "0.0.0-unknown";
var VERSION_SOURCES = ["../package.json", "../.claude-plugin/plugin.json"];
var versionAt = (readText, moduleUrl, relative7) => {
  const text6 = readText(toAbsolutePath(fileURLToPath3(new URL(relative7, moduleUrl))));
  if (!text6.ok) return void 0;
  const parsed = parseJson(text6.value);
  if (!parsed.ok || !isRecord(parsed.value)) return void 0;
  const version = parsed.value["version"];
  return typeof version === "string" ? version : void 0;
};
var readPackageVersion = (readText, moduleUrl) => {
  for (const relative7 of VERSION_SOURCES) {
    const version = versionAt(readText, moduleUrl, relative7);
    if (version !== void 0) return version;
  }
  return UNKNOWN_VERSION;
};

// src/cli.ts
var flush = (stream) => new Promise((resolve2) => {
  stream.write("", () => {
    resolve2();
  });
});
var main = async () => {
  const runtime = nodeRuntime();
  const code = await run2({
    argv: process.argv.slice(2),
    env: process.env,
    cwd: toAbsolutePath(process.cwd()),
    platform: process.platform,
    io: { stdout: process.stdout, stderr: process.stderr, stdin: process.stdin },
    version: readPackageVersion(runtime.readText, import.meta.url),
    runtime
  });
  await Promise.all([flush(process.stdout), flush(process.stderr)]);
  process.exit(code);
};
if (isEntryPoint(import.meta.url, process.argv[1], nodeRealpath, process.platform)) await main();
export {
  main
};

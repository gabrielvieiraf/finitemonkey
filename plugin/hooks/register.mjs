// src/mod/state.ts
var MOD_STATE_SCHEMA = "finitemonkey/mod-state@1";
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var MODES = ["off", "shadow", "active"];
var TARGETS = ["path", "command"];
var compile = (pattern) => {
  try {
    return new RegExp(pattern);
  } catch {
    return void 0;
  }
};
var ruleOf = (value) => {
  if (!isRecord(value)) return void 0;
  const { id, target, pattern, reason } = value;
  const known = TARGETS.find((item) => item === target);
  if (typeof id !== "string" || known === void 0 || typeof pattern !== "string" || typeof reason !== "string")
    return void 0;
  const regex = compile(pattern);
  return regex === void 0 ? void 0 : { rule: { id, target: known, pattern, reason }, regex };
};
var dataOf = (parsed) => isRecord(parsed) && isRecord(parsed["data"]) ? parsed["data"] : parsed;
var parseModState = (text2) => {
  let parsed;
  try {
    parsed = JSON.parse(text2);
  } catch {
    return void 0;
  }
  const data = dataOf(parsed);
  if (!isRecord(data) || data["schema"] !== MOD_STATE_SCHEMA || typeof data["root"] !== "string") return void 0;
  const mode = MODES.find((item) => item === data["mode"]) ?? "shadow";
  const raw = Array.isArray(data["rules"]) ? data["rules"] : [];
  const rules = raw.map(ruleOf).filter((rule) => rule !== void 0);
  const failReason = data["failReason"];
  return { root: data["root"], mode, rules, ...typeof failReason === "string" ? { failReason } : {} };
};

// src/mod/tighten.ts
var FILE_TOOLS = /* @__PURE__ */ new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
var SHELL_TOOLS = /* @__PURE__ */ new Set(["Bash", "PowerShell"]);
var isRecord2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var text = (input, ...names) => {
  if (!isRecord2(input)) return void 0;
  for (const name of names) {
    const value = input[name];
    if (typeof value === "string" && value !== "") return value;
  }
  return void 0;
};
var posix = (path) => path.replaceAll("\\", "/");
var relativeTo = (root, path) => {
  const base = posix(root).replace(/\/+$/, "");
  const full = posix(path);
  const sameCase = /^[A-Za-z]:\//.test(base) ? full.toLowerCase().startsWith(`${base.toLowerCase()}/`) : false;
  if (full.startsWith(`${base}/`) || sameCase) return full.slice(base.length + 1);
  return full.replace(/^\.\//, "");
};
var firstMatch = (rules, value) => rules.find((rule) => rule.regex.test(value));
var ruleFor = (state, tool, input) => {
  if (FILE_TOOLS.has(tool)) {
    const path = text(input, "file_path", "notebook_path");
    if (path === void 0) return void 0;
    const rules = state.rules.filter((rule) => rule.rule.target === "path");
    return firstMatch(rules, relativeTo(state.root, path));
  }
  if (SHELL_TOOLS.has(tool)) {
    const command = text(input, "command");
    if (command === void 0) return void 0;
    return firstMatch(
      state.rules.filter((rule) => rule.rule.target === "command"),
      command
    );
  }
  return void 0;
};
var RANK = { allow: 0, ask: 1, deny: 2 };
var stricter = (decided, tightened) => RANK[tightened.decision] > RANK[decided.decision] ? tightened : decided;
var tightenFor = (rule) => ({
  decision: "deny",
  reason: rule.rule.reason
});
var FAILED_REASON = "finitemonkey: the mod's permission check failed, so this call was refused. Retry it; the command hooks still decide it.";

// src/mod/register.ts
var loaded;
function cliArgv($, args) {
  return ["node", `${$.plugin.root}/scripts/finitemonkey.mjs`, ...args];
}
async function refreshState($) {
  const root = await $.session.root();
  const result = await $.process.run(cliArgv($, ["mod", "state", "--json"]), { cwd: root, timeoutMs: 2e4 });
  if (result.exitCode !== 0) return;
  const state = parseModState(result.stdout);
  if (state !== void 0) loaded = state;
}
function scheduleRefresh($) {
  $.clock.after(0, () => refreshState($));
}
async function recordTightening($, rule, tool, mode) {
  const root = await $.session.root();
  await $.process.run(cliArgv($, ["mod", "record", "--rule", rule, "--tool", tool, "--mode", mode]), {
    cwd: root,
    timeoutMs: 2e4
  });
}
function scheduleRecord($, rule, tool, mode) {
  $.clock.after(0, () => recordTightening($, rule, tool, mode));
}
async function onStart($, e, next) {
  scheduleRefresh($);
  return next(e);
}
async function onTurnComplete($, e, next) {
  scheduleRefresh($);
  return next(e);
}
async function guardCheck($, e, next) {
  const decided = await next(e);
  const state = loaded;
  if (state === void 0 || state.mode === "off") return decided;
  const rule = ruleFor(state, e.tool, e.input);
  if (rule === void 0) return decided;
  scheduleRecord($, rule.rule.id, e.tool, state.mode);
  return state.mode === "active" ? stricter(decided, tightenFor(rule)) : decided;
}
async function failClosed() {
  return Promise.resolve({ decision: "deny", reason: loaded?.failReason ?? FAILED_REASON });
}
function register(on) {
  on("session.start", onStart);
  on("turn.complete", onTurnComplete);
  on("tool.check", guardCheck).catch(failClosed);
}
export {
  register
};

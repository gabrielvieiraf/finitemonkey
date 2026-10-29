// src/mod/memory.ts
var memory = { state: void 0, view: void 0, pending: void 0 };

// src/mod/attribution-hooks.ts
var KINDS = /* @__PURE__ */ new Set(["commit", "pr"]);
var attributionFor = (e, decided, attribution) => {
  if (attribution === void 0 || !KINDS.has(e.kind)) return decided;
  const base = attribution.forbid ? "" : decided.text;
  const trailer = e.kind === "commit" ? attribution.trailer : null;
  return { text: [base, trailer ?? ""].filter((part) => part !== "").join("\n") };
};
async function attributionText(_$, e, next) {
  return attributionFor(e, await next(e), memory.state?.attribution);
}

// src/mod/cli.ts
var CLI_TIMEOUT_MS = 2e4;
function cliArgv($, args) {
  return ["node", `${$.plugin.root}/scripts/finitemonkey.mjs`, ...args];
}
async function runCli($, args) {
  const root = await $.session.root();
  const result = await $.process.run(cliArgv($, args), { cwd: root, timeoutMs: CLI_TIMEOUT_MS });
  return result.exitCode === 0 ? result.stdout : void 0;
}

// src/mod/compose-hooks.ts
var RULES_SECTION = "finitemonkey:rules";
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var withRulesSection = (result, text2) => text2 === "" ? result : {
  sections: [
    ...result.sections.filter((section) => section.id !== RULES_SECTION),
    { id: RULES_SECTION, text: text2, scope: "session" }
  ]
};
var parseHandoff = (text2) => {
  let parsed;
  try {
    parsed = JSON.parse(text2);
  } catch {
    return void 0;
  }
  const data = isRecord(parsed) && isRecord(parsed["data"]) ? parsed["data"] : parsed;
  return isRecord(data) && data["schema"] === "finitemonkey/handoff@1" && typeof data["text"] === "string" ? data["text"] : void 0;
};
async function readHandoff($) {
  const text2 = await runCli($, ["handoff", "--json"]);
  return text2 === void 0 ? void 0 : parseHandoff(text2);
}
async function composeRules(_$, e, next) {
  return withRulesSection(await next(e), memory.state?.instructions ?? "");
}
async function compactNotes($, e, next) {
  if (e.agentId !== void 0) return next(e);
  const brief = await readHandoff($);
  if (brief === void 0 || brief === "") return next(e);
  const instructions = [e.instructions ?? "", brief].filter((part) => part !== "").join("\n\n");
  return next({ ...e, instructions });
}

// src/mod/status.ts
var isRecord2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var str = (record, key) => typeof record[key] === "string" ? record[key] : "";
var list = (value) => Array.isArray(value) ? value.filter(isRecord2) : [];
var contractOf = (value) => isRecord2(value) && typeof value["id"] === "string" && typeof value["hash"] === "string" ? { id: value["id"], hash: value["hash"] } : null;
var parseStatus = (text2) => {
  let parsed;
  try {
    parsed = JSON.parse(text2);
  } catch {
    return void 0;
  }
  const data = isRecord2(parsed) && isRecord2(parsed["data"]) ? parsed["data"] : parsed;
  if (!isRecord2(data) || data["schema"] !== "finitemonkey/status@1") return void 0;
  const checks = list(data["checks"]).map((item) => ({
    id: str(item, "id"),
    status: str(item, "status"),
    stale: item["stale"] === true,
    verify: str(item, "verify")
  }));
  const gate = isRecord2(data["gate"]) ? data["gate"] : {};
  const edits = data["editsSinceGate"];
  return {
    task: typeof data["task"] === "string" ? data["task"] : null,
    contract: contractOf(data["contract"]),
    light: str(gate, "light") || "none",
    passed: checks.filter((check) => check.status === "passed").length,
    total: checks.length,
    checks,
    notVerified: list(data["notVerified"]).map((item) => ({
      id: str(item, "id"),
      reason: str(item, "reason"),
      verify: str(item, "verify")
    })),
    editsSinceGate: typeof edits === "number" ? edits : null,
    bypasses: typeof data["bypasses"] === "number" ? data["bypasses"] : 0
  };
};
var MARK = {
  green: "✓",
  red: "✗",
  incomplete: "…",
  did_not_run: "?",
  none: "·"
};
var markOf = (light) => MARK[light] ?? "·";
var short = (hash) => hash.slice(0, 4);
var bandLine = (view) => [
  ...view.bypasses > 0 ? [`⚠ ${String(view.bypasses)} guard bypassed`] : [],
  `gate ${markOf(view.light)} ${String(view.passed)}/${String(view.total)}`,
  ...view.notVerified.length > 0 ? [`${String(view.notVerified.length)} not verified`] : [],
  ...view.contract === null ? [] : [`contract ${short(view.contract.hash)}`],
  ...view.editsSinceGate !== null && view.editsSinceGate > 0 ? [`evidence ${String(view.editsSinceGate)} edits old`] : []
].join(" · ");
var turnLine = (view) => [
  `gate ${markOf(view.light)}`,
  ...view.notVerified.length > 0 ? [`${String(view.notVerified.length)} criteria without check`] : [],
  ...view.contract === null ? [] : [`contract ${short(view.contract.hash)}`]
].join(" · ");
var checkLine = (check) => `${check.status === "passed" ? "✓" : check.status === "failed" ? "✗" : "○"} ${check.id}${check.stale ? " (stale)" : ""}`;
var notVerifiedLine = (item) => `○ ${item.id}: ${item.reason} → ${item.verify}`;
var statusText = (view) => [
  `finitemonkey ${bandLine(view)}`,
  ...view.checks.map(checkLine),
  ...view.notVerified.length > 0 ? ["not verified:", ...view.notVerified.map(notVerifiedLine)] : []
].join("\n");

// src/mod/gate-view.ts
var GATE_PANE = "fm-gate";
var line = (elements, text2, key, dim = false) => elements.Text({ key, children: [text2], ...dim ? { dimColor: true } : {} });
var bandTree = (elements, view, open) => elements.Box({
  key: "fm-band",
  flexDirection: "row",
  columnGap: 2,
  children: [
    line(elements, `FM  ${bandLine(view)}`, "fm-band-text"),
    elements.Button({ key: "fm-open", label: "gate panel", hotkey: "g", onPress: open })
  ]
});
var contractLine = (view) => view.contract === null ? "no contract" : `contract ${view.contract.id} ${view.contract.hash.slice(0, 12)}`;
var paneTree = (elements, view, actions) => elements.Box({
  key: "fm-pane",
  flexDirection: "column",
  children: [
    line(elements, bandLine(view), "fm-pane-summary"),
    line(elements, contractLine(view), "fm-pane-contract", true),
    ...view.checks.map((check) => line(elements, checkLine(check), `fm-check-${check.id}`)),
    ...view.notVerified.length > 0 ? [
      line(elements, "not verified:", "fm-not-verified"),
      ...view.notVerified.map((item) => line(elements, notVerifiedLine(item), `fm-nv-${item.id}`))
    ] : [],
    elements.Box({
      key: "fm-pane-buttons",
      flexDirection: "row",
      columnGap: 2,
      children: [
        elements.Button({ key: "fm-run-gate", label: "Run gate", hotkey: "r", onPress: actions.runGate }),
        elements.Button({ key: "fm-close", label: "Close", hotkey: "x", onPress: actions.close })
      ]
    })
  ]
});

// src/mod/gate-hooks.ts
var DEBOUNCE_MS = 500;
var GATE_COMMAND = "fm";
function bandOn() {
  return (memory.state?.band ?? "active") !== "off";
}
async function refreshStatus($) {
  const text2 = await runCli($, ["status", "--json"]);
  const view = text2 === void 0 ? void 0 : parseStatus(text2);
  if (view === void 0) return;
  memory.view = view;
  $.ui.invalidate("ui.render");
  const surfaces = await $.session.surfaces();
  if (bandOn() && surfaces.includes("vscode")) $.ui.status(`FM ${bandLine(view)} · /fm`);
}
function scheduleStatus($, delay) {
  memory.pending?.cancel();
  memory.pending = $.clock.after(delay, () => refreshStatus($));
}
async function registerGateCommand($) {
  try {
    await $.command.register({
      name: GATE_COMMAND,
      description: "Finite Monkey: gate state, contract and what is not verified",
      immediate: true
    });
  } catch {
    $.ui.log("finitemonkey: /fm is taken by another command; the gate panel opens from the band");
  }
}
async function afterTool($, e, next) {
  const result = await next(e);
  scheduleStatus($, DEBOUNCE_MS);
  return result;
}
async function passTool(_$, e, next) {
  return next(e);
}
async function openPane($) {
  await $.ui.open({ id: GATE_PANE, title: "Finite Monkey" });
}
async function runGateNow($) {
  await runCli($, ["gate"]);
  await refreshStatus($);
}
async function closePane($) {
  await $.ui.close({ id: GATE_PANE });
}
async function renderBand($, e, next) {
  const view = memory.view;
  const theirs = await next(e);
  if (view === void 0 || !bandOn()) return theirs;
  const elements = $.ui.resolve(e);
  const ours = bandTree(elements, view, () => openPane($));
  return theirs === null ? ours : elements.Box({ flexDirection: "column", children: [ours, theirs] });
}
async function renderPane($, e, next) {
  if (e.requestId !== GATE_PANE) return next(e);
  const elements = $.ui.resolve(e);
  const view = memory.view;
  if (view === void 0) return elements.Text({ key: "fm-loading", children: ["finitemonkey: reading the gate…"] });
  return paneTree(elements, view, { runGate: () => runGateNow($), close: () => closePane($) });
}
async function handoffNow($) {
  const brief = await readHandoff($);
  if (brief === void 0) return { text: "finitemonkey: no handoff in this folder" };
  const surfaces = await $.session.surfaces();
  if (surfaces.length > 0) await $.session.compact({ instructions: brief });
  return { text: brief };
}
async function runGateCommand($, e) {
  if (e.args.trim() === "handoff") return handoffNow($);
  if (memory.view === void 0) await refreshStatus($);
  const surfaces = await $.session.surfaces();
  if (surfaces.length > 0) {
    await openPane($);
    return {};
  }
  const view = memory.view;
  return { text: view === void 0 ? "finitemonkey: no gate status in this folder" : statusText(view) };
}
function withTurnLine(e, result) {
  const view = memory.view;
  if (e.agentId !== void 0 || e.isAborted === true || view === void 0 || view.task === null || !bandOn())
    return result;
  const line2 = `FM ${turnLine(view)}`;
  return { ...result, text: result.text === void 0 || result.text === "" ? line2 : `${result.text}
${line2}` };
}

// src/mod/state.ts
var MOD_STATE_SCHEMA = "finitemonkey/mod-state@1";
var isRecord3 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
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
  if (!isRecord3(value)) return void 0;
  const { id, target, pattern, reason } = value;
  const known = TARGETS.find((item) => item === target);
  if (typeof id !== "string" || known === void 0 || typeof pattern !== "string" || typeof reason !== "string")
    return void 0;
  const regex = compile(pattern);
  return regex === void 0 ? void 0 : { rule: { id, target: known, pattern, reason }, regex };
};
var attributionOf = (value) => {
  if (!isRecord3(value) || typeof value["forbid"] !== "boolean") return void 0;
  const trailer = value["trailer"];
  return { forbid: value["forbid"], trailer: typeof trailer === "string" && trailer !== "" ? trailer : null };
};
var dataOf = (parsed) => isRecord3(parsed) && isRecord3(parsed["data"]) ? parsed["data"] : parsed;
var parseModState = (text2) => {
  let parsed;
  try {
    parsed = JSON.parse(text2);
  } catch {
    return void 0;
  }
  const data = dataOf(parsed);
  if (!isRecord3(data) || data["schema"] !== MOD_STATE_SCHEMA || typeof data["root"] !== "string") return void 0;
  const mode = MODES.find((item) => item === data["mode"]) ?? "shadow";
  const raw = Array.isArray(data["rules"]) ? data["rules"] : [];
  const rules = raw.map(ruleOf).filter((rule) => rule !== void 0);
  const failReason = data["failReason"];
  const band = MODES.find((item) => item === data["band"]) ?? "active";
  const attribution = attributionOf(data["attribution"]);
  return {
    root: data["root"],
    mode,
    band,
    rules,
    instructions: typeof data["instructions"] === "string" ? data["instructions"] : "",
    ...attribution === void 0 ? {} : { attribution },
    ...typeof failReason === "string" ? { failReason } : {}
  };
};

// src/mod/tighten.ts
var FILE_TOOLS = /* @__PURE__ */ new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
var SHELL_TOOLS = /* @__PURE__ */ new Set(["Bash", "PowerShell"]);
var isRecord4 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var text = (input, ...names) => {
  if (!isRecord4(input)) return void 0;
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

// src/mod/tighten-hooks.ts
async function refreshState($) {
  const text2 = await runCli($, ["mod", "state", "--json"]);
  const state = text2 === void 0 ? void 0 : parseModState(text2);
  if (state === void 0) return;
  const before = memory.state?.instructions;
  memory.state = state;
  if (before !== void 0 && before !== state.instructions) $.ui.invalidate("prompt.section");
}
function scheduleRefresh($) {
  $.clock.after(0, () => refreshState($));
}
async function recordTightening($, rule, tool, mode) {
  await runCli($, ["mod", "record", "--rule", rule, "--tool", tool, "--mode", mode]);
}
function scheduleRecord($, rule, tool, mode) {
  $.clock.after(0, () => recordTightening($, rule, tool, mode));
}
async function guardCheck($, e, next) {
  const decided = await next(e);
  const state = memory.state;
  if (state === void 0 || state.mode === "off") return decided;
  const rule = ruleFor(state, e.tool, e.input);
  if (rule === void 0) return decided;
  scheduleRecord($, rule.rule.id, e.tool, state.mode);
  return state.mode === "active" ? stricter(decided, tightenFor(rule)) : decided;
}
async function failClosed() {
  return Promise.resolve({ decision: "deny", reason: memory.state?.failReason ?? FAILED_REASON });
}

// src/mod/register.ts
var WATCHED_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "PowerShell"];
async function onStart($, e, next) {
  scheduleRefresh($);
  scheduleStatus($, 0);
  await registerGateCommand($);
  return next(e);
}
async function onTurnComplete($, e, next) {
  scheduleRefresh($);
  scheduleStatus($, 0);
  return withTurnLine(e, await next(e));
}
function register(on) {
  on("session.start", onStart);
  on("turn.complete", onTurnComplete);
  on("tool.check", guardCheck).catch(failClosed);
  on("tool.call", { tool: WATCHED_TOOLS }, afterTool).catch(passTool);
  on("ui.render", { component: "AbovePrompt" }, renderBand);
  on("ui.render", { component: "Pane" }, renderPane);
  on("command.run", { command: GATE_COMMAND }, runGateCommand);
  on("attribution.text", attributionText);
  on("prompt.compose", composeRules);
  on("session.compact", compactNotes);
}
export {
  register
};

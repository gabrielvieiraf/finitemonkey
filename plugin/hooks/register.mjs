// src/mod/memory.ts
var memory = {
  state: void 0,
  view: void 0,
  pending: void 0,
  steps: [],
  cost: [],
  board: [],
  contract: void 0,
  divergence: void 0,
  notice: void 0,
  xray: void 0,
  concepts: []
};

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
var withRulesSection = (result, text4) => text4 === "" ? result : {
  sections: [
    ...result.sections.filter((section) => section.id !== RULES_SECTION),
    { id: RULES_SECTION, text: text4, scope: "session" }
  ]
};
var parseHandoff = (text4) => {
  let parsed;
  try {
    parsed = JSON.parse(text4);
  } catch {
    return void 0;
  }
  const data = isRecord(parsed) && isRecord(parsed["data"]) ? parsed["data"] : parsed;
  return isRecord(data) && data["schema"] === "finitemonkey/handoff@1" && typeof data["text"] === "string" ? data["text"] : void 0;
};
async function readHandoff($) {
  const text4 = await runCli($, ["handoff", "--json"]);
  return text4 === void 0 ? void 0 : parseHandoff(text4);
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

// src/mod/cost-hooks.ts
var count = (value) => typeof value === "number" && Number.isFinite(value) ? value : 0;
var usageOf = (result, agent) => {
  const usage = result.usage;
  if (usage === void 0 || usage === null) return void 0;
  return {
    model: typeof usage.model === "string" ? usage.model : "unknown",
    agent: agent ?? null,
    input: count(usage.input_tokens),
    output: count(usage.output_tokens),
    cacheRead: count(usage.cache_read_input_tokens),
    cacheWrite: count(usage.cache_creation_input_tokens)
  };
};
async function* stepUsage(_$, e, next) {
  const result = yield* next(e);
  const step = usageOf(result, e.agentId);
  if (step !== void 0) memory.steps = [...memory.steps, step];
  return result;
}
async function flushUsage($, steps) {
  await runCli($, ["mod", "usage", "--steps", JSON.stringify(steps)]);
}
function scheduleUsage($) {
  const steps = memory.steps;
  if (steps.length === 0) return;
  memory.steps = [];
  $.clock.after(0, () => flushUsage($, steps));
}
var isRecord2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var money = (usd) => `$${(typeof usd === "number" ? usd : 0).toFixed(2)}`;
var costLines = (text4) => {
  let parsed;
  try {
    parsed = JSON.parse(text4);
  } catch {
    return [];
  }
  const data = isRecord2(parsed) && isRecord2(parsed["data"]) ? parsed["data"] : parsed;
  if (!isRecord2(data) || data["schema"] !== "finitemonkey/mod-cost@1") return [];
  const arms = Array.isArray(data["byArm"]) ? data["byArm"].filter(isRecord2) : [];
  return [
    `contract ${String(data["task"])}: ${money(data["usd"])} in ${String(data["requests"])} requests`,
    `attempts ${String(data["attempts"])} · per attempt ${data["perAttempt"] === null ? "-" : money(data["perAttempt"])}`,
    ...arms.map((arm) => `arm ${String(arm["arm"])}: ${money(arm["usd"])} in ${String(arm["requests"])} requests`)
  ];
};
async function refreshCost($) {
  const text4 = await runCli($, ["mod", "cost", "--json"]);
  memory.cost = text4 === void 0 ? [] : costLines(text4);
  return memory.cost;
}

// src/mod/approve-view.ts
var CONTRACT_PANE = "fm-contract";
var DIVERGE_PANE = "fm-diverge";
var TASK_SCHEMA = "finitemonkey/task@1";
var isRecord3 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var str = (record, key) => typeof record[key] === "string" ? record[key] : "";
var taskData = (text4) => {
  let parsed;
  try {
    parsed = JSON.parse(text4);
  } catch {
    return void 0;
  }
  const data = isRecord3(parsed) && isRecord3(parsed["data"]) ? parsed["data"] : parsed;
  return isRecord3(data) && data["schema"] === TASK_SCHEMA ? data : void 0;
};
var items = (value) => (Array.isArray(value) ? value.filter(isRecord3) : []).map((item) => ({
  id: str(item, "id"),
  says: str(item, "says"),
  status: str(item, "status")
}));
var parseContractView = (text4) => {
  const data = taskData(text4);
  if (data === void 0 || typeof data["hash"] !== "string" || typeof data["task"] !== "string") return void 0;
  return {
    task: data["task"],
    goal: str(data, "goal"),
    hash: data["hash"],
    digest: str(data, "digest"),
    trusted: data["trusted"] === true,
    checks: items(data["acceptance"]),
    examples: items(data["examples"])
  };
};
var parseDivergeView = (text4) => {
  const data = taskData(text4);
  const question = data === void 0 ? void 0 : data["question"];
  if (data === void 0 || !isRecord3(question)) return void 0;
  const options = (Array.isArray(question["options"]) ? question["options"].filter(isRecord3) : []).map((option) => ({
    letter: str(option, "letter"),
    output: str(option, "output")
  }));
  return { task: str(data, "task"), input: str(question, "input"), options };
};
var shortHash = (hash) => hash.slice(0, 12);
var contractLines = (view) => [
  `contract ${view.task}: ${view.goal}`,
  ...view.checks.map((check) => `  check ${check.id}: ${check.says}`),
  ...view.examples.map((example) => `  ${example.id} [${example.status}] ${example.says}`),
  `hash ${shortHash(view.hash)} (changes if a check or an approved example changes)`,
  view.trusted ? "approved on this machine" : "not approved"
];
var divergeLines = (view) => [
  `two readings of ${view.task} behave differently on input: ${view.input}`,
  ...view.options.map((option) => `  ${option.letter}: ${option.output}`)
];
var text = (elements, line2, key, dim = false) => elements.Text({ key, children: [line2], ...dim ? { dimColor: true } : {} });
var row = (elements, key, children) => elements.Box({ key, flexDirection: "row", columnGap: 2, children });
var exampleRow = (elements, example, actions) => example.status === "proposed" ? row(elements, `fm-ex-${example.id}`, [
  text(elements, `${example.id} ${example.says}`, `fm-ex-text-${example.id}`),
  elements.Button({
    key: `fm-ex-approve-${example.id}`,
    label: `Approve ${example.id}`,
    onPress: () => actions.decide(example.id, "approve")
  }),
  elements.Button({
    key: `fm-ex-reject-${example.id}`,
    label: `Reject ${example.id}`,
    onPress: () => actions.decide(example.id, "reject")
  })
]) : text(elements, `${example.id} [${example.status}] ${example.says}`, `fm-ex-text-${example.id}`);
var contractTree = (elements, view, notice, actions) => elements.Box({
  key: "fm-contract",
  flexDirection: "column",
  children: [
    text(elements, `Contract ${view.task}: ${view.goal}`, "fm-contract-goal"),
    ...view.checks.map((check) => text(elements, `check ${check.id}: ${check.says}`, `fm-check-${check.id}`, true)),
    ...view.examples.length === 0 ? [text(elements, "no behavior examples yet", "fm-ex-none", true)] : [
      text(elements, "What the task does, in examples:", "fm-ex-head"),
      ...view.examples.map((example) => exampleRow(elements, example, actions))
    ],
    text(
      elements,
      `Hash ${shortHash(view.hash)} (changes if a check or an approved example changes)`,
      "fm-contract-hash",
      true
    ),
    ...notice === void 0 ? [] : [text(elements, notice, "fm-contract-notice")],
    view.trusted ? text(elements, "Approved on this machine with this hash.", "fm-contract-approved") : row(elements, "fm-contract-buttons", [
      elements.Button({
        key: "fm-contract-approve",
        label: `Approve ${view.hash.slice(0, 4)}`,
        hotkey: "a",
        onPress: actions.approve
      }),
      elements.Button({ key: "fm-contract-edit", label: "Edit", hotkey: "e", onPress: actions.edit }),
      elements.Button({ key: "fm-contract-reject", label: "Reject", hotkey: "x", onPress: actions.reject })
    ])
  ]
});
var wantInput = (elements, actions) => {
  const input = elements.Input;
  return input === void 0 ? [] : [
    input({
      key: "fm-diverge-want",
      label: "Neither, I want:",
      placeholder: "the result this input should give",
      submitLabel: "Send",
      onSubmit: (value) => actions.want(value)
    })
  ];
};
var divergeTree = (elements, view, notice, actions) => {
  const close = elements.Button({ key: "fm-diverge-close", label: "Close", hotkey: "x", onPress: actions.close });
  if (view === void 0)
    return elements.Box({
      key: "fm-diverge",
      flexDirection: "column",
      children: [text(elements, notice ?? "no open divergence question", "fm-diverge-none"), close]
    });
  return elements.Box({
    key: "fm-diverge",
    flexDirection: "column",
    children: [
      text(elements, "Two readings of the request do different things", "fm-diverge-head"),
      text(elements, "Input:", "fm-diverge-input-label", true),
      elements.Code({ key: "fm-diverge-input", source: view.input, language: "text" }),
      ...view.options.flatMap((option) => [
        text(elements, `${option.letter} returns:`, `fm-diverge-label-${option.letter}`, true),
        elements.Code({ key: `fm-diverge-out-${option.letter}`, source: option.output, language: "text" })
      ]),
      ...notice === void 0 ? [] : [text(elements, notice, "fm-diverge-notice")],
      row(elements, "fm-diverge-buttons", [
        ...view.options.map(
          (option, index) => elements.Button({
            key: `fm-diverge-${option.letter}`,
            label: `I want ${option.letter}`,
            hotkey: String(index + 1),
            onPress: () => actions.choose(option.letter)
          })
        ),
        close
      ]),
      ...wantInput(elements, actions)
    ]
  });
};

// src/mod/approve-hooks.ts
async function loadContract($) {
  const text4 = await runCli($, ["task", "trust", "--json"]);
  memory.contract = text4 === void 0 ? void 0 : parseContractView(text4);
}
async function loadDivergence($) {
  const text4 = await runCli($, ["task", "diverge", "--pending", "--json"]);
  memory.divergence = text4 === void 0 ? void 0 : parseDivergeView(text4);
}
function redraw($, notice) {
  memory.notice = notice;
  $.ui.invalidate("ui.render");
}
async function approveShown($) {
  const shown = memory.contract;
  if (shown === void 0 || shown.trusted) return;
  const done = await runCli($, ["task", "trust", shown.task, "--hash", shown.hash, "--digest", shown.digest, "--json"]);
  await loadContract($);
  redraw(
    $,
    done === void 0 ? "Not approved: the contract changed after it was shown or could not be read. Check the text above and press again." : `Approved ${shown.task} with hash ${shown.hash.slice(0, 12)}.`
  );
}
async function decideExample($, id, verdict) {
  const task = memory.contract?.task;
  if (task === void 0) return;
  const done = await runCli($, ["task", "examples", task, `--${verdict}`, id, "--json"]);
  await loadContract($);
  redraw(
    $,
    done === void 0 ? `${id} not recorded: approve the contract before its examples.` : `${id} ${verdict === "approve" ? "approved" : "rejected"}.`
  );
}
function editContract($) {
  const task = memory.contract?.task;
  if (task !== void 0)
    redraw($, `Edit .finitemonkey/tasks/${task}.yml or ask for the change, then run /fm contract again.`);
  return Promise.resolve();
}
async function rejectContract($) {
  const task = memory.contract?.task;
  memory.notice = void 0;
  $.ui.log(`finitemonkey: contract ${task ?? "-"} left unapproved; the gate keeps its commands from running`);
  await $.ui.close({ id: CONTRACT_PANE });
}
async function answer($, args, said) {
  const task = memory.divergence?.task;
  if (task === void 0) return;
  const done = await runCli($, ["task", "diverge", task, ...args, "--json"]);
  await loadDivergence($);
  redraw($, done === void 0 ? "Not recorded: approve the contract first, then answer again." : said);
}
async function chooseOption($, letter) {
  await answer($, ["--choose", letter], `Stored: ${letter} is now an approved example.`);
}
async function wantOwn($, value) {
  if (value.trim() === "") return;
  await answer($, ["--want", value], "Stored: your answer is now an approved example.");
}
function renderApproval($, e) {
  const elements = $.ui.resolve(e);
  if (e.requestId === DIVERGE_PANE)
    return divergeTree(elements, memory.divergence, memory.notice, {
      choose: (letter) => chooseOption($, letter),
      want: (value) => wantOwn($, value),
      close: () => $.ui.close({ id: DIVERGE_PANE })
    });
  const view = memory.contract;
  if (view === void 0) return elements.Text({ key: "fm-contract-none", children: ["no contract to approve"] });
  return contractTree(elements, view, memory.notice, {
    approve: () => approveShown($),
    decide: (id, verdict) => decideExample($, id, verdict),
    edit: () => editContract($),
    reject: () => rejectContract($)
  });
}
var isApprovalPane = (id) => id === CONTRACT_PANE || id === DIVERGE_PANE;
async function contractNow($) {
  await loadContract($);
  memory.notice = void 0;
  const surfaces = await $.session.surfaces();
  const view = memory.contract;
  if (surfaces.length > 0) {
    await $.ui.open({ id: CONTRACT_PANE, title: "Finite Monkey · contract" });
    return {};
  }
  if (view === void 0) return { text: "finitemonkey: no active contract" };
  return {
    text: [
      ...contractLines(view),
      ...view.trusted ? [] : [`approve it in the terminal: fm: trust ${view.task}`]
    ].join("\n")
  };
}
async function divergeNow($) {
  await loadDivergence($);
  memory.notice = void 0;
  const surfaces = await $.session.surfaces();
  const view = memory.divergence;
  if (surfaces.length > 0) {
    await $.ui.open({ id: DIVERGE_PANE, title: "Finite Monkey · which one do you want?" });
    return {};
  }
  if (view === void 0) return { text: "finitemonkey: no open divergence question" };
  return {
    text: [
      ...divergeLines(view),
      `answer in the terminal: finitemonkey task diverge ${view.task} --choose <letter>`
    ].join("\n")
  };
}

// src/mod/status.ts
var isRecord4 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var str2 = (record, key) => typeof record[key] === "string" ? record[key] : "";
var list = (value) => Array.isArray(value) ? value.filter(isRecord4) : [];
var contractOf = (value) => isRecord4(value) && typeof value["id"] === "string" && typeof value["hash"] === "string" ? { id: value["id"], hash: value["hash"] } : null;
var loopOf = (value) => isRecord4(value) && typeof value["count"] === "number" && typeof value["limit"] === "number" ? { count: value["count"], limit: value["limit"] } : null;
var costOf = (value) => isRecord4(value) && typeof value["usd"] === "number" && typeof value["requests"] === "number" ? { usd: value["usd"], requests: value["requests"] } : null;
var xrayOf = (value) => isRecord4(value) && typeof value["beyondWithoutCriterion"] === "number" && typeof value["blocks"] === "number" ? { beyond: value["beyondWithoutCriterion"], blocks: value["blocks"] } : null;
var parseStatus = (text4) => {
  let parsed;
  try {
    parsed = JSON.parse(text4);
  } catch {
    return void 0;
  }
  const data = isRecord4(parsed) && isRecord4(parsed["data"]) ? parsed["data"] : parsed;
  if (!isRecord4(data) || data["schema"] !== "finitemonkey/status@1") return void 0;
  const checks = list(data["checks"]).map((item) => ({
    id: str2(item, "id"),
    status: str2(item, "status"),
    stale: item["stale"] === true,
    verify: str2(item, "verify")
  }));
  const gate = isRecord4(data["gate"]) ? data["gate"] : {};
  const edits = data["editsSinceGate"];
  return {
    task: typeof data["task"] === "string" ? data["task"] : null,
    contract: contractOf(data["contract"]),
    light: str2(gate, "light") || "none",
    passed: checks.filter((check) => check.status === "passed").length,
    total: checks.length,
    checks,
    notVerified: list(data["notVerified"]).map((item) => ({
      id: str2(item, "id"),
      reason: str2(item, "reason"),
      verify: str2(item, "verify")
    })),
    editsSinceGate: typeof edits === "number" ? edits : null,
    bypasses: typeof data["bypasses"] === "number" ? data["bypasses"] : 0,
    loop: loopOf(data["loop"]),
    cost: costOf(data["cost"]),
    xray: xrayOf(data["xray"])
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
  ...view.editsSinceGate !== null && view.editsSinceGate > 0 ? [`evidence ${String(view.editsSinceGate)} edits old`] : [],
  ...view.loop === null ? [] : [`loop ${String(view.loop.count)}/${String(view.loop.limit)}`],
  ...view.cost === null ? [] : [`$${view.cost.usd.toFixed(2)} this contract`],
  ...view.xray === null || view.xray.beyond === 0 ? [] : [`x-ray ${String(view.xray.beyond)} beyond the record without criterion`]
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

// src/mod/fronts-view.ts
var FRONTS_PANE = "fm-fronts";
var isRecord5 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var text2 = (value, fallback) => typeof value === "string" ? value : fallback;
var rowLine = (row2) => [
  `${row2["waiting"] === true ? "◆" : "●"} ${text2(row2["branch"], text2(row2["path"], "?"))}`,
  `gate ${markOf(text2(row2["gate"], "none"))}`,
  `contract ${text2(row2["contract"], "-")}`,
  ...typeof row2["lastActivity"] === "string" ? [`last ${row2["lastActivity"].slice(0, 16).replace("T", " ")}`] : [],
  ...row2["waiting"] === true ? ["WAITING ON YOU"] : []
].join("  ");
var collisionLine = (item) => {
  const branches = Array.isArray(item["branches"]) ? item["branches"].map(String).join(", ") : "";
  return `collision: ${text2(item["file"], "?")} in ${branches}`;
};
var boardLines = (json) => {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const data = isRecord5(parsed) && isRecord5(parsed["data"]) ? parsed["data"] : parsed;
  if (!isRecord5(data) || data["schema"] !== "finitemonkey/fronts-board@1") return [];
  const rows = Array.isArray(data["rows"]) ? data["rows"].filter(isRecord5) : [];
  const collisions = Array.isArray(data["collisions"]) ? data["collisions"].filter(isRecord5) : [];
  return [...rows.map(rowLine), ...collisions.map(collisionLine)];
};
var frontsTree = (elements, lines, close) => elements.Box({
  key: "fm-fronts",
  flexDirection: "column",
  children: [
    ...(lines.length === 0 ? ["no worktrees found"] : lines).map((line2) => elements.Text({ children: [line2] })),
    elements.Button({ key: "fm-fronts-close", label: "Close", hotkey: "x", onPress: close })
  ]
});

// src/mod/gate-view.ts
var GATE_PANE = "fm-gate";
var COST_PANE = "fm-cost";
var line = (elements, text4, key, dim = false) => elements.Text({ key, children: [text4], ...dim ? { dimColor: true } : {} });
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
var costTree = (elements, lines, close) => elements.Box({
  key: "fm-cost",
  flexDirection: "column",
  children: [
    ...(lines.length === 0 ? ["no cost recorded for this contract"] : lines).map(
      (text4) => elements.Text({ children: [text4] })
    ),
    elements.Button({ key: "fm-cost-close", label: "Close", hotkey: "x", onPress: close })
  ]
});

// src/mod/xray-view.ts
var XRAY_PANE = "fm-xray";
var isRecord6 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var str3 = (record, key) => typeof record[key] === "string" ? record[key] : "";
var num = (record, key) => typeof record[key] === "number" ? record[key] : 0;
var dataOf = (text4, schema) => {
  let parsed;
  try {
    parsed = JSON.parse(text4);
  } catch {
    return void 0;
  }
  const data = isRecord6(parsed) && isRecord6(parsed["data"]) ? parsed["data"] : parsed;
  return isRecord6(data) && data["schema"] === schema ? data : void 0;
};
var records = (value) => Array.isArray(value) ? value.filter(isRecord6) : [];
var parseXray = (text4) => {
  const data = dataOf(text4, "finitemonkey/xray@1");
  if (data === void 0) return void 0;
  return {
    task: str3(data, "task"),
    beyond: num(data, "beyondWithoutCriterion"),
    items: records(data["items"]).map((item) => ({
      file: str3(item, "file"),
      start: num(item, "start"),
      end: num(item, "end"),
      band: str3(item, "band"),
      coverage: str3(item, "coverage"),
      concepts: records(item["concepts"]).map((entry) => str3(entry, "concept")),
      by: str3(item, "by")
    }))
  };
};
var parseConcepts = (text4) => records(dataOf(text4, "finitemonkey/concept-evidence@1")?.["concepts"]).map((item) => ({
  concept: str3(item, "concept"),
  domain: str3(item, "domain"),
  state: str3(item, "state"),
  positive: num(item, "positive"),
  negative: num(item, "negative"),
  exposures: num(item, "exposures")
}));
var BAND_TEXT = {
  beyond: "beyond the evidence on record",
  unknown: "no record",
  edge: "at the edge",
  within: "within the evidence on record"
};
var COVERAGE_TEXT = {
  none: "no executable criterion",
  decorative: "criterion caught no planted defect",
  covered: "covered by a criterion"
};
var rowLine2 = (row2) => `${row2.file} ${String(row2.start)}-${String(row2.end)}: ${BAND_TEXT[row2.band] ?? row2.band}, ${COVERAGE_TEXT[row2.coverage] ?? row2.coverage} (${row2.concepts.join(", ") || "-"}; ${row2.by === "agent" ? "written by the agent" : "changed outside the agent's tools"})`;
var conceptLine = (row2) => `${row2.concept} (${row2.domain}): ${row2.state === "unknown" ? "no record" : row2.state} · ${String(row2.positive)} for, ${String(row2.negative)} against, ${String(row2.exposures)} exposures`;
var xrayLines = (view, concepts) => [
  `x-ray ${view.task}: ${String(view.beyond)} beyond the record with no criterion, ${String(view.items.length)} changed blocks`,
  ...view.items.map(rowLine2),
  ...concepts.filter((row2) => row2.state !== "unknown").map(conceptLine)
];
var STATE_COLOR = {
  demonstrated: "#2f7d4f",
  proximal: "#c28a1a",
  beyond: "#b3412f"
};
var escape = (text4) => text4.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
var mapSvg = (concepts) => {
  const known = concepts.filter((row2) => row2.state !== "unknown");
  const height = 24 * Math.max(known.length, 1) + 8;
  const rows = known.map((row2, index) => {
    const y = 8 + index * 24;
    const color = STATE_COLOR[row2.state] ?? "#888888";
    return `<rect x="8" y="${String(y)}" width="14" height="14" fill="${color}"/><text x="30" y="${String(y + 12)}" font-size="12" fill="currentColor">${escape(conceptLine(row2))}</text>`;
  });
  const body = rows.length === 0 ? `<text x="8" y="20" font-size="12" fill="currentColor">no concept evidence on record</text>` : rows.join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="${String(height)}" viewBox="0 0 560 ${String(height)}">${body}</svg>`;
};
var needsAction = (row2) => (row2.band === "beyond" || row2.band === "unknown") && row2.coverage !== "covered";
var itemTree = (elements, row2, actions) => {
  const key = `${row2.file}:${String(row2.start)}`;
  const text4 = elements.Text({ key: `fm-xray-text-${key}`, children: [rowLine2(row2)] });
  if (!needsAction(row2)) return text4;
  return elements.Box({
    key: `fm-xray-item-${key}`,
    flexDirection: "column",
    children: [
      text4,
      elements.Box({
        key: `fm-xray-actions-${key}`,
        flexDirection: "row",
        columnGap: 2,
        children: [
          elements.Button({ key: `fm-xray-criterion-${key}`, label: "Create criterion", onPress: actions.criterion }),
          elements.Button({
            key: `fm-xray-leave-${key}`,
            label: "Leave it to the machine",
            onPress: () => actions.leave(row2)
          }),
          elements.Button({ key: `fm-xray-skip-${key}`, label: "Skip", onPress: () => actions.skip(row2) })
        ]
      })
    ]
  });
};
var xrayTree = (elements, view, concepts, actions, surface) => {
  const svg = surface === "desktop" || surface === "vscode" ? elements.Svg : void 0;
  const map = svg === void 0 ? concepts.filter((row2) => row2.state !== "unknown").map((row2) => elements.Text({ key: `fm-xray-concept-${row2.concept}`, children: [conceptLine(row2)] })) : [svg({ key: "fm-xray-map", source: mapSvg(concepts), alt: "concept evidence on record, one row per concept" })];
  return elements.Box({
    key: "fm-xray",
    flexDirection: "column",
    children: [
      elements.Text({
        key: "fm-xray-head",
        children: [
          view === void 0 ? "no x-ray for this folder" : `X-ray ${view.task}: ${String(view.beyond)} beyond the record with no criterion`
        ]
      }),
      ...(view?.items ?? []).map((row2) => itemTree(elements, row2, actions)),
      elements.Text({ key: "fm-xray-map-head", dimColor: true, children: ["What is on record, per concept:"] }),
      ...map,
      elements.Button({ key: "fm-xray-close", label: "Close", hotkey: "x", onPress: actions.close })
    ]
  });
};

// src/mod/xray-hooks.ts
async function loadXray($) {
  const xray = await runCli($, ["xray", "--json"]);
  const concepts = await runCli($, ["conceitos", "evidence", "--json"]);
  memory.xray = xray === void 0 ? void 0 : parseXray(xray);
  memory.concepts = concepts === void 0 ? [] : parseConcepts(concepts);
}
async function decideRow($, row2, flag) {
  await runCli($, ["xray", "decide", `${row2.file}:${String(row2.start)}`, flag, "--json"]);
  memory.xray = memory.xray === void 0 ? void 0 : {
    ...memory.xray,
    items: memory.xray.items.filter((item) => item.file !== row2.file || item.start !== row2.start)
  };
  $.ui.invalidate("ui.render");
}
async function createCriterion($) {
  await contractNow($);
}
function renderXray($, e) {
  return xrayTree(
    $.ui.resolve(e),
    memory.xray,
    memory.concepts,
    {
      criterion: () => createCriterion($),
      leave: (row2) => decideRow($, row2, "--leave"),
      skip: (row2) => decideRow($, row2, "--skip"),
      close: () => $.ui.close({ id: XRAY_PANE })
    },
    e.surface
  );
}
async function xrayNow($) {
  await loadXray($);
  const surfaces = await $.session.surfaces();
  if (surfaces.length > 0) {
    await $.ui.open({ id: XRAY_PANE, title: "Finite Monkey · x-ray" });
    return {};
  }
  const view = memory.xray;
  return {
    text: view === void 0 ? "finitemonkey: no x-ray in this folder" : xrayLines(view, memory.concepts).join("\n")
  };
}

// src/mod/gate-hooks.ts
var DEBOUNCE_MS = 500;
var GATE_COMMAND = "fm";
function bandOn() {
  return (memory.state?.band ?? "active") !== "off";
}
async function refreshStatus($) {
  const text4 = await runCli($, ["status", "--json"]);
  const view = text4 === void 0 ? void 0 : parseStatus(text4);
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
  if (e.requestId === FRONTS_PANE)
    return frontsTree($.ui.resolve(e), memory.board, () => $.ui.close({ id: FRONTS_PANE }));
  if (isApprovalPane(e.requestId)) return renderApproval($, e);
  if (e.requestId === XRAY_PANE) return renderXray($, e);
  if (e.requestId === COST_PANE) return costTree($.ui.resolve(e), memory.cost, () => $.ui.close({ id: COST_PANE }));
  if (e.requestId !== GATE_PANE) return next(e);
  const elements = $.ui.resolve(e);
  const view = memory.view;
  if (view === void 0) return elements.Text({ key: "fm-loading", children: ["finitemonkey: reading the gate…"] });
  return paneTree(elements, view, { runGate: () => runGateNow($), close: () => closePane($) });
}
async function costNow($) {
  const lines = await refreshCost($);
  const surfaces = await $.session.surfaces();
  if (surfaces.length > 0) {
    await $.ui.open({ id: COST_PANE, title: "Finite Monkey · cost" });
    return {};
  }
  return { text: lines.length === 0 ? "finitemonkey: no cost recorded for this contract" : lines.join("\n") };
}
async function frontsNow($) {
  const json = await runCli($, ["fronts", "board", "--json"]);
  memory.board = json === void 0 ? [] : boardLines(json);
  const surfaces = await $.session.surfaces();
  if (surfaces.length > 0) {
    await $.ui.open({ id: FRONTS_PANE, title: "Finite Monkey · fronts" });
    return {};
  }
  return { text: memory.board.length === 0 ? "finitemonkey: no worktrees found" : memory.board.join("\n") };
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
  if (e.args.trim() === "cost") return costNow($);
  if (e.args.trim() === "fronts") return frontsNow($);
  if (e.args.trim() === "contract") return contractNow($);
  if (e.args.trim() === "diverge") return divergeNow($);
  if (e.args.trim() === "xray") return xrayNow($);
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
var isRecord7 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
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
  if (!isRecord7(value)) return void 0;
  const { id, target, pattern, reason } = value;
  const known = TARGETS.find((item) => item === target);
  if (typeof id !== "string" || known === void 0 || typeof pattern !== "string" || typeof reason !== "string")
    return void 0;
  const regex = compile(pattern);
  return regex === void 0 ? void 0 : { rule: { id, target: known, pattern, reason }, regex };
};
var attributionOf = (value) => {
  if (!isRecord7(value) || typeof value["forbid"] !== "boolean") return void 0;
  const trailer = value["trailer"];
  return { forbid: value["forbid"], trailer: typeof trailer === "string" && trailer !== "" ? trailer : null };
};
var dataOf2 = (parsed) => isRecord7(parsed) && isRecord7(parsed["data"]) ? parsed["data"] : parsed;
var parseModState = (text4) => {
  let parsed;
  try {
    parsed = JSON.parse(text4);
  } catch {
    return void 0;
  }
  const data = dataOf2(parsed);
  if (!isRecord7(data) || data["schema"] !== MOD_STATE_SCHEMA || typeof data["root"] !== "string") return void 0;
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
var isRecord8 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var text3 = (input, ...names) => {
  if (!isRecord8(input)) return void 0;
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
    const path = text3(input, "file_path", "notebook_path");
    if (path === void 0) return void 0;
    const rules = state.rules.filter((rule) => rule.rule.target === "path");
    return firstMatch(rules, relativeTo(state.root, path));
  }
  if (SHELL_TOOLS.has(tool)) {
    const command = text3(input, "command");
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
  const text4 = await runCli($, ["mod", "state", "--json"]);
  const state = text4 === void 0 ? void 0 : parseModState(text4);
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
  if (e.agentId === void 0) scheduleUsage($);
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
  on("turn.step", stepUsage);
}
export {
  register
};

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
  concepts: [],
  trajectory: [],
  selectedMark: void 0,
  theme: "auto"
};

// src/mod/attribution-hooks.ts
var KINDS = /* @__PURE__ */ new Set(["commit", "pr"]);
var attributionFor = (e, decided, attribution) => {
  if (attribution === void 0 || !KINDS.has(e.kind)) return decided;
  const base2 = attribution.forbid ? "" : decided.text;
  const trailer = e.kind === "commit" ? attribution.trailer : null;
  return { text: [base2, trailer ?? ""].filter((part) => part !== "").join("\n") };
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
var withRulesSection = (result, text5) => text5 === "" ? result : {
  sections: [
    ...result.sections.filter((section) => section.id !== RULES_SECTION),
    { id: RULES_SECTION, text: text5, scope: "session" }
  ]
};
var parseHandoff = (text5) => {
  let parsed;
  try {
    parsed = JSON.parse(text5);
  } catch {
    return void 0;
  }
  const data = isRecord(parsed) && isRecord(parsed["data"]) ? parsed["data"] : parsed;
  return isRecord(data) && data["schema"] === "finitemonkey/handoff@1" && typeof data["text"] === "string" ? data["text"] : void 0;
};
async function readHandoff($) {
  const text5 = await runCli($, ["handoff", "--json"]);
  return text5 === void 0 ? void 0 : parseHandoff(text5);
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
var costLines = (text5) => {
  let parsed;
  try {
    parsed = JSON.parse(text5);
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
  const text5 = await runCli($, ["mod", "cost", "--json"]);
  memory.cost = text5 === void 0 ? [] : costLines(text5);
  return memory.cost;
}

// src/mod/approve-view.ts
var CONTRACT_PANE = "fm-contract";
var DIVERGE_PANE = "fm-diverge";
var TASK_SCHEMA = "finitemonkey/task@1";
var isRecord3 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var str = (record, key) => typeof record[key] === "string" ? record[key] : "";
var taskData = (text5) => {
  let parsed;
  try {
    parsed = JSON.parse(text5);
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
var parseContractView = (text5) => {
  const data = taskData(text5);
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
var parseDivergeView = (text5) => {
  const data = taskData(text5);
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
  const text5 = await runCli($, ["task", "trust", "--json"]);
  memory.contract = text5 === void 0 ? void 0 : parseContractView(text5);
}
async function loadDivergence($) {
  const text5 = await runCli($, ["task", "diverge", "--pending", "--json"]);
  memory.divergence = text5 === void 0 ? void 0 : parseDivergeView(text5);
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
var numbers = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "number") : [];
var blindOf = (value) => isRecord4(value) && typeof value["domain"] === "string" && typeof value["index"] === "number" && typeof value["withoutCriterion"] === "number" && typeof value["helps"] === "number" ? {
  domain: value["domain"],
  index: value["index"],
  withoutCriterion: value["withoutCriterion"],
  helps: value["helps"],
  recent: numbers(value["recent"])
} : null;
var knowledgeOf = (value) => isRecord4(value) && typeof value["stale"] === "number" && typeof value["contradictions"] === "number" && typeof value["quarantined"] === "number" && value["stale"] + value["contradictions"] + value["quarantined"] > 0 ? { stale: value["stale"], contradictions: value["contradictions"], quarantined: value["quarantined"] } : null;
var ricochetOf = (value) => isRecord4(value) && typeof value["concept"] === "string" && typeof value["week"] === "string" ? { concept: value["concept"], week: value["week"] } : null;
var trajectoryOf = (value) => isRecord4(value) && typeof value["domain"] === "string" ? {
  domain: value["domain"],
  band: typeof value["band"] === "string" ? value["band"] : null,
  ricochet: ricochetOf(value["ricochet"])
} : null;
var trajectoryLine = (trajectory) => [
  `trajectory ${trajectory.domain}: ${trajectory.band ?? "no accepted work"}`,
  trajectory.ricochet === null ? "no ricochet" : `last ricochet ${trajectory.ricochet.concept} ${trajectory.ricochet.week.slice(-3)}`
].join(", ");
var knowledgeLine = (knowledge) => `knowledge: ${String(knowledge.stale)} stale · ${String(knowledge.contradictions)} rules contradict code · ${String(knowledge.quarantined)} in quarantine`;
var SPARK = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
var sparkline = (values) => values.map((value) => SPARK[Math.min(SPARK.length - 1, Math.max(0, Math.round(value * (SPARK.length - 1))))] ?? "").join("");
var blindLine = (blind) => `blind band ${blind.domain} ${blind.index.toFixed(2)} ${sparkline(blind.recent)} (${String(blind.withoutCriterion)}/${String(blind.helps)} help without criterion)`;
var parseStatus = (text5) => {
  let parsed;
  try {
    parsed = JSON.parse(text5);
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
    xray: xrayOf(data["xray"]),
    blindBand: blindOf(data["blindBand"]),
    knowledge: knowledgeOf(data["knowledge"]),
    trajectory: trajectoryOf(data["trajectory"])
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
  ...view.knowledge === null ? [] : [knowledgeLine(view.knowledge)],
  ...view.blindBand === null || view.blindBand.withoutCriterion === 0 ? [] : [blindLine(view.blindBand)],
  ...view.trajectory === null ? [] : [trajectoryLine(view.trajectory)],
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
var line = (elements, text5, key, dim = false) => elements.Text({ key, children: [text5], ...dim ? { dimColor: true } : {} });
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
      (text5) => elements.Text({ children: [text5] })
    ),
    elements.Button({ key: "fm-cost-close", label: "Close", hotkey: "x", onPress: close })
  ]
});

// src/conceitos/trajectory-palette.ts
var TOKENS = [
  "bg",
  "ink",
  "muted",
  "faint",
  "rule",
  "grid",
  "i1",
  "iInk",
  "p1",
  "pInk",
  "u",
  "uInk",
  "b1",
  "bInk",
  "bCov",
  "bCovInk",
  "bNone",
  "h2",
  "hInk",
  "you",
  "youHalo"
];
var SVG_TOKENS = {
  light: {
    bg: "#fcfcfd",
    ink: "#121519",
    muted: "#5d6570",
    faint: "#8a929c",
    rule: "#e2e5e9",
    grid: "#eceef1",
    i1: "#cfe7da",
    iInk: "#2a7552",
    p1: "#cddbf2",
    pInk: "#2c5597",
    u: "#d9c6e8",
    uInk: "#6b4a8c",
    b1: "#f3dedb",
    bInk: "#a8372b",
    bCov: "#e9e1d3",
    bCovInk: "#7a5d2c",
    bNone: "#f6ebe9",
    h2: "#eff1f4",
    hInk: "#6b7480",
    you: "#b97d00",
    youHalo: "#fbecc6"
  },
  dark: {
    bg: "#0d1014",
    ink: "#e6e9ee",
    muted: "#9aa3ae",
    faint: "#6f7884",
    rule: "#232a33",
    grid: "#1a2028",
    i1: "#173a2a",
    iInk: "#5fd09d",
    p1: "#1b2f52",
    pInk: "#86aef0",
    u: "#3a2b4f",
    uInk: "#c4a3ea",
    b1: "#43211f",
    bInk: "#f08a7e",
    bCov: "#3a3020",
    bCovInk: "#e0bb72",
    bNone: "#2c1c1b",
    h2: "#151a21",
    hInk: "#8994a2",
    you: "#ffc24d",
    youHalo: "#3b2e10"
  }
};
var TERM_PALETTE = {
  dark: {
    band: {
      alone: 1788469,
      proximal: 2112102,
      unstable: 4009301,
      blindCovered: 4864540,
      blindBare: 5907488,
      blind: 3876643,
      beyond: 1646117
    },
    ink: { line: 16761421, ricochet: 16747132, held: 7332012, faint: 7305348 },
    gap: 2436150,
    select: 15133166
  },
  light: {
    band: {
      alone: 13625306,
      proximal: 13491186,
      unstable: 14272232,
      blindCovered: 15327699,
      blindBare: 15982299,
      blind: 16182249,
      beyond: 15725044
    },
    ink: { line: 12156160, ricochet: 11024171, held: 2782546, faint: 9081500 },
    gap: 14935787,
    select: 1185049
  }
};
var BAND_FILL = {
  alone: "i1",
  proximal: "p1",
  unstable: "u",
  blindCovered: "bCov",
  blindBare: "b1",
  blind: "bNone",
  beyond: "h2"
};
var themeOf = (value) => {
  if (typeof value !== "string") return "auto";
  if (value.startsWith("dark")) return "dark";
  if (value.startsWith("light")) return "light";
  return "auto";
};

// src/conceitos/trajectory-bands.ts
var BANDS = {
  alone: { group: "alone", label: "own change or repair, gate green", status: "measured" },
  proximal: { group: "proximal", label: "prediction or check right", status: "measured" },
  unstable: { group: "discernment", label: "unstable boundary", status: "calibration" },
  blindCovered: { group: "blind", label: "receives with criterion", status: "measured" },
  blindBare: { group: "blind", label: "receives without criterion", status: "measured" },
  blind: { group: "blind", label: "no help recorded this week", status: "measured" },
  beyond: { group: "horizon", label: "no evidence of contact", status: "measured" }
};
var GROUPS = ["horizon", "blind", "discernment", "proximal", "alone"];
var GROUP_LABEL = {
  horizon: "beyond the horizon",
  blind: "blind band",
  discernment: "discernment",
  proximal: "proximal band",
  alone: "does alone"
};
var HYPOTHESES = {
  horizon: "recognizable vs out of reach",
  proximal: "explains vs detects only",
  alone: "transfer vs known context"
};
var BAND_ORDER = [
  "alone",
  "proximal",
  "unstable",
  "blindCovered",
  "blindBare",
  "blind",
  "beyond"
];
var filled = (week) => week.independent !== null && week.discernment !== null && week.assisted !== null;
var blindStrata = (week, from, to) => {
  const helps = week.blindCovered + week.blindBare;
  if (helps === 0) return [{ band: "blind", from, to }];
  const split = from + (to - from) * week.blindCovered / helps;
  return [
    { band: "blindCovered", from, to: split },
    { band: "blindBare", from: split, to }
  ];
};
var strataOf = (week, peak) => {
  if (!filled(week)) return [];
  const low = Math.max(week.independent, week.discernment - (week.unstable ?? 0));
  const high = week.discernment;
  return [
    { band: "alone", from: 0, to: week.independent },
    { band: "proximal", from: week.independent, to: low },
    { band: "unstable", from: low, to: high },
    ...blindStrata(week, high, week.assisted),
    { band: "beyond", from: week.assisted, to: Math.max(peak, week.assisted) }
  ].filter((stratum) => stratum.to > stratum.from);
};
var bandAt = (week, level, peak) => {
  const strata = strataOf(week, peak);
  if (strata.length === 0) return void 0;
  return strata.find((stratum) => level >= stratum.from && level < stratum.to)?.band ?? strata.at(-1)?.band;
};
var peakOf = (trajectory) => Math.max(
  1,
  ...trajectory.weeks.map((week) => (week.assisted ?? 0) + 1),
  ...trajectory.weeks.map((week) => week.work ?? 0)
);
var markLevel = (week) => {
  if (week.work !== null) return week.work;
  if (week.discernment === null || week.assisted === null) return null;
  return (week.discernment + Math.max(week.assisted, week.discernment + 1)) / 2;
};
var markIn = (marks, week) => {
  const here = marks.filter((mark) => mark.week === week);
  return here.find((mark) => mark.kind === "ricochet") ?? here[0];
};
var lastWeek = (trajectory) => [...trajectory.weeks].reverse().find((week) => filled(week));
var landedIn = (trajectory, week) => {
  const level = week.work;
  return level === null ? void 0 : bandAt(week, level, peakOf(trajectory));
};
var describeBand = (band) => band === "beyond" || band === "blind" ? GROUP_LABEL[BANDS[band].group] : `${GROUP_LABEL[BANDS[band].group]}, ${BANDS[band].label}`;

// src/conceitos/trajectory-term.ts
var ENGLISH_TERM = {
  band: {
    alone: "does alone",
    proximal: "proximal band",
    unstable: "unstable (calibration)",
    blindCovered: "blind, with criterion",
    blindBare: "blind, without criterion",
    blind: "blind, no help recorded",
    beyond: "beyond the horizon"
  },
  gap: "no evidence",
  line: "work landed",
  ricochet: "ricochet",
  held: "held",
  hypotheses: "not drawn (hypothesis): transfer vs known context, explains vs detects only, recognizable vs out of reach",
  noData: (evidence) => `no data (${String(evidence)} weighted events)`,
  head: (domain, from, to, evidence) => `${domain}, ${from} to ${to}, ${String(evidence)} weighted events`
};
var rowOf = (level, peak, rows) => Math.min(rows - 1, Math.max(0, Math.round(rows - level / peak * rows - 0.5)));
var bandCell = (week, level, peak) => {
  const band = bandAt(week, level, peak);
  return { glyph: " ", band: band ?? "gap", ink: null };
};
var pointCell = (trajectory, week, band) => {
  const mark = markIn(trajectory.marks, week.week);
  if (mark === void 0) return { glyph: "●", band, ink: "line" };
  return mark.kind === "ricochet" ? { glyph: "✕", band, ink: "ricochet" } : { glyph: "◉", band, ink: "held" };
};
var pointRows = (trajectory, peak, rows) => trajectory.weeks.map((week) => {
  const level = markIn(trajectory.marks, week.week) === void 0 ? week.work : markLevel(week);
  return level === null ? null : rowOf(level, peak, rows);
});
var trailRow = (points, column, perWeek) => {
  const center = Math.floor(perWeek / 2);
  const index = Math.floor((column - center) / perWeek);
  const from = points[index];
  const to = points[index + 1];
  if (from === null || from === void 0 || to === null || to === void 0) return null;
  const offset = column - (index * perWeek + center);
  if (offset <= 0 || offset >= perWeek) return null;
  return Math.round(from + (to - from) * offset / perWeek);
};
var gridOf = (trajectory, size) => {
  const peak = peakOf(trajectory);
  const points = pointRows(trajectory, peak, size.rows);
  const center = Math.floor(size.perWeek / 2);
  return Array.from({ length: size.rows }, (_, row2) => {
    const level = peak * (size.rows - row2 - 0.5) / size.rows;
    return trajectory.weeks.flatMap(
      (week, index) => Array.from({ length: size.perWeek }, (_unused, offset) => {
        const cell = bandCell(week, level, peak);
        if (offset === center && points[index] === row2) return pointCell(trajectory, week, cell.band);
        if (trailRow(points, index * size.perWeek + offset, size.perWeek) === row2)
          return { glyph: "·", band: cell.band, ink: "line" };
        return cell;
      })
    );
  });
};
var rowLabels = (trajectory, rows, labels) => {
  const peak = peakOf(trajectory);
  const week = lastWeek(trajectory);
  let previous = "";
  return Array.from({ length: rows }, (_, row2) => {
    const band = week === void 0 ? void 0 : bandAt(week, peak * (rows - row2 - 0.5) / rows, peak);
    const label = band === void 0 ? "" : labels.band[band];
    const shown = label === previous ? "" : label;
    previous = label;
    return shown;
  });
};
var axisLine = (trajectory, perWeek) => trajectory.weeks.map((week) => week.week.slice(-3).padEnd(perWeek).slice(0, perWeek)).join("");
var usedBands = (trajectory) => {
  const grid = gridOf(trajectory, { rows: 12, perWeek: 1 });
  const seen2 = new Set(grid.flat().map((cell) => cell.band));
  return BAND_ORDER.filter((band) => seen2.has(band));
};
var termPalette = (theme) => TERM_PALETTE[theme];

// src/conceitos/trajectory-ansi.ts
var LEVELS = [0, 95, 135, 175, 215, 255];
var nearest = (value) => LEVELS.reduce(
  (best, level, index) => Math.abs(level - value) < Math.abs((LEVELS[best] ?? 0) - value) ? index : best,
  0
);
var rgb = (color) => [
  color >> 16 & 255,
  color >> 8 & 255,
  color & 255
];
var PICKED = /* @__PURE__ */ new Map([
  [1788469, 22],
  [2112102, 17],
  [4009301, 60],
  [4864540, 58],
  [5907488, 52],
  [3876643, 95],
  [1646117, 234],
  [2436150, 238],
  [13625306, 151],
  [13491186, 153],
  [14272232, 183],
  [15327699, 187],
  [15982299, 217],
  [16182249, 224],
  [15725044, 255],
  [14935787, 252]
]);
var ansi256 = (color) => {
  const picked = PICKED.get(color);
  if (picked !== void 0) return picked;
  const [r, g, b] = rgb(color);
  const cube = 16 + 36 * nearest(r) + 6 * nearest(g) + nearest(b);
  const cubeRgb = [nearest(r), nearest(g), nearest(b)].map((index) => LEVELS[index] ?? 0);
  const gray = Math.min(23, Math.max(0, Math.round(((r + g + b) / 3 - 8) / 10)));
  const grayValue = 8 + gray * 10;
  const distance = (other) => (r - (other[0] ?? 0)) ** 2 + (g - (other[1] ?? 0)) ** 2 + (b - (other[2] ?? 0)) ** 2;
  return distance([grayValue, grayValue, grayValue]) < distance(cubeRgb) ? 232 + gray : cube;
};
var colorCode = (color, layer, depth) => {
  if (depth === "truecolor") return `${String(layer)};2;${rgb(color).join(";")}`;
  return `${String(layer)};5;${String(ansi256(color))}`;
};
var RESET = "\x1B[0m";
var style = (fg, bg, depth, bold) => {
  const codes = [
    ...bold ? ["1"] : [],
    ...fg === null ? [] : [colorCode(fg, 38, depth)],
    ...bg === null ? [] : [colorCode(bg, 48, depth)]
  ];
  return codes.length === 0 ? "" : `\x1B[${codes.join(";")}m`;
};
var PLAIN = {
  alone: "#",
  proximal: "=",
  unstable: "~",
  blindCovered: ":",
  blindBare: "/",
  blind: ".",
  beyond: " ",
  gap: "\\"
};
var PLAIN_GLYPH = { "●": "*", "·": "+", "✕": "X", "◉": "O" };
var plainCell = (cell) => cell.glyph === " " ? cell.band === null ? " " : PLAIN[cell.band] : PLAIN_GLYPH[cell.glyph] ?? cell.glyph;
var cellStyle = (cell, theme, depth) => {
  const palette = termPalette(theme);
  const bg = cell.band === null ? null : cell.band === "gap" ? palette.gap : palette.band[cell.band];
  const fg = cell.ink === null ? null : palette.ink[cell.ink];
  return style(fg, bg, depth, cell.ink !== null && cell.glyph !== "·");
};
var colorRow = (cells, theme, depth) => {
  let out = "";
  let current;
  for (const cell of cells) {
    const next = cellStyle(cell, theme, depth);
    if (next !== current) out += `${current === void 0 ? "" : RESET}${next}`;
    current = next;
    out += cell.glyph;
  }
  return `${out}${RESET}`;
};
var faint = (body, options) => options.depth === "none" || body === "" ? body : `${style(termPalette(options.theme).ink.faint, null, options.depth, false)}${body}${RESET}`;
var blockOf = (trajectory, options) => {
  const labels = options.labels ?? ENGLISH_TERM;
  if (trajectory.status === "no_data") return [`${trajectory.domain}: ${labels.noData(trajectory.evidence)}`];
  const size = options.size ?? { rows: 12, perWeek: 4 };
  const grid = gridOf(trajectory, size);
  const names = rowLabels(trajectory, size.rows, labels);
  const head = labels.head(
    trajectory.domain,
    trajectory.weeks[0]?.week ?? "",
    trajectory.weeks.at(-1)?.week ?? "",
    trajectory.evidence
  );
  return [
    head,
    ...grid.map((cells, row2) => {
      const body = options.depth === "none" ? cells.map(plainCell).join("") : colorRow(cells, options.theme, options.depth);
      const name = names[row2] ?? "";
      return name === "" ? body : `${body} ${faint(name, options)}`;
    }),
    faint(axisLine(trajectory, size.perWeek), options)
  ];
};
var swatch = (band, options) => {
  if (options.depth === "none") return PLAIN[band] === " " ? "' '" : PLAIN[band];
  const palette = termPalette(options.theme);
  return `${style(null, band === "gap" ? palette.gap : palette.band[band], options.depth, false)}  ${RESET}`;
};
var inkSwatch = (glyph2, ink, options) => options.depth === "none" ? PLAIN_GLYPH[glyph2] ?? glyph2 : `${style(termPalette(options.theme).ink[ink], null, options.depth, true)}${glyph2}${RESET}`;
var legendLines = (bands, options) => {
  const labels = options.labels ?? ENGLISH_TERM;
  const entries = [
    ...bands.map((band) => `${swatch(band, options)} ${labels.band[band]}`),
    `${swatch("gap", options)} ${labels.gap}`
  ];
  const rows = Array.from(
    { length: Math.ceil(entries.length / 4) },
    (_, index) => entries.slice(index * 4, index * 4 + 4).join("  ")
  );
  return [
    ...rows,
    [
      `${inkSwatch("●", "line", options)} ${labels.line}`,
      `${inkSwatch("✕", "ricochet", options)} ${labels.ricochet}`,
      `${inkSwatch("◉", "held", options)} ${labels.held}`
    ].join("  "),
    faint(labels.hypotheses, options)
  ];
};
var chartLines = (trajectories, options) => {
  const drawn = trajectories.filter((item) => item.status === "ok");
  const used = new Set(drawn.flatMap(usedBands));
  const bands = BAND_ORDER.filter((band) => used.has(band));
  return [
    ...trajectories.flatMap((item, index) => [...index === 0 ? [] : [""], ...blockOf(item, options)]),
    ...drawn.length === 0 ? [] : ["", ...legendLines(bands, options)]
  ];
};

// src/conceitos/trajectory-paint.ts
var FONT = "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
var escapeXml = (text5) => text5.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
var base = (theme) => SVG_TOKENS[theme === "dark" ? "dark" : "light"];
var isToken = (value) => TOKENS.includes(value);
var paint = (theme, ink) => {
  const tokens = base(theme);
  const fill = ink.fill;
  const classes = [
    ...ink.cls === void 0 ? [] : [ink.cls],
    ...fill !== void 0 && isToken(fill) ? [`f-${fill}`] : [],
    ...ink.stroke === void 0 ? [] : [`s-${ink.stroke}`]
  ];
  const fillValue = fill === void 0 ? "none" : isToken(fill) ? tokens[fill] : fill;
  return [
    ...classes.length === 0 ? [] : [`class="${classes.join(" ")}"`],
    `fill="${fillValue}"`,
    ...ink.stroke === void 0 ? [] : [`stroke="${tokens[ink.stroke]}"`]
  ].join(" ");
};
var styleOf = (theme) => {
  if (theme !== "auto") return "";
  const dark = SVG_TOKENS.dark;
  const rules = TOKENS.map((token) => `.f-${token}{fill:${dark[token]}}.s-${token}{stroke:${dark[token]}}`).join("");
  return `<style>@media (prefers-color-scheme: dark){${rules}}</style>`;
};
var text3 = (theme, at, body, options = {}) => `<text x="${num(at.x)}" y="${num(at.y)}" font-family="${FONT}" font-size="${String(options.size ?? 10.5)}"${options.anchor === void 0 ? "" : ` text-anchor="${options.anchor}"`}${options.extra === void 0 ? "" : ` ${options.extra}`} ${paint(theme, { fill: options.fill ?? "faint" })}>${escapeXml(body)}</text>`;
var num = (value) => String(Math.round(value * 10) / 10);
var defsOf = (theme) => [
  "<defs>",
  `<pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" ${paint(theme, { fill: "b1" })}/><line x1="0" y1="0" x2="0" y2="7" stroke-width="1.1" stroke-opacity="0.5" ${paint(theme, { stroke: "bInk" })}/></pattern>`,
  `<pattern id="dots" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" ${paint(theme, { fill: "bCov" })}/><circle cx="3" cy="3" r="0.9" fill-opacity="0.55" ${paint(theme, { fill: "bCovInk" })}/></pattern>`,
  `<pattern id="gap" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="5" height="5" ${paint(theme, { fill: "bg" })}/><line x1="0" y1="0" x2="0" y2="5" stroke-width="1" ${paint(theme, { stroke: "rule" })}/></pattern>`,
  "</defs>"
].join("");

// src/conceitos/trajectory-key.ts
var yOf = (plot, level) => plot.y0 - level / plot.peak * (plot.y0 - plot.y1);
var GROUP_INK = {
  horizon: "hInk",
  blind: "bInk",
  discernment: "uInk",
  proximal: "pInk",
  alone: "iInk"
};
var swatchOf = (band) => band === "blindBare" ? "url(#hatch)" : band === "blindCovered" ? "url(#dots)" : BAND_FILL[band];
var seen = (trajectory) => new Set(trajectory.weeks.flatMap((week) => strataOf(week, peakOf(trajectory)).map((stratum) => stratum.band)));
var linesOf = (group, present) => {
  const bands = BAND_ORDER.filter((band) => BANDS[band].group === group && (band !== "blind" || present.has(band)));
  const hypothesis = HYPOTHESES[group];
  return [
    ...bands.map((band) => ({ kind: "band", band })),
    ...hypothesis === void 0 ? [] : [{ kind: "hypothesis", label: hypothesis }]
  ];
};
var rangeOf = (week, group, peak) => {
  if (week === void 0) return void 0;
  const mine = strataOf(week, peak).filter((stratum) => BANDS[stratum.band].group === group);
  if (mine.length === 0) return void 0;
  return [Math.min(...mine.map((item) => item.from)), Math.max(...mine.map((item) => item.to))];
};
var LH = 13;
var GAP = 8;
var placed = (plot, trajectory) => {
  const week = lastWeek(trajectory);
  const present = seen(trajectory);
  let floor = plot.top;
  const blocks = GROUPS.map((group) => {
    const lines = linesOf(group, present);
    const range = rangeOf(week, group, plot.peak);
    const height = LH * (1 + lines.reduce((sum, line2) => sum + (line2.kind === "hypothesis" ? 2 : 1), 0));
    const want = range === void 0 ? floor : (yOf(plot, range[1]) + yOf(plot, range[0])) / 2 - height / 2;
    const top = Math.max(want, floor);
    floor = top + height + GAP;
    return { group, lines, range, height, top };
  });
  let ceil = plot.bottom;
  for (const block of [...blocks].reverse()) {
    block.top = Math.min(block.top, ceil - block.height);
    ceil = block.top - GAP;
  }
  return blocks;
};
var bandLine2 = (theme, band, x, y) => {
  const info = BANDS[band];
  const label = info.status === "calibration" ? `${info.label} · calibration` : info.label;
  const dashed = band === "unstable" ? ` stroke-dasharray="3 2"` : "";
  const stroke = band === "unstable" ? "uInk" : "rule";
  return [
    `<rect x="${num(x)}" y="${num(y - 8)}" width="9" height="9" stroke-width="0.8"${dashed} ${paint(theme, { cls: `key-swatch key-${band}`, fill: swatchOf(band), stroke })}/>`,
    text3(theme, { x: x + 14, y }, label, { size: 10, fill: "muted" })
  ].join("");
};
var hypothesisLine = (theme, label, x, y) => [
  `<rect x="${num(x)}" y="${num(y - 8)}" width="9" height="9" stroke-width="0.8" stroke-dasharray="2 2" ${paint(theme, { cls: `key-hypothesis`, stroke: "faint" })}/>`,
  text3(theme, { x: x + 14, y }, label, { size: 10, fill: "faint", extra: 'font-style="italic"' }),
  text3(theme, { x: x + 14, y: y + LH }, "hypothesis, not drawn", {
    size: 9.5,
    fill: "faint",
    extra: 'font-style="italic"'
  })
].join("");
var blockOf2 = (theme, plot, block) => {
  const ink = GROUP_INK[block.group];
  const kx = plot.x1 + 22;
  const ty = block.top + LH - 3;
  const parts = [];
  if (block.range !== void 0) {
    const yTop = yOf(plot, block.range[1]);
    const yBottom = yOf(plot, block.range[0]);
    const mid = (yTop + yBottom) / 2;
    parts.push(
      `<path d="M ${num(plot.x1 + 3)} ${num(yTop + 1)} L ${num(plot.x1 + 8)} ${num(yTop + 1)} L ${num(plot.x1 + 8)} ${num(yBottom - 1)} L ${num(plot.x1 + 3)} ${num(yBottom - 1)}" stroke-width="1.2" ${paint(theme, { cls: `key-bracket`, stroke: ink })}/>`,
      `<path d="M ${num(plot.x1 + 8)} ${num(mid)} L ${num(kx - 6)} ${num(ty - 4)}" stroke-width="0.8" stroke-opacity="0.6" ${paint(theme, { stroke: ink })}/>`
    );
  }
  parts.push(text3(theme, { x: kx, y: ty }, GROUP_LABEL[block.group], { fill: ink, extra: 'font-weight="700"' }));
  let row2 = 1;
  for (const line2 of block.lines) {
    const y = ty + LH * row2;
    parts.push(line2.kind === "band" ? bandLine2(theme, line2.band, kx, y) : hypothesisLine(theme, line2.label, kx, y));
    row2 += line2.kind === "hypothesis" ? 2 : 1;
  }
  return `<g class="key-group key-${block.group}">${parts.join("")}</g>`;
};
var keyOf = (theme, plot, trajectory) => `<g class="key">${placed(plot, trajectory).map((block) => blockOf2(theme, plot, block)).join("")}</g>`;

// src/conceitos/trajectory-svg.ts
var SVG_WIDTH = 900;
var SVG_HEIGHT = 400;
var LEFT = 46;
var RIGHT = 236;
var TOP = 14;
var BOTTOM = 36;
var frameOf = (trajectory) => {
  const x0 = LEFT;
  const x1 = SVG_WIDTH - RIGHT;
  const n = trajectory.weeks.length;
  const xs = trajectory.weeks.map((_, index) => x0 + 14 + (n > 1 ? index / (n - 1) : 0.5) * (x1 - x0 - 28));
  const half = n > 1 ? ((xs[1] ?? 0) - (xs[0] ?? 0)) / 2 : (x1 - x0) / 2;
  const y0 = SVG_HEIGHT - BOTTOM;
  return { x0, x1, y0, y1: TOP, top: TOP, bottom: y0, peak: peakOf(trajectory), xs, half };
};
var runsOf = (weeks, keep) => {
  const runs = [];
  let run = [];
  weeks.forEach((week, index) => {
    if (keep(week)) run.push(index);
    else {
      if (run.length > 0) runs.push(run);
      run = [];
    }
  });
  if (run.length > 0) runs.push(run);
  return runs;
};
var spanOf = (week, band, peak) => {
  const strata = strataOf(week, peak);
  const own = strata.find((stratum) => stratum.band === band);
  if (own !== void 0) return [own.from, own.to];
  const after = strata.find((stratum) => BAND_ORDER.indexOf(stratum.band) > BAND_ORDER.indexOf(band));
  const at = after?.from ?? peak;
  return [at, at];
};
var filled2 = (week) => week.assisted !== null;
var bandPath = (theme, frame, band, columns) => {
  const top = columns.map(({ x, span: span2 }) => `${num(x)} ${num(yOf(frame, span2[1]))}`);
  const bottom = columns.map(({ x, span: span2 }) => `${num(x)} ${num(yOf(frame, span2[0]))}`).reverse();
  const d = `M ${top.join(" L ")} L ${bottom.join(" L ")} Z`;
  const edge = band === "unstable" ? [top, bottom].map(
    (points) => `<path d="M ${points.join(" L ")}" stroke-width="1" stroke-dasharray="4 3" ${paint(theme, { cls: `band-edge`, stroke: "uInk" })}/>`
  ).join("") : "";
  const opacity = band === "unstable" ? ' fill-opacity="0.85"' : "";
  return `<path d="${d}"${opacity} ${paint(theme, { cls: `band band-${band}`, fill: swatchOf(band) })}><title>${escapeXml(BANDS[band].label)}</title></path>${edge}`;
};
var strataPaths = (theme, frame, weeks) => runsOf(weeks, filled2).flatMap((run) => {
  const single = run.length === 1;
  const points = run.flatMap((index) => {
    const week = weeks[index];
    const x = frame.xs[index] ?? 0;
    if (week === void 0) return [];
    return single ? [
      { x: x - frame.half * 0.8, week },
      { x: x + frame.half * 0.8, week }
    ] : [{ x, week }];
  });
  return BAND_ORDER.flatMap((band) => {
    const columns = points.map(({ x, week }) => ({ x, span: spanOf(week, band, frame.peak) }));
    return columns.some(({ span: span2 }) => span2[1] > span2[0]) ? [bandPath(theme, frame, band, columns)] : [];
  });
});
var gapRects = (theme, frame, weeks) => weeks.flatMap(
  (week, index) => filled2(week) ? [] : [
    `<rect x="${num((frame.xs[index] ?? 0) - frame.half)}" y="${num(frame.y1)}" width="${num(frame.half * 2)}" height="${num(frame.y0 - frame.y1)}" ${paint(theme, { cls: `gap`, fill: "url(#gap)" })}><title>${escapeXml(`${week.week}: no evidence`)}</title></rect>`
  ]
);
var ticksOf = (peak) => {
  const step = Math.max(1, Math.ceil(peak / 5));
  return Array.from({ length: Math.floor(peak / step) + 1 }, (_, index) => index * step);
};
var axes = (theme, frame, weeks) => [
  ...ticksOf(frame.peak).flatMap((value) => [
    `<line x1="${num(frame.x0)}" x2="${num(frame.x1)}" y1="${num(yOf(frame, value))}" y2="${num(yOf(frame, value))}" stroke-width="1" stroke-opacity="0.6" ${paint(theme, { cls: `grid`, stroke: "rule" })}/>`,
    text3(theme, { x: frame.x0 - 8, y: yOf(frame, value) + 4 }, String(value), { anchor: "end" })
  ]),
  ...weeks.map(
    (week, index) => text3(theme, { x: frame.xs[index] ?? 0, y: frame.y0 + 18 }, week.week.slice(-3), { anchor: "middle" })
  ),
  `<line x1="${num(frame.x0)}" x2="${num(frame.x1)}" y1="${num(frame.y0)}" y2="${num(frame.y0)}" stroke-width="1" ${paint(theme, { stroke: "ink" })}/>`,
  text3(theme, { x: 12, y: (frame.y0 + frame.y1) / 2 }, "concepts on record", {
    anchor: "middle",
    extra: `transform="rotate(-90 12 ${num((frame.y0 + frame.y1) / 2)})"`
  })
];
var curve = (points) => points.reduce((path, [x, y], index) => {
  if (index === 0) return `M ${num(x)} ${num(y)}`;
  const [px, py] = points[index - 1] ?? [x, y];
  const mid = (px + x) / 2;
  return `${path} C ${num(mid)} ${num(py)}, ${num(mid)} ${num(y)}, ${num(x)} ${num(y)}`;
}, "");
var workLine = (theme, frame, trajectory) => runsOf(trajectory.weeks, (week) => week.work !== null).flatMap((run) => {
  const points = run.map((index) => [
    frame.xs[index] ?? 0,
    yOf(frame, trajectory.weeks[index]?.work ?? 0)
  ]);
  const dots = run.flatMap((index) => {
    const week = trajectory.weeks[index];
    if (week === void 0 || markIn(trajectory.marks, week.week) !== void 0) return [];
    const band = landedIn(trajectory, week);
    const where = band === void 0 ? "" : ` · landed in ${BANDS[band].label}`;
    return [
      `<circle cx="${num(frame.xs[index] ?? 0)}" cy="${num(yOf(frame, week.work ?? 0))}" r="3.2" ${paint(theme, { cls: `point`, fill: "you" })}><title>${escapeXml(`${week.week}${where}`)}</title></circle>`
    ];
  });
  const line2 = points.length > 1 ? [
    `<path d="${curve(points)}" stroke-width="2.6" stroke-linecap="round" ${paint(theme, { cls: `work`, stroke: "you" })}/>`
  ] : [];
  return [...line2, ...dots];
});
var markTitle = (mark) => `${mark.kind} · ${mark.concept} · ${mark.evidence.map((item) => `${item.kind} ${item.task ?? "-"} ${item.file ?? "-"} ${item.at}`).join("; ")}`;
var markShape = (theme, mark, x, y) => mark.kind === "ricochet" ? `<circle cx="${num(x)}" cy="${num(y)}" r="6.5" stroke-width="2" ${paint(theme, { fill: "bg", stroke: "bInk" })}/><path d="M ${num(x - 3)} ${num(y - 3)} L ${num(x + 3)} ${num(y + 3)} M ${num(x + 3)} ${num(y - 3)} L ${num(x - 3)} ${num(y + 3)}" stroke-width="1.8" ${paint(theme, { stroke: "bInk" })}/>` : `<circle cx="${num(x)}" cy="${num(y)}" r="6.5" stroke-width="2" ${paint(theme, { fill: "bg", stroke: "iInk" })}/><circle cx="${num(x)}" cy="${num(y)}" r="2.6" ${paint(theme, { fill: "iInk" })}/>`;
var pointOf = (frame, weeks, key) => {
  const index = weeks.findIndex((week2) => week2.week === key);
  const week = weeks[index];
  const level = week === void 0 ? null : markLevel(week);
  return level === null ? void 0 : [frame.xs[index] ?? 0, yOf(frame, level)];
};
var ricochetTrail = (theme, frame, weeks, mark, at) => {
  const [x, y] = at;
  const week = weeks.find((item) => item.week === mark.week);
  const from = pointOf(frame, weeks, mark.from);
  const arc = from === void 0 || from[0] === x ? "" : `<path d="M ${num(from[0])} ${num(from[1])} Q ${num((from[0] + x) / 2)} ${num(Math.min(from[1], y) - 40)} ${num(x)} ${num(y)}" stroke-width="1.2" stroke-dasharray="3 3" ${paint(theme, { cls: `ricochet-arc`, stroke: "bInk" })}/>`;
  const drop = yOf(frame, week?.independent ?? 0);
  if (drop <= y + 7) return arc;
  const end = x > frame.x1 - 150;
  return `${arc}<line x1="${num(x)}" y1="${num(y + 7)}" x2="${num(x)}" y2="${num(drop)}" stroke-width="1.2" stroke-dasharray="1 3" ${paint(theme, { cls: `rebuild`, stroke: "bInk" })}/>${text3(theme, { x: x + (end ? -6 : 6), y: drop - 4 }, "what the person rebuilds", { size: 10, fill: "bInk", anchor: end ? "end" : "start" })}`;
};
var marksOf = (theme, frame, trajectory, selected) => trajectory.marks.flatMap((mark) => {
  const at = pointOf(frame, trajectory.weeks, mark.week);
  if (at === void 0) return [];
  const ring = selected?.week === mark.week && selected.concept === mark.concept && selected.at === mark.at ? `<circle cx="${num(at[0])}" cy="${num(at[1])}" r="11" stroke-width="1.2" ${paint(theme, { cls: `selected`, stroke: "ink" })}/>` : "";
  const trail = mark.kind === "ricochet" ? ricochetTrail(theme, frame, trajectory.weeks, mark, at) : "";
  return [
    `${trail}<g class="mark-${mark.kind}">${ring}${markShape(theme, mark, at[0], at[1])}<title>${escapeXml(markTitle(mark))}</title></g>`
  ];
});
var shell = (theme, height, title, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${String(SVG_WIDTH)}" height="${String(height)}" viewBox="0 0 ${String(SVG_WIDTH)} ${String(height)}" data-theme="${theme}" role="img"><title>${escapeXml(title)}</title>${styleOf(theme)}${defsOf(theme)}<rect width="${String(SVG_WIDTH)}" height="${String(height)}" ${paint(theme, { cls: `background`, fill: "bg" })}/>${body.join("")}</svg>`;
var svgOf = (trajectory, options = {}) => {
  const theme = options.theme ?? "auto";
  if (trajectory.status === "no_data")
    return shell(theme, 60, `${trajectory.domain}: no data`, [
      text3(theme, { x: 8, y: 34 }, `${trajectory.domain}: no data (${String(trajectory.evidence)} weighted events)`, {
        size: 13,
        fill: "muted"
      })
    ]);
  const frame = frameOf(trajectory);
  const title = `${trajectory.domain}: where accepted work landed per week across the bands, with ricochets marked`;
  return shell(theme, SVG_HEIGHT, title, [
    `<rect x="${num(frame.x0)}" y="${num(frame.y1)}" width="${num(frame.x1 - frame.x0)}" height="${num(frame.y0 - frame.y1)}" ${paint(theme, { cls: `plot`, fill: "h2" })}/>`,
    ...gapRects(theme, frame, trajectory.weeks),
    ...strataPaths(theme, frame, trajectory.weeks),
    ...axes(theme, frame, trajectory.weeks),
    keyOf(theme, frame, trajectory),
    ...workLine(theme, frame, trajectory),
    ...marksOf(theme, frame, trajectory, options.selected)
  ]);
};

// src/conceitos/trajectory-chart.ts
var BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var base64 = (bytes) => {
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    const triple = a << 16 | b << 8 | c;
    out += BASE64[triple >> 18 & 63] ?? "";
    out += BASE64[triple >> 12 & 63] ?? "";
    out += index + 1 < bytes.length ? BASE64[triple >> 6 & 63] ?? "" : "=";
    out += index + 2 < bytes.length ? BASE64[triple & 63] ?? "" : "=";
  }
  return out;
};
var word = (value) => [
  value & 255,
  value >>> 8 & 255,
  value >>> 16 & 255,
  value >>> 24 & 255
];
var DEFAULT_COLOR = 16777216;
var LABEL_WIDTH = 24;
var GRID_ROWS = 12;
var isSelected = (trajectory, index, selected) => selected !== void 0 && trajectory.weeks[index]?.week === selected.week;
var colored = (cell, theme, selected) => {
  const palette = termPalette(theme);
  const bg = cell.band === null ? DEFAULT_COLOR : cell.band === "gap" ? palette.gap : palette.band[cell.band];
  const marked = selected && (cell.ink === "ricochet" || cell.ink === "held");
  return {
    glyph: cell.glyph,
    fg: cell.ink === null ? DEFAULT_COLOR : palette.ink[cell.ink],
    bg: marked ? palette.select : bg
  };
};
var textCells = (body, width, fg) => Array.from({ length: width }, (_, index) => ({ glyph: body[index] ?? " ", fg, bg: DEFAULT_COLOR }));
var rasterShape = (trajectory, columns) => {
  const weeks = Math.max(trajectory.weeks.length, 1);
  const perWeek = Math.min(6, Math.max(2, Math.floor((columns - LABEL_WIDTH - 1) / weeks)));
  return { perWeek, columns: weeks * perWeek + 1 + LABEL_WIDTH, rows: GRID_ROWS + 1 };
};
var rasterCells = (trajectory, columns, options) => {
  const shape = rasterShape(trajectory, columns);
  const faint2 = termPalette(options.theme).ink.faint;
  const grid = gridOf(trajectory, { rows: GRID_ROWS, perWeek: shape.perWeek });
  const names = rowLabels(trajectory, GRID_ROWS, options.labels ?? ENGLISH_TERM);
  const plotWidth = shape.columns - 1 - LABEL_WIDTH;
  return [
    ...grid.flatMap((cells, row2) => [
      ...cells.map(
        (cell, column) => colored(cell, options.theme, isSelected(trajectory, Math.floor(column / shape.perWeek), options.selected))
      ),
      ...textCells(` ${names[row2] ?? ""}`, LABEL_WIDTH + 1, faint2)
    ]),
    ...textCells(axisLine(trajectory, shape.perWeek), plotWidth, faint2),
    ...textCells("", LABEL_WIDTH + 1, faint2)
  ];
};
var rasterOf = (trajectory, columns, options) => {
  const shape = rasterShape(trajectory, columns);
  const bytes = rasterCells(trajectory, columns, options).flatMap((cell) => [
    ...word(cell.glyph.codePointAt(0) ?? 32),
    ...word(cell.fg),
    ...word(cell.bg)
  ]);
  return { columns: shape.columns, rows: shape.rows, cells: base64(bytes) };
};

// src/mod/trajectory-parse.ts
var DOMAIN_NAMES = ["product", "interface", "backend", "infrastructure", "security"];
var CONCEPTS = [
  "api",
  "migration",
  "webhook",
  "idempotency",
  "force-push",
  "merge-conflict",
  "secret-in-code",
  "immutable-deploy"
];
var isRecord6 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var records = (value) => Array.isArray(value) ? value.filter(isRecord6) : [];
var str3 = (record, key) => typeof record[key] === "string" ? record[key] : "";
var orNull = (record, key) => typeof record[key] === "number" ? record[key] : null;
var num2 = (record, key) => typeof record[key] === "number" ? record[key] : 0;
var concept = (value) => CONCEPTS.find((item) => item === value) ?? "api";
var weekOf = (item) => ({
  week: str3(item, "week"),
  independent: orNull(item, "independent"),
  discernment: orNull(item, "discernment"),
  assisted: orNull(item, "assisted"),
  blindCovered: num2(item, "blindCovered"),
  blindBare: num2(item, "blindBare"),
  unstable: orNull(item, "unstable"),
  work: orNull(item, "work"),
  evidence: num2(item, "evidence")
});
var refOf = (item) => ({
  kind: str3(item, "kind"),
  at: str3(item, "at"),
  concept: concept(item["concept"]),
  task: typeof item["task"] === "string" ? item["task"] : null,
  file: typeof item["file"] === "string" ? item["file"] : null
});
var markOf2 = (item) => ({
  kind: item["kind"] === "held" ? "held" : "ricochet",
  week: str3(item, "week"),
  concept: concept(item["concept"]),
  at: str3(item, "at"),
  from: typeof item["from"] === "string" ? item["from"] : null,
  evidence: records(item["evidence"]).map(refOf)
});
var parseTrajectories = (text5) => {
  let parsed;
  try {
    parsed = JSON.parse(text5);
  } catch {
    return [];
  }
  const data = isRecord6(parsed) && isRecord6(parsed["data"]) ? parsed["data"] : parsed;
  if (!isRecord6(data) || data["schema"] !== "finitemonkey/trajectory@1") return [];
  return records(data["domains"]).flatMap((item) => {
    const domain = DOMAIN_NAMES.find((name) => name === item["domain"]);
    if (domain === void 0) return [];
    return [
      {
        domain,
        status: item["status"] === "ok" ? "ok" : "no_data",
        evidence: num2(item, "evidence"),
        weeks: records(item["weeks"]).map(weekOf),
        marks: records(item["marks"]).map(markOf2),
        position: typeof item["position"] === "string" ? item["position"] : null
      }
    ];
  });
};

// src/mod/trajectory-view.ts
var TRAJECTORY_PANE = "fm-trajectory";
var MAX_COLUMNS = 120;
var glyph = (mark) => mark.kind === "ricochet" ? "✕" : "◉";
var sameMark = (a, b) => a?.week === b.week && a.concept === b.concept && a.at === b.at;
var CAPTION = "Each column is a week. Strata show where the record puts each concept: done alone, judged (prediction or check right), the unstable boundary, the blind band split by criterion, and beyond the horizon. The amber line is where accepted work landed; ✕ is a ricochet, ◉ held. Hatched columns are weeks with no evidence. Sub-bands the record does not hold are listed as hypotheses and not drawn.";
var markText = (mark) => mark.kind === "ricochet" ? "A hunk accepted without evidence of judgment broke later and the fix did not come from the person." : "A hunk broke later and the person made the fix.";
var evidenceLines = (mark, trajectory) => {
  const week = trajectory?.weeks.find((item) => item.week === mark.week);
  const level = week === void 0 ? null : markLevel(week);
  const band = week === void 0 || level === null || trajectory === void 0 ? void 0 : bandAt(week, level, peakOf(trajectory));
  return [
    `${glyph(mark)} ${mark.kind} · ${mark.concept} · ${mark.week}`,
    markText(mark),
    ...band === void 0 ? [] : [`zone: ${GROUP_LABEL[BANDS[band].group]} · sub-band: ${BANDS[band].label}`],
    ...mark.from === null ? [] : [`accepted in ${mark.from}`],
    ...mark.evidence.map(
      (item) => `  evidence: ${item.kind} · task ${item.task ?? "-"} · ${item.file ?? "-"} · ${item.at.slice(0, 16).replace("T", " ")}`
    )
  ];
};
var span = (from, to) => from === null || to === null ? "-" : `${String(from)}-${String(to)}`;
var weekRow = (trajectory, week) => {
  if (week.assisted === null) return `${week.week.slice(-3)}  no evidence`;
  const band = landedIn(trajectory, week);
  const marks = trajectory.marks.filter((mark) => mark.week === week.week);
  return [
    week.week.slice(-3),
    (band === void 0 ? "no accepted work" : describeBand(band)).padEnd(38),
    span(week.independent, week.discernment).padEnd(7),
    span(week.discernment, week.assisted).padEnd(7),
    marks.length === 0 ? "-" : marks.map((mark) => `${glyph(mark)} ${mark.kind} ${mark.concept}`).join(", ")
  ].join("  ");
};
var weekLines = (trajectory) => [
  `week ${"work landed in".padEnd(38)}  ${"proximal".padEnd(7)}  ${"blind".padEnd(7)}  event`,
  ...trajectory.weeks.map((week) => weekRow(trajectory, week))
];
var trajectoryText = (domains) => chartLines(domains, { depth: "none", theme: "dark" }).join("\n");
var chartOf = (elements, item, look, selected) => {
  const raster = elements.Raster;
  const svg = elements.Svg;
  if (look.surface === "terminal" && raster !== void 0) {
    const theme = look.theme === "light" ? "light" : "dark";
    const cells = rasterOf(item, Math.max(40, Math.min(look.columns, MAX_COLUMNS)), {
      theme,
      ...selected === void 0 ? {} : { selected }
    });
    return raster({ key: `fm-trajectory-raster-${item.domain}`, ...cells });
  }
  if (look.surface !== "terminal" && svg !== void 0)
    return svg({
      key: `fm-trajectory-svg-${item.domain}`,
      source: svgOf(item, { theme: look.theme, ...selected === void 0 ? {} : { selected } }),
      alt: `${item.domain}: where accepted work landed per week across the bands, with ricochets marked`,
      isInteractive: true
    });
  return elements.Text({ key: `fm-trajectory-text-${item.domain}`, children: [trajectoryText([item])] });
};
var markButtons = (elements, item, selected, actions) => item.marks.length === 0 ? [] : [
  elements.Box({
    key: `fm-trajectory-marks-${item.domain}`,
    flexDirection: "row",
    columnGap: 2,
    children: item.marks.map(
      (mark, index) => elements.Button({
        key: `fm-trajectory-mark-${item.domain}-${String(index)}`,
        label: `${sameMark(selected, mark) ? "▸ " : ""}${glyph(mark)} ${mark.week.slice(-3)} ${mark.concept} ${mark.kind}`,
        onPress: () => actions.select(mark)
      })
    )
  })
];
var detailOf = (elements, item, selected) => {
  const mark = item.marks.find((candidate) => sameMark(selected, candidate));
  if (mark === void 0) return [];
  return evidenceLines(mark, item).map(
    (line2, index) => elements.Text({
      key: `fm-trajectory-evidence-${item.domain}-${String(index)}`,
      bold: index === 0,
      children: [line2]
    })
  );
};
var domainOf = (elements, item, selected, look, actions) => {
  if (item.status !== "ok")
    return [
      elements.Text({
        key: `fm-trajectory-head-${item.domain}`,
        dimColor: true,
        children: [`${item.domain}: no data (${String(item.evidence)} weighted events)`]
      })
    ];
  const first = item.weeks[0]?.week ?? "";
  const last = item.weeks.at(-1)?.week ?? "";
  return [
    elements.Text({
      key: `fm-trajectory-head-${item.domain}`,
      bold: true,
      children: [`Trajectory · ${item.domain} · ${first} to ${last} · ${String(item.evidence)} weighted events`]
    }),
    chartOf(elements, item, look, selected),
    elements.Text({ key: `fm-trajectory-events-head-${item.domain}`, bold: true, children: ["Events"] }),
    ...markButtons(elements, item, selected, actions),
    ...detailOf(elements, item, selected),
    ...weekLines(item).map(
      (line2, index) => elements.Text({
        key: `fm-trajectory-week-${item.domain}-${String(index)}`,
        dimColor: index === 0,
        children: [line2]
      })
    )
  ];
};
var trajectoryTree = (elements, domains, selected, look, actions) => elements.Box({
  key: "fm-trajectory",
  flexDirection: "column",
  children: [
    ...domains.flatMap((item) => domainOf(elements, item, selected, look, actions)),
    elements.Text({ key: "fm-trajectory-caption", dimColor: true, children: [CAPTION] }),
    elements.Button({ key: "fm-trajectory-close", label: "Close", hotkey: "x", onPress: actions.close })
  ]
});

// src/mod/trajectory-hooks.ts
var DEFAULT_COLUMNS = 72;
function selectMark($, mark) {
  memory.selectedMark = mark;
  $.ui.invalidate("ui.render");
  return Promise.resolve();
}
async function readTheme($) {
  try {
    const rows = await $.config.list();
    memory.theme = themeOf(rows.find((row2) => row2.key === "theme")?.value);
  } catch {
    memory.theme = "auto";
  }
}
function renderTrajectory($, e) {
  const columns = (e.props?.bodyColumns ?? DEFAULT_COLUMNS) - 2;
  return trajectoryTree(
    $.ui.resolve(e),
    memory.trajectory,
    memory.selectedMark,
    { surface: e.surface, columns, theme: memory.theme },
    {
      select: (mark) => selectMark($, mark),
      close: () => $.ui.close({ id: TRAJECTORY_PANE })
    }
  );
}
async function trajectoryNow($) {
  const text5 = await runCli($, ["trajectory", "--json"]);
  const domains = text5 === void 0 ? [] : parseTrajectories(text5);
  memory.trajectory = domains;
  memory.selectedMark = void 0;
  const surfaces = await $.session.surfaces();
  if (surfaces.length > 0) {
    await readTheme($);
    await $.ui.open({ id: TRAJECTORY_PANE, title: "Finite Monkey · trajectory" });
    return {};
  }
  return { text: domains.length === 0 ? "finitemonkey: no trajectory in this folder" : trajectoryText(domains) };
}

// src/mod/xray-view.ts
var XRAY_PANE = "fm-xray";
var isRecord7 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var str4 = (record, key) => typeof record[key] === "string" ? record[key] : "";
var num3 = (record, key) => typeof record[key] === "number" ? record[key] : 0;
var dataOf = (text5, schema) => {
  let parsed;
  try {
    parsed = JSON.parse(text5);
  } catch {
    return void 0;
  }
  const data = isRecord7(parsed) && isRecord7(parsed["data"]) ? parsed["data"] : parsed;
  return isRecord7(data) && data["schema"] === schema ? data : void 0;
};
var records2 = (value) => Array.isArray(value) ? value.filter(isRecord7) : [];
var parseXray = (text5) => {
  const data = dataOf(text5, "finitemonkey/xray@1");
  if (data === void 0) return void 0;
  return {
    task: str4(data, "task"),
    beyond: num3(data, "beyondWithoutCriterion"),
    items: records2(data["items"]).map((item) => ({
      file: str4(item, "file"),
      start: num3(item, "start"),
      end: num3(item, "end"),
      band: str4(item, "band"),
      coverage: str4(item, "coverage"),
      concepts: records2(item["concepts"]).map((entry) => str4(entry, "concept")),
      by: str4(item, "by")
    }))
  };
};
var parseConcepts = (text5) => records2(dataOf(text5, "finitemonkey/concept-evidence@1")?.["concepts"]).map((item) => ({
  concept: str4(item, "concept"),
  domain: str4(item, "domain"),
  state: str4(item, "state"),
  positive: num3(item, "positive"),
  negative: num3(item, "negative"),
  exposures: num3(item, "exposures")
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
var escape = (text5) => text5.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
  const text5 = elements.Text({ key: `fm-xray-text-${key}`, children: [rowLine2(row2)] });
  if (!needsAction(row2)) return text5;
  return elements.Box({
    key: `fm-xray-item-${key}`,
    flexDirection: "column",
    children: [
      text5,
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
  const text5 = await runCli($, ["status", "--json"]);
  const view = text5 === void 0 ? void 0 : parseStatus(text5);
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
  if (e.requestId === TRAJECTORY_PANE) return renderTrajectory($, e);
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
  if (e.args.trim() === "trajectory") return trajectoryNow($);
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
var isRecord8 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
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
  if (!isRecord8(value)) return void 0;
  const { id, target, pattern, reason } = value;
  const known = TARGETS.find((item) => item === target);
  if (typeof id !== "string" || known === void 0 || typeof pattern !== "string" || typeof reason !== "string")
    return void 0;
  const regex = compile(pattern);
  return regex === void 0 ? void 0 : { rule: { id, target: known, pattern, reason }, regex };
};
var attributionOf = (value) => {
  if (!isRecord8(value) || typeof value["forbid"] !== "boolean") return void 0;
  const trailer = value["trailer"];
  return { forbid: value["forbid"], trailer: typeof trailer === "string" && trailer !== "" ? trailer : null };
};
var dataOf2 = (parsed) => isRecord8(parsed) && isRecord8(parsed["data"]) ? parsed["data"] : parsed;
var parseModState = (text5) => {
  let parsed;
  try {
    parsed = JSON.parse(text5);
  } catch {
    return void 0;
  }
  const data = dataOf2(parsed);
  if (!isRecord8(data) || data["schema"] !== MOD_STATE_SCHEMA || typeof data["root"] !== "string") return void 0;
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
var isRecord9 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var text4 = (input, ...names) => {
  if (!isRecord9(input)) return void 0;
  for (const name of names) {
    const value = input[name];
    if (typeof value === "string" && value !== "") return value;
  }
  return void 0;
};
var posix = (path) => path.replaceAll("\\", "/");
var relativeTo = (root, path) => {
  const base2 = posix(root).replace(/\/+$/, "");
  const full = posix(path);
  const sameCase = /^[A-Za-z]:\//.test(base2) ? full.toLowerCase().startsWith(`${base2.toLowerCase()}/`) : false;
  if (full.startsWith(`${base2}/`) || sameCase) return full.slice(base2.length + 1);
  return full.replace(/^\.\//, "");
};
var firstMatch = (rules, value) => rules.find((rule) => rule.regex.test(value));
var ruleFor = (state, tool, input) => {
  if (FILE_TOOLS.has(tool)) {
    const path = text4(input, "file_path", "notebook_path");
    if (path === void 0) return void 0;
    const rules = state.rules.filter((rule) => rule.rule.target === "path");
    return firstMatch(rules, relativeTo(state.root, path));
  }
  if (SHELL_TOOLS.has(tool)) {
    const command = text4(input, "command");
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
  const text5 = await runCli($, ["mod", "state", "--json"]);
  const state = text5 === void 0 ? void 0 : parseModState(text5);
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

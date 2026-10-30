import type { Elements, ModElement } from "./api.js";

export const CONTRACT_PANE = "fm-contract";
export const DIVERGE_PANE = "fm-diverge";
const TASK_SCHEMA = "finitemonkey/task@1";

export interface ContractItem {
  readonly id: string;
  readonly says: string;
  readonly status: string;
}

export interface ContractView {
  readonly task: string;
  readonly goal: string;
  readonly hash: string;
  readonly digest: string;
  readonly trusted: boolean;
  readonly checks: readonly ContractItem[];
  readonly examples: readonly ContractItem[];
}

export interface DivergeOption {
  readonly letter: string;
  readonly output: string;
}

export interface DivergeView {
  readonly task: string;
  readonly input: string;
  readonly options: readonly DivergeOption[];
}

export interface ContractActions {
  readonly approve: () => Promise<void>;
  readonly decide: (id: string, verdict: "approve" | "reject") => Promise<void>;
  readonly edit: () => Promise<void>;
  readonly reject: () => Promise<void>;
}

export interface DivergeActions {
  readonly choose: (letter: string) => Promise<void>;
  readonly want: (text: string) => Promise<void>;
  readonly close: () => Promise<void>;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str = (record: Readonly<Record<string, unknown>>, key: string): string =>
  typeof record[key] === "string" ? record[key] : "";

const taskData = (text: string): Readonly<Record<string, unknown>> | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const data = isRecord(parsed) && isRecord(parsed["data"]) ? parsed["data"] : parsed;
  return isRecord(data) && data["schema"] === TASK_SCHEMA ? data : undefined;
};

const items = (value: unknown): readonly ContractItem[] =>
  (Array.isArray(value) ? value.filter(isRecord) : []).map((item) => ({
    id: str(item, "id"),
    says: str(item, "says"),
    status: str(item, "status"),
  }));

export const parseContractView = (text: string): ContractView | undefined => {
  const data = taskData(text);
  if (data === undefined || typeof data["hash"] !== "string" || typeof data["task"] !== "string") return undefined;
  return {
    task: data["task"],
    goal: str(data, "goal"),
    hash: data["hash"],
    digest: str(data, "digest"),
    trusted: data["trusted"] === true,
    checks: items(data["acceptance"]),
    examples: items(data["examples"]),
  };
};

export const parseDivergeView = (text: string): DivergeView | undefined => {
  const data = taskData(text);
  const question = data === undefined ? undefined : data["question"];
  if (data === undefined || !isRecord(question)) return undefined;
  const options = (Array.isArray(question["options"]) ? question["options"].filter(isRecord) : []).map((option) => ({
    letter: str(option, "letter"),
    output: str(option, "output"),
  }));
  return { task: str(data, "task"), input: str(question, "input"), options };
};

export const shortHash = (hash: string): string => hash.slice(0, 12);

export const contractLines = (view: ContractView): readonly string[] => [
  `contract ${view.task}: ${view.goal}`,
  ...view.checks.map((check) => `  check ${check.id}: ${check.says}`),
  ...view.examples.map((example) => `  ${example.id} [${example.status}] ${example.says}`),
  `hash ${shortHash(view.hash)} (changes if a check or an approved example changes)`,
  view.trusted ? "approved on this machine" : "not approved",
];

export const divergeLines = (view: DivergeView): readonly string[] => [
  `two readings of ${view.task} behave differently on input: ${view.input}`,
  ...view.options.map((option) => `  ${option.letter}: ${option.output}`),
];

const text = (elements: Elements, line: string, key: string, dim = false): ModElement =>
  elements.Text({ key, children: [line], ...(dim ? { dimColor: true } : {}) });

const row = (elements: Elements, key: string, children: readonly ModElement[]): ModElement =>
  elements.Box({ key, flexDirection: "row", columnGap: 2, children });

const exampleRow = (elements: Elements, example: ContractItem, actions: ContractActions): ModElement =>
  example.status === "proposed"
    ? row(elements, `fm-ex-${example.id}`, [
        text(elements, `${example.id} ${example.says}`, `fm-ex-text-${example.id}`),
        elements.Button({
          key: `fm-ex-approve-${example.id}`,
          label: `Approve ${example.id}`,
          onPress: () => actions.decide(example.id, "approve"),
        }),
        elements.Button({
          key: `fm-ex-reject-${example.id}`,
          label: `Reject ${example.id}`,
          onPress: () => actions.decide(example.id, "reject"),
        }),
      ])
    : text(elements, `${example.id} [${example.status}] ${example.says}`, `fm-ex-text-${example.id}`);

export const contractTree = (
  elements: Elements,
  view: ContractView,
  notice: string | undefined,
  actions: ContractActions,
): ModElement =>
  elements.Box({
    key: "fm-contract",
    flexDirection: "column",
    children: [
      text(elements, `Contract ${view.task}: ${view.goal}`, "fm-contract-goal"),
      ...view.checks.map((check) => text(elements, `check ${check.id}: ${check.says}`, `fm-check-${check.id}`, true)),
      ...(view.examples.length === 0
        ? [text(elements, "no behavior examples yet", "fm-ex-none", true)]
        : [
            text(elements, "What the task does, in examples:", "fm-ex-head"),
            ...view.examples.map((example) => exampleRow(elements, example, actions)),
          ]),
      text(
        elements,
        `Hash ${shortHash(view.hash)} (changes if a check or an approved example changes)`,
        "fm-contract-hash",
        true,
      ),
      ...(notice === undefined ? [] : [text(elements, notice, "fm-contract-notice")]),
      view.trusted
        ? text(elements, "Approved on this machine with this hash.", "fm-contract-approved")
        : row(elements, "fm-contract-buttons", [
            elements.Button({
              key: "fm-contract-approve",
              label: `Approve ${view.hash.slice(0, 4)}`,
              hotkey: "a",
              onPress: actions.approve,
            }),
            elements.Button({ key: "fm-contract-edit", label: "Edit", hotkey: "e", onPress: actions.edit }),
            elements.Button({ key: "fm-contract-reject", label: "Reject", hotkey: "x", onPress: actions.reject }),
          ]),
    ],
  });

const wantInput = (elements: Elements, actions: DivergeActions): readonly ModElement[] => {
  const input = elements.Input;
  return input === undefined
    ? []
    : [
        input({
          key: "fm-diverge-want",
          label: "Neither, I want:",
          placeholder: "the result this input should give",
          submitLabel: "Send",
          onSubmit: (value) => actions.want(value),
        }),
      ];
};

export const divergeTree = (
  elements: Elements,
  view: DivergeView | undefined,
  notice: string | undefined,
  actions: DivergeActions,
): ModElement => {
  const close = elements.Button({ key: "fm-diverge-close", label: "Close", hotkey: "x", onPress: actions.close });
  if (view === undefined)
    return elements.Box({
      key: "fm-diverge",
      flexDirection: "column",
      children: [text(elements, notice ?? "no open divergence question", "fm-diverge-none"), close],
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
        elements.Code({ key: `fm-diverge-out-${option.letter}`, source: option.output, language: "text" }),
      ]),
      ...(notice === undefined ? [] : [text(elements, notice, "fm-diverge-notice")]),
      row(elements, "fm-diverge-buttons", [
        ...view.options.map((option, index) =>
          elements.Button({
            key: `fm-diverge-${option.letter}`,
            label: `I want ${option.letter}`,
            hotkey: String(index + 1),
            onPress: () => actions.choose(option.letter),
          }),
        ),
        close,
      ]),
      ...wantInput(elements, actions),
    ],
  });
};

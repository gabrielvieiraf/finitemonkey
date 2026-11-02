import type { Elements, ModElement } from "./api.js";

export interface TeachCard {
  readonly question: string;
  readonly concepts: readonly string[];
  readonly run: string;
  readonly input: string;
}

export interface ProbeCardOption {
  readonly id: string;
  readonly text: string;
}

export interface ProbeCard {
  readonly id: string;
  readonly question: string;
  readonly why: string;
  readonly options: readonly ProbeCardOption[];
}

export interface CardActions {
  readonly answerProbe: (probe: string, option: string) => Promise<void>;
  readonly skipProbe: (probe: string) => Promise<void>;
  readonly skipQuestion: (question: string) => Promise<void>;
}

type Rec = Readonly<Record<string, unknown>>;

const isRec = (value: unknown): value is Rec => typeof value === "object" && value !== null && !Array.isArray(value);

const str = (record: Rec, key: string): string => (typeof record[key] === "string" ? record[key] : "");

const dataOf = (text: string, schema: string): Rec | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const data = isRec(parsed) && isRec(parsed["data"]) ? parsed["data"] : undefined;
  return data?.["schema"] === schema ? data : undefined;
};

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export const parseTeachCard = (text: string): TeachCard | undefined => {
  const question = dataOf(text, "finitemonkey/teach@1")?.["question"];
  if (!isRec(question) || question["answered"] === true) return undefined;
  const id = str(question, "question");
  if (id === "") return undefined;
  return {
    question: id,
    concepts: strings(question["concepts"]),
    run: str(question, "run"),
    input: str(question, "input"),
  };
};

export const parseTeachReason = (text: string): string | undefined => {
  const reason = dataOf(text, "finitemonkey/teach@1")?.["reason"];
  return typeof reason === "string" ? reason : undefined;
};

export const parseProbeCard = (text: string): ProbeCard | undefined => {
  const probes = dataOf(text, "finitemonkey/probes@1")?.["probes"];
  const open = (Array.isArray(probes) ? probes : [])
    .filter(isRec)
    .find((probe) => probe["status"] === "open" && probe["presented"] === true);
  if (open === undefined) return undefined;
  const options = (Array.isArray(open["options"]) ? open["options"] : [])
    .filter(isRec)
    .map((option) => ({ id: str(option, "id"), text: str(option, "text") }));
  return { id: str(open, "id"), question: str(open, "question"), why: str(open, "why"), options };
};

export const teachLines = (card: TeachCard): readonly string[] => [
  `Teach-back on ${card.concepts.join(", ") || "-"}: what does ${card.run} print for the input ${card.input || "-"}? The answer key comes from running it.`,
  `Answer at a terminal: finitemonkey teach answer ${card.question} <value>. Skipping changes nothing.`,
];

export const REASON_TEXT: Readonly<Record<string, string>> = {
  no_key: "No keyed question for this concept, so nothing changes.",
  not_at_edge: "This concept is not proximal or beyond on the record.",
  no_concept: "This block has no concept to ask about.",
};

const teachTree = (elements: Elements, card: TeachCard, actions: CardActions): ModElement =>
  elements.Box({
    key: "fm-teach-card",
    flexDirection: "column",
    children: [
      ...teachLines(card).map((line, index) =>
        elements.Text({ key: `fm-teach-line-${String(index)}`, children: [line] }),
      ),
      elements.Button({
        key: "fm-teach-skip",
        label: "Skip question",
        onPress: () => actions.skipQuestion(card.question),
      }),
    ],
  });

const probeTree = (elements: Elements, card: ProbeCard, actions: CardActions): ModElement =>
  elements.Box({
    key: "fm-probe-card",
    flexDirection: "column",
    children: [
      elements.Text({ key: "fm-probe-question", children: [`${card.id}: ${card.question}`] }),
      elements.Text({
        key: "fm-probe-why",
        dimColor: true,
        children: [`Why this question: ${card.why}. Skipping changes nothing.`],
      }),
      elements.Box({
        key: "fm-probe-options",
        flexDirection: "row",
        columnGap: 2,
        children: [
          ...card.options.map((option) =>
            elements.Button({
              key: `fm-probe-option-${option.id}`,
              label: `${option.id}) ${option.text}`,
              onPress: () => actions.answerProbe(card.id, option.id),
            }),
          ),
          elements.Button({ key: "fm-probe-skip", label: "Skip probe", onPress: () => actions.skipProbe(card.id) }),
        ],
      }),
    ],
  });

export const cardsTree = (
  elements: Elements,
  teach: TeachCard | undefined,
  probe: ProbeCard | undefined,
  notice: string | undefined,
  actions: CardActions,
): readonly ModElement[] => [
  ...(notice === undefined ? [] : [elements.Text({ key: "fm-teach-notice", dimColor: true, children: [notice] })]),
  ...(teach === undefined ? [] : [teachTree(elements, teach, actions)]),
  ...(probe === undefined ? [] : [probeTree(elements, probe, actions)]),
];

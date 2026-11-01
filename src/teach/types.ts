export const TEACH_FEATURE = "teach-back";
export const TEACH_FILE = "teach.jsonl";
export const TEACH_SCHEMA = "finitemonkey/teach@1";
export const PAUSE_FILE = "teach-pause.json";

export const TEACH_ORIGINS = ["edge", "predict", "know"] as const;
export const TEACH_PROPOSERS = ["template", "provider"] as const;

export type TeachOrigin = (typeof TEACH_ORIGINS)[number];
export type TeachProposer = (typeof TEACH_PROPOSERS)[number];
export type ExplainedFrom = "terminal" | "session";

export interface TeachQuestion {
  readonly type: "question";
  readonly id: string;
  readonly at: string;
  readonly concepts: readonly string[];
  readonly run: string;
  readonly input: string;
  readonly key: string;
  readonly origin: TeachOrigin;
  readonly inputFrom: TeachProposer;
  readonly task?: string;
  readonly session?: string;
}

export interface TeachAnswer {
  readonly type: "answer";
  readonly id: string;
  readonly at: string;
  readonly question: string;
  readonly answer: string;
  readonly correct: boolean;
}

export interface TeachExplanation {
  readonly type: "explanation";
  readonly id: string;
  readonly at: string;
  readonly concepts: readonly string[];
  readonly text: string;
  readonly from: ExplainedFrom;
  readonly question?: string;
}

export interface TeachSkip {
  readonly type: "skip";
  readonly id: string;
  readonly at: string;
  readonly question: string;
}

export type TeachEntry = TeachQuestion | TeachAnswer | TeachExplanation | TeachSkip;

export interface TeachTemplate {
  readonly run: string;
  readonly input: string;
}

export interface InputProposal {
  readonly input: string;
  readonly expected?: string;
}

export interface ProposeContext {
  readonly concepts: readonly string[];
  readonly run: string;
  readonly input: string;
}

export type InputProposer = (context: ProposeContext) => InputProposal | undefined;

export interface QuestionView {
  readonly question: string;
  readonly concepts: readonly string[];
  readonly run: string;
  readonly input: string;
  readonly origin: TeachOrigin;
  readonly answered: boolean;
  readonly correct?: boolean;
  readonly actual?: string;
}

export const JUDGE_CALL_ARGS = ["judge", "call", "--json"] as const;

export const JUDGE_PANE_REQUEST = { verb: "trajectory" } as const;

export const requestBody = (request: Readonly<Record<string, unknown>>): string => JSON.stringify(request);

export interface JudgeProcess {
  readonly args: readonly string[];
  readonly stdin: string;
}

export const judgeProcess = (request: Readonly<Record<string, unknown>>): JudgeProcess => ({
  args: JUDGE_CALL_ARGS,
  stdin: requestBody(request),
});

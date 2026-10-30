import { accept, isRecord, type JsonObject, type Parsed, reject } from "../src/core/parsed.js";
import { type Critique, type Finding, GROUPS, parseCritique } from "../src/review/findings.js";
import { type Outcome, OUTCOMES } from "../src/review/reproduce.js";

export const ARMS = ["finitemonkey", "finitemonkey-reproduced"] as const;
export type ReviewArm = (typeof ARMS)[number];

export interface ReviewEstimate {
  readonly reviewUsdPerPr: number;
  readonly candidatesPerPr: number;
  readonly judgeUsdPerPair: number;
}

export interface BenchPin {
  readonly repo: string;
  readonly commit: string;
  readonly goldenDir: string;
  readonly judgeModel: string;
  readonly estimate: ReviewEstimate;
}

export interface GoldenComment {
  readonly comment: string;
  readonly severity: string;
  readonly category: string;
}

export interface GoldenPr {
  readonly url: string;
  readonly title: string;
  readonly repo: string;
  readonly comments: readonly GoldenComment[];
}

export interface ReviewedFinding {
  readonly text: string;
  readonly group: Finding["group"];
  readonly outcome: Outcome;
}

export interface ReviewRecord {
  readonly url: string;
  readonly repo: string;
  readonly findings: readonly ReviewedFinding[];
  readonly error: string | null;
  readonly costUsd: number | null;
}

const positive = (value: unknown): value is number => typeof value === "number" && value >= 0;

export const parsePin = (raw: JsonObject): Parsed<BenchPin> => {
  const { repo, commit, goldenDir, judgeModel, estimate } = raw;
  if (typeof repo !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return reject("pin: repo must be owner/name");
  if (typeof commit !== "string" || !/^[0-9a-f]{40}$/.test(commit)) return reject("pin: commit must be a full sha");
  if (typeof goldenDir !== "string" || typeof judgeModel !== "string") {
    return reject("pin: goldenDir and judgeModel are required");
  }
  if (!isRecord(estimate)) return reject("pin: estimate is required");
  const { reviewUsdPerPr, candidatesPerPr, judgeUsdPerPair } = estimate;
  if (!positive(reviewUsdPerPr) || !positive(candidatesPerPr) || !positive(judgeUsdPerPair)) {
    return reject("pin: estimate values must be numbers of zero or more");
  }
  return accept({
    repo,
    commit,
    goldenDir,
    judgeModel,
    estimate: { reviewUsdPerPr, candidatesPerPr, judgeUsdPerPair },
  });
};

const goldenComment = (raw: unknown): GoldenComment | undefined => {
  if (!isRecord(raw)) return undefined;
  const { comment, severity, category } = raw;
  return typeof comment === "string" && comment.trim() !== ""
    ? {
        comment,
        severity: typeof severity === "string" ? severity : "",
        category: typeof category === "string" ? category : "",
      }
    : undefined;
};

export const parseGolden = (repo: string, raw: unknown): Parsed<readonly GoldenPr[]> => {
  if (!Array.isArray(raw)) return reject(`${repo}: golden comments must be a list`);
  const prs: GoldenPr[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry["url"] !== "string") return reject(`${repo}: every PR needs a url`);
    const comments = Array.isArray(entry["comments"]) ? entry["comments"].map(goldenComment) : [];
    if (comments.some((item) => item === undefined)) return reject(`${entry["url"]}: a golden comment is malformed`);
    prs.push({
      url: entry["url"],
      title: typeof entry["pr_title"] === "string" ? entry["pr_title"] : "",
      repo,
      comments: comments.flatMap((item) => (item === undefined ? [] : [item])),
    });
  }
  return accept(prs);
};

export const pullOf = (url: string): { owner: string; name: string; number: number } | undefined => {
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)$/.exec(url);
  if (match === null) return undefined;
  const [, owner, name, number] = match;
  return owner === undefined || name === undefined || number === undefined
    ? undefined
    : { owner, name, number: Number(number) };
};

export interface CostEstimate {
  readonly prs: number;
  readonly golden: number;
  readonly pairs: number;
  readonly reviewUsd: number;
  readonly reviewCapUsd: number;
  readonly judgeUsd: number;
  readonly text: string;
}

export const costEstimate = (
  prs: readonly GoldenPr[],
  estimate: ReviewEstimate,
  maxBudgetUsd: number,
): CostEstimate => {
  const golden = prs.reduce((sum, pr) => sum + pr.comments.length, 0);
  const perReview = Math.min(estimate.reviewUsdPerPr, maxBudgetUsd);
  const review = prs.length * perReview;
  const reviewCap = prs.length * maxBudgetUsd;
  const pairs = golden * estimate.candidatesPerPr * ARMS.length;
  const judge = pairs * estimate.judgeUsdPerPair;
  return {
    prs: prs.length,
    golden,
    pairs,
    reviewUsd: review,
    reviewCapUsd: reviewCap,
    judgeUsd: judge,
    text: [
      `${String(prs.length)} PRs, ${String(golden)} golden comments.`,
      `Reviews: about US$ ${review.toFixed(2)}, at most US$ ${reviewCap.toFixed(2)} at --max-budget-usd ${maxBudgetUsd.toFixed(2)} each.`,
      `Judge (run by the benchmark, billed to its API key): about ${String(pairs)} comparisons, about US$ ${judge.toFixed(2)}.`,
    ].join("\n"),
  };
};

export interface RealReviewCheck {
  readonly yes: boolean;
  readonly tty: boolean;
  readonly configDir: string | undefined;
  readonly repos: string | undefined;
}

export const realReviewProblems = (check: RealReviewCheck): readonly string[] => [
  ...(check.yes ? [] : ["pass --yes to spend model quota on these reviews"]),
  ...(check.tty ? [] : ["run this from a terminal: a real review run needs a person at a TTY"]),
  ...(check.configDir === undefined ? ["--config-dir <dir> with a logged-in Claude Code config is required"] : []),
  ...(check.repos === undefined ? ["--repos <dir> with a clone of each benchmark repository is required"] : []),
];

const JSON_BLOCK = /```(?:json)?\s*\n([\s\S]*?)\n```/g;

export const critiqueFrom = (text: string): Critique | readonly string[] => {
  const blocks = [...text.matchAll(JSON_BLOCK)].map((match) => match[1] ?? "");
  const candidates = blocks.length > 0 ? blocks.reverse() : [text];
  let errors: readonly string[] = ["no findings JSON in the review"];
  for (const block of candidates) {
    try {
      const parsed = parseCritique(JSON.parse(block));
      if ("findings" in parsed) return parsed;
      errors = parsed;
    } catch {
      continue;
    }
  }
  return errors;
};

export const findingText = (finding: Finding): string => `${finding.what}: ${finding.problem}`;

export interface ReviewDeps {
  readonly review: (pr: GoldenPr) => Promise<{ readonly text: string; readonly costUsd: number | null }>;
  readonly verify: (pr: GoldenPr, findings: readonly Finding[]) => Promise<ReadonlyMap<number, Outcome>>;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const reviewOne = async (pr: GoldenPr, deps: ReviewDeps): Promise<ReviewRecord> => {
  try {
    const { text, costUsd } = await deps.review(pr);
    const critique = critiqueFrom(text);
    if (!("findings" in critique)) {
      return { url: pr.url, repo: pr.repo, findings: [], error: critique.join("; "), costUsd };
    }
    const outcomes = await deps.verify(pr, critique.findings);
    return {
      url: pr.url,
      repo: pr.repo,
      findings: critique.findings.map((finding) => ({
        text: findingText(finding),
        group: finding.group,
        outcome: outcomes.get(finding.id) ?? "not-run",
      })),
      error: null,
      costUsd,
    };
  } catch (error) {
    return { url: pr.url, repo: pr.repo, findings: [], error: messageOf(error), costUsd: null };
  }
};

export const armFindings = (record: ReviewRecord, arm: ReviewArm): readonly string[] =>
  record.findings
    .filter((finding) => arm === "finitemonkey" || finding.outcome === "head-only")
    .map((finding) => finding.text);

export const parseRecord = (raw: JsonObject): ReviewRecord | undefined => {
  const { url, repo, findings, error, costUsd } = raw;
  if (typeof url !== "string" || typeof repo !== "string" || !Array.isArray(findings)) return undefined;
  const parsed = findings.flatMap((item): ReviewedFinding[] => {
    if (!isRecord(item) || typeof item["text"] !== "string") return [];
    const group = GROUPS.find((option) => option === item["group"]);
    const outcome = OUTCOMES.find((option) => option === item["outcome"]);
    return group === undefined || outcome === undefined ? [] : [{ text: item["text"], group, outcome }];
  });
  return {
    url,
    repo,
    findings: parsed,
    error: typeof error === "string" ? error : null,
    costUsd: typeof costUsd === "number" ? costUsd : null,
  };
};

const recordAt = (source: JsonObject, key: string): JsonObject => {
  const value = source[key];
  return isRecord(value) ? value : {};
};

export const judgeInputs = (
  prs: readonly GoldenPr[],
  records: readonly ReviewRecord[],
  existing: JsonObject,
  existingCandidates: JsonObject,
): { readonly benchmarkData: JsonObject; readonly candidates: JsonObject } => {
  const data: Record<string, unknown> = { ...existing };
  const candidates: Record<string, unknown> = { ...existingCandidates };
  for (const record of records) {
    if (record.error !== null) continue;
    const pr = prs.find((item) => item.url === record.url);
    if (pr === undefined) continue;
    const before = recordAt(data, pr.url);
    const listed: unknown = before["reviews"];
    const reviews: readonly unknown[] = Array.isArray(listed) ? listed : [];
    const others = reviews.filter((review) => !isRecord(review) || !ARMS.some((arm) => arm === review["tool"]));
    data[pr.url] = {
      ...before,
      pr_title: pr.title,
      golden_comments: pr.comments,
      reviews: [
        ...others,
        ...ARMS.map((arm) => ({ tool: arm, repo_name: pr.repo, pr_url: pr.url, review_comments: [] })),
      ],
    };
    const known = recordAt(candidates, pr.url);
    candidates[pr.url] = {
      ...known,
      ...Object.fromEntries(ARMS.map((arm) => [arm, armFindings(record, arm).map((text) => ({ text }))])),
    };
  }
  return { benchmarkData: data, candidates };
};

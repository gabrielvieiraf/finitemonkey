import { claimUnits, type DocUnit } from "./docs.js";
import { type StatusKind, statusOf } from "./phrases.js";
import { refsOf } from "./refs.js";
import type { PublishedVersion } from "./registry.js";

export type FeatureDefault = "off" | "shadow" | "active";

export interface IssueFact {
  readonly state: "open" | "closed";
  readonly completed: boolean;
  readonly closedBy?: readonly number[];
}

export interface ProjectState {
  readonly commands: ReadonlyMap<string, "ready" | "planned">;
  readonly features: ReadonlyMap<string, FeatureDefault>;
  readonly published: PublishedVersion | undefined;
  readonly issues: ReadonlyMap<number, IssueFact> | undefined;
}

export const TRUTHS = [
  "issue_closed",
  "command_ready",
  "feature_ships",
  "feature_active",
  "version_published",
] as const;

export type Truth = (typeof TRUTHS)[number];

export interface StaleClaim {
  readonly file: string;
  readonly line: number;
  readonly says: string;
  readonly status: StatusKind;
  readonly phrase: string;
  readonly subject: string;
  readonly truth: Truth;
  readonly detail: string;
  readonly evidence: string;
}

export interface Resolution {
  readonly claims: number;
  readonly unresolvedIssues: readonly number[];
  readonly stale: readonly StaleClaim[];
}

const MAX_SAYS = 240;

const says = (text: string): string => (text.length > MAX_SAYS ? `${text.slice(0, MAX_SAYS - 3)}...` : text);

type Contradiction = Pick<StaleClaim, "subject" | "truth" | "detail" | "evidence">;

const issueContradictions = (issues: readonly number[], state: ProjectState): readonly Contradiction[] =>
  issues.flatMap((number): Contradiction[] => {
    const fact = state.issues?.get(number);
    if (fact?.state !== "closed" || !fact.completed) return [];
    const by = fact.closedBy ?? [];
    return [
      {
        subject: `#${String(number)}`,
        truth: "issue_closed",
        detail: by.map((pr) => `#${String(pr)}`).join(", "),
        evidence: `issue #${String(number)} is closed as completed${by.length === 0 ? "" : ` by ${by.map((pr) => `#${String(pr)}`).join(", ")}`}`,
      },
    ];
  });

const unshippedContradictions = (refs: ReturnType<typeof refsOf>, state: ProjectState): readonly Contradiction[] => [
  ...issueContradictions(refs.issues, state),
  ...refs.commands
    .filter((name) => state.commands.get(name) === "ready")
    .map((name): Contradiction => ({
      subject: `finitemonkey ${name}`,
      truth: "command_ready",
      detail: "ready",
      evidence: `\`finitemonkey ${name}\` is registered in the CLI as ready`,
    })),
  ...refs.features.flatMap((id): Contradiction[] => {
    const mode = state.features.get(id);
    return mode === "shadow" || mode === "active"
      ? [{ subject: id, truth: "feature_ships", detail: mode, evidence: `feature \`${id}\` ships, ${mode} by default` }]
      : [];
  }),
];

const publishedContradiction = (published: PublishedVersion): Contradiction =>
  published.source === "registry"
    ? {
        subject: "registry",
        truth: "version_published",
        detail: published.version,
        evidence: `the npm registry lists ${published.version} under the dist-tag ${published.tag ?? "latest"}`,
      }
    : {
        subject: "release",
        truth: "version_published",
        detail: published.version,
        evidence: `the changelog lists the published version ${published.version}`,
      };

const contradictionsOf = (
  kind: StatusKind,
  refs: ReturnType<typeof refsOf>,
  state: ProjectState,
): readonly Contradiction[] => {
  if (kind === "unshipped") return unshippedContradictions(refs, state);
  if (kind === "experimental")
    return refs.features
      .filter((id) => state.features.get(id) === "active")
      .map((id) => ({
        subject: id,
        truth: "feature_active",
        detail: "active",
        evidence: `feature \`${id}\` is active by default`,
      }));
  return state.published === undefined ? [] : [publishedContradiction(state.published)];
};

interface Sets {
  readonly commands: ReadonlySet<string>;
  readonly features: ReadonlySet<string>;
}

interface Checked {
  readonly refs: ReturnType<typeof refsOf>;
  readonly found: readonly StaleClaim[];
}

const checkUnit = (unit: DocUnit, state: ProjectState, sets: Sets): readonly Checked[] =>
  claimUnits(unit.text, (text) => statusOf(text) !== undefined).flatMap((piece): Checked[] => {
    const status = statusOf(piece.text);
    if (status === undefined) return [];
    const refs = refsOf(piece.scope, sets.commands, sets.features);
    if (status.kind === "experimental" && refs.features.length === 0) return [];
    const found = contradictionsOf(status.kind, refs, state).map((item): StaleClaim => ({
      file: unit.file,
      line: unit.line,
      says: says(piece.scope),
      status: status.kind,
      phrase: status.phrase,
      ...item,
    }));
    return [{ refs, found }];
  });

export const resolveUnits = (units: readonly DocUnit[], state: ProjectState): Resolution => {
  const sets = { commands: new Set(state.commands.keys()), features: new Set(state.features.keys()) };
  const checked = units.flatMap((unit) => checkUnit(unit, state, sets));
  const unresolved = new Set(
    checked.flatMap((item) => item.refs.issues.filter((number) => state.issues?.get(number) === undefined)),
  );
  return {
    claims: checked.length,
    unresolvedIssues: [...unresolved].sort((a, b) => a - b),
    stale: checked.flatMap((item) => item.found),
  };
};

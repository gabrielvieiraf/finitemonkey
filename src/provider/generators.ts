import type { UnattendedDeps } from "../autonomy/chain.js";
import { type BlindPacket, type BlindTest, parseBlindTests } from "../blind/blind.js";
import type { AbsolutePath } from "../core/brand.js";
import { isRecord } from "../core/parsed.js";
import { removeScratch, scratchDir } from "../gate/isolated.js";
import type { Candidates, CandidateSource, Probe } from "../ricochete/divergence.js";
import { callProvider, type ProviderDeps, valueOf } from "./call.js";
import { done } from "./validate.js";

export interface Throwaway {
  readonly dir: AbsolutePath;
  readonly remove: () => void;
}

export const throwaway = (deps: ProviderDeps, base: string, label: string): Throwaway | undefined => {
  const root = deps.paths.root;
  const dir = scratchDir(deps.runtime, root, `provider-${label}`);
  const added = deps.runtime.gitWith(["worktree", "add", "--detach", "--force", dir, base], root, {});
  const remove = (): void => {
    removeScratch(deps.runtime, root, dir);
  };
  if (added.ok) return { dir, remove };
  remove();
  return undefined;
};

interface ReadingAnswer {
  readonly summary: string;
  readonly inputs: readonly Probe[];
}

const readingOf = (value: unknown): ReadingAnswer | undefined => {
  if (!isRecord(value) || typeof value["summary"] !== "string") return undefined;
  const inputs = Array.isArray(value["inputs"]) ? value["inputs"] : [];
  return {
    summary: value["summary"].slice(0, 300),
    inputs: inputs.flatMap((item: unknown): Probe[] => {
      if (typeof item === "string") return [{ input: item, topic: "intent" }];
      return isRecord(item) && typeof item["input"] === "string"
        ? [{ input: item["input"], topic: item["topic"] === "technical" ? "technical" : "intent" }]
        : [];
    }),
  };
};

export interface ProviderCandidates {
  readonly source: CandidateSource;
  readonly cleanup: () => void;
}

export const providerCandidates = (deps: ProviderDeps, base: string): ProviderCandidates => {
  const made: Throwaway[] = [];
  const reading = (request: Parameters<CandidateSource["generate"]>[0], index: number) => {
    const place = throwaway(deps, base, `diverge-${request.task}-${String(index)}`);
    if (place === undefined) return undefined;
    made.push(place);
    const examples = request.examples.map((example) => ({
      says: example.says,
      input: example.input ?? "",
      expect: example.expect,
    }));
    const answer = valueOf(
      callProvider(deps, {
        kind: "divergence",
        payload: { task: request.task, goal: request.goal, examples, reading: index },
        cwd: place.dir,
        validate: readingOf,
      }),
    );
    return answer === undefined ? undefined : { dir: place.dir, ...answer };
  };
  return {
    source: {
      generate: (request): Candidates | undefined => {
        const answers = Array.from({ length: request.readings }, (_, index) => reading(request, index + 1)).flatMap(
          (item) => (item === undefined ? [] : [item]),
        );
        if (answers.length === 0) return undefined;
        return {
          readings: answers.map((item) => ({ dir: item.dir, summary: item.summary })),
          inputs: answers.flatMap((item) => item.inputs),
        };
      },
    },
    cleanup: () => {
      for (const place of made.splice(0)) place.remove();
    },
  };
};

export const providerBlindTests = (
  deps: ProviderDeps,
  packet: BlindPacket,
  dir: AbsolutePath,
  max: number,
): readonly BlindTest[] | undefined =>
  valueOf(
    callProvider(deps, {
      kind: "blind-writer",
      payload: { packet: { ...packet, criteria: [...packet.criteria], examples: [...packet.examples] }, max },
      cwd: dir,
      validate: (value) => (isRecord(value) ? parseBlindTests(JSON.stringify(value), max) : undefined),
    }),
  );

export const providerAgent =
  (deps: ProviderDeps): UnattendedDeps["agent"] =>
  (task) =>
    valueOf(
      callProvider(
        { ...deps, task: task.id },
        {
          kind: "agent",
          payload: { task: task.id, goal: task.goal, acceptance: task.acceptance.map((check) => check.id) },
          validate: done,
        },
      ),
    ) === true;

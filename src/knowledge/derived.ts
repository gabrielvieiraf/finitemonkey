import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { addedByContent } from "../core/line-diff.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import type { FmPaths } from "../task/paths.js";
import { appendClaimEvent, claimId } from "./claims.js";

export const DERIVED_FILE = "derived.json";
export const DERIVED_SCHEMA = "finitemonkey/derived@1";
export const DERIVED_FEATURE = "derived-cache";

export type Inputs = Readonly<Record<string, string>>;

export interface DerivedEntry {
  readonly file: string;
  readonly generator: string;
  readonly inputs: Inputs;
  readonly output: string;
  readonly text: string;
  readonly builtAt: string;
}

export type DerivedState = "fresh" | "stale" | "edited" | "missing";

export interface DerivedSpec {
  readonly file: string;
  readonly generator: string;
  readonly inputs: Inputs;
  readonly sources: readonly string[];
  readonly render: () => string;
}

export type DerivedResult =
  | { readonly kind: "fresh"; readonly text: string }
  | { readonly kind: "built"; readonly text: string; readonly edited: readonly string[] }
  | { readonly kind: "refused"; readonly source: string };

type DerivedRuntime = Pick<Runtime, "readText" | "writeText" | "mkdir" | "appendText" | "now">;

export const registryPath = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, DERIVED_FILE));

const digest = (text: string): string => sha256Hex(text).slice(0, 16);

const strings = (value: unknown): Inputs =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      )
    : {};

export const readDerived = (runtime: Pick<Runtime, "readText">, paths: FmPaths): ReadonlyMap<string, DerivedEntry> => {
  const raw = runtime.readText(registryPath(paths));
  const parsed = raw.ok ? parseJsonObject(raw.value) : undefined;
  const entries = parsed?.ok === true ? parsed.value["entries"] : undefined;
  const list = Array.isArray(entries) ? entries : [];
  return new Map(
    list.flatMap((item: unknown): [string, DerivedEntry][] => {
      if (!isRecord(item)) return [];
      const { file, generator, output, text, builtAt } = item;
      if (typeof file !== "string" || typeof generator !== "string" || typeof output !== "string") return [];
      return [
        [
          file,
          {
            file,
            generator,
            output,
            inputs: strings(item["inputs"]),
            text: typeof text === "string" ? text : "",
            builtAt: typeof builtAt === "string" ? builtAt : "",
          },
        ],
      ];
    }),
  );
};

const writeDerived = (
  runtime: Pick<Runtime, "writeText" | "mkdir">,
  paths: FmPaths,
  entries: ReadonlyMap<string, DerivedEntry>,
): void => {
  runtime.mkdir(paths.dir);
  runtime.writeText(
    registryPath(paths),
    `${JSON.stringify({ schema: DERIVED_SCHEMA, entries: [...entries.values()] }, null, 2)}\n`,
  );
};

const sameInputs = (left: Inputs, right: Inputs): boolean =>
  Object.keys(left).length === Object.keys(right).length &&
  Object.entries(left).every(([key, value]) => right[key] === value);

const fileAt = (paths: FmPaths, file: string): AbsolutePath => toAbsolutePath(join(paths.root, ...file.split("/")));

export const derivedState = (
  runtime: Pick<Runtime, "readText">,
  paths: FmPaths,
  file: string,
  inputs: Inputs,
): DerivedState => {
  const entry = readDerived(runtime, paths).get(file);
  const current = runtime.readText(fileAt(paths, file));
  if (entry === undefined || !current.ok) return "missing";
  if (digest(current.value) !== entry.output) return "edited";
  return sameInputs(entry.inputs, inputs) ? "fresh" : "stale";
};

const recordEdit = (runtime: DerivedRuntime, paths: FmPaths, file: string, lines: readonly string[]): void => {
  if (lines.length === 0) return;
  const recordedAt = runtime.now();
  const text = `Correction to ${file}: ${lines.join(" / ").slice(0, 300)}`;
  appendClaimEvent(runtime, paths, {
    event: "add",
    id: claimId(text, recordedAt),
    recordedAt,
    text,
    kind: "prose",
    anchors: [],
    origin: { source: "person", attributedTo: "person", derivedFrom: {} },
    because: [],
  });
};

export const buildDerived = (runtime: DerivedRuntime, paths: FmPaths, spec: DerivedSpec): DerivedResult => {
  const registry = readDerived(runtime, paths);
  const derivedSource = spec.sources.find((source) => source !== spec.file && registry.has(source));
  if (derivedSource !== undefined) return { kind: "refused", source: derivedSource };
  const state = derivedState(runtime, paths, spec.file, spec.inputs);
  const current = runtime.readText(fileAt(paths, spec.file));
  if (state === "fresh" && current.ok) return { kind: "fresh", text: current.value };
  const previous = registry.get(spec.file);
  const edited =
    state === "edited" && current.ok && previous !== undefined
      ? addedByContent(previous.text, current.value)
          .map((line) => line.text.trim())
          .filter((line) => line !== "")
      : [];
  recordEdit(runtime, paths, spec.file, edited);
  const text = spec.render();
  runtime.mkdir(toAbsolutePath(join(fileAt(paths, spec.file), "..")));
  runtime.writeText(fileAt(paths, spec.file), text);
  writeDerived(
    runtime,
    paths,
    new Map([
      ...registry,
      [
        spec.file,
        {
          file: spec.file,
          generator: spec.generator,
          inputs: spec.inputs,
          output: digest(text),
          text,
          builtAt: runtime.now(),
        },
      ],
    ]),
  );
  return { kind: "built", text, edited };
};

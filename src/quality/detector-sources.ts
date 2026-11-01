import type { FunctionMetric } from "./metrics.js";

export type PythonRunner = (text: string) => readonly FunctionMetric[] | undefined;

export interface DetectorSources {
  readonly changed: readonly string[];
  readonly before: (file: string) => string | undefined;
  readonly after: (file: string) => string | undefined;
  readonly referenced: (name: string, exclude: readonly string[]) => boolean;
  readonly python: PythonRunner;
}

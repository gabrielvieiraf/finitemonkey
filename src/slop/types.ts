export const SLOP_BLOCKERS = [
  "sibling_file",
  "improvement_name",
  "narrating_comment",
  "emoji",
  "swallowed_error",
  "unchecked_any",
  "debug_output",
] as const;

export const SLOP_WARNINGS = [
  "version_name",
  "generic_name",
  "literal_fallback",
  "reexport_shim",
  "pass_through",
  "summary_markdown",
] as const;

export const SLOP_DETECTORS = [...SLOP_BLOCKERS, ...SLOP_WARNINGS] as const;

export type SlopDetector = (typeof SLOP_DETECTORS)[number];

export type SlopLevel = "block" | "warn";

export interface SlopFinding {
  readonly detector: SlopDetector;
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly detail: string;
}

export const SLOP_GUARD = "slop";

export const FILE_DETECTORS: ReadonlySet<string> = new Set(["sibling_file", "reexport_shim", "summary_markdown"]);

export const levelOf = (detector: SlopDetector): SlopLevel =>
  (SLOP_BLOCKERS as readonly string[]).includes(detector) ? "block" : "warn";

export const isDetector = (value: string): value is SlopDetector =>
  (SLOP_DETECTORS as readonly string[]).includes(value);

export const finding = (
  detector: SlopDetector,
  file: string,
  line: number,
  text: string,
  detail = "",
): SlopFinding => ({ detector, file, line, text: text.trim(), detail });

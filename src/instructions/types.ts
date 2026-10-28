export const LAYERS = ["managed", "user", "project", "local", "rules", "import", "nested", "agents"] as const;
export const LOAD_REASONS = ["session_start", "nested_traversal", "path_glob_match", "include", "compact"] as const;

export type Layer = (typeof LAYERS)[number];
export type LoadReason = (typeof LOAD_REASONS)[number];

export interface InstructionFile {
  readonly path: string;
  readonly display: string;
  readonly layer: Layer;
  readonly reason: LoadReason;
  readonly lines: number;
  readonly tokens: number;
  readonly survivesCompaction: boolean;
  readonly globs: readonly string[];
  readonly parent: string | undefined;
  readonly text: string;
}

export interface ShadowedFile {
  readonly path: string;
  readonly display: string;
  readonly by: string;
}

export interface Inventory {
  readonly files: readonly InstructionFile[];
  readonly shadowed: readonly ShadowedFile[];
}

export const TOKENS_PER_CHAR = 0.25;

export const lineCount = (text: string): number =>
  text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);

export const tokenEstimate = (text: string): number => Math.ceil(text.length * TOKENS_PER_CHAR);

export type ListedFile = Omit<InstructionFile, "text">;

export const listedFile = (file: InstructionFile): ListedFile => ({
  path: file.path,
  display: file.display,
  layer: file.layer,
  reason: file.reason,
  lines: file.lines,
  tokens: file.tokens,
  survivesCompaction: file.survivesCompaction,
  globs: file.globs,
  parent: file.parent,
});

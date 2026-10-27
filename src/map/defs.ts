export interface Definition {
  readonly file: string;
  readonly name: string;
}

export const SKIPPED_PATH =
  /(^|\/)(node_modules|dist|build|out|vendor|coverage|generated|__generated__|tests?|__tests__|spec|fixtures)\/|\.(test|spec)\.[a-z]+$|\.d\.ts$|\.min\.js$|\.generated\.[a-z]+$|_pb2\.py$|\.pb\.go$|_test\.go$|(^|\/)test_[^/]+\.py$|^\.finitemonkey\//;

export const CODE_FILES = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "rs", "rb"] as const;

export const AST_FILES = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "py"]);

export const GREP_PATTERN =
  "^(export +(default +)?(async +)?(function|const|let|var|class|interface|type|enum|abstract +class) |(async +)?function\\*? *[A-Za-z_$]|class +[A-Za-z_]|def +[A-Za-z_]|func +|type +[A-Z][A-Za-z0-9_]* +(struct|interface)|pub +(fn|struct|enum|trait) +|module +[A-Z])";

const NAMES: readonly RegExp[] = [
  /^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/,
  /^(?:async\s+)?function\*?\s*([A-Za-z_$][\w$]*)/,
  /^class\s+([A-Za-z_$][\w$]*)/,
  /^def\s+([A-Za-z_]\w*[?!]?)/,
  /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/,
  /^type\s+([A-Z]\w*)\s+(?:struct|interface)/,
  /^pub\s+(?:fn|struct|enum|trait)\s+([A-Za-z_]\w*)/,
  /^module\s+([A-Z]\w*)/,
];

export const nameIn = (line: string): string | undefined => {
  for (const pattern of NAMES) {
    const name = pattern.exec(line)?.[1];
    if (name !== undefined) return name;
  }
  return undefined;
};

export const extensionOf = (file: string): string => {
  const dot = file.lastIndexOf(".");
  return dot === -1 ? "" : file.slice(dot + 1);
};

export const isCode = (file: string): boolean =>
  (CODE_FILES as readonly string[]).includes(extensionOf(file)) && !SKIPPED_PATH.test(file);

import { extname } from "node:path";

export type ImportRule = "module" | "package" | "none";

export interface Language {
  readonly id: string;
  readonly extensions: readonly string[];
  readonly definitions: readonly RegExp[];
  readonly imports: ImportRule;
  readonly comment: RegExp;
}

const JS_NAME = "[A-Za-z_$][\\w$]*";

export const LANGUAGES: readonly Language[] = [
  {
    id: "js",
    extensions: [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"],
    definitions: [
      new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s*\\*?\\s*(${JS_NAME})`),
      new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:abstract\\s+)?class\\s+(${JS_NAME})`),
      new RegExp(`^\\s*export\\s+(?:declare\\s+)?(?:const|let|var|enum|interface|type)\\s+(${JS_NAME})`),
      new RegExp(
        `^\\s+(?:public\\s+)?(?:static\\s+)?(?:async\\s+)?(${JS_NAME})\\s*\\([^)]*\\)\\s*(?::[^{=]+)?\\{\\s*$`,
      ),
    ],
    imports: "module",
    comment: /^\s*(?:\/\/|\/\*|\*)/,
  },
  {
    id: "py",
    extensions: [".py"],
    definitions: [/^\s*(?:async\s+)?def\s+([A-Za-z]\w*)/, /^\s*class\s+([A-Za-z]\w*)/],
    imports: "module",
    comment: /^\s*#/,
  },
  {
    id: "go",
    extensions: [".go"],
    definitions: [/^func\s+(?:\([^)]*\)\s*)?([A-Za-z]\w*)/, /^type\s+([A-Za-z]\w*)\s+(?:struct|interface)/],
    imports: "package",
    comment: /^\s*\/\//,
  },
  {
    id: "rb",
    extensions: [".rb"],
    definitions: [/^\s*def\s+(?:self\.)?([A-Za-z]\w*[?!]?)/, /^\s*(?:class|module)\s+([A-Z]\w*)/],
    imports: "none",
    comment: /^\s*#/,
  },
  {
    id: "rs",
    extensions: [".rs"],
    definitions: [
      /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z]\w*)/,
      /^\s*(?:pub\s+)?(?:struct|enum|trait)\s+([A-Z]\w*)/,
    ],
    imports: "none",
    comment: /^\s*\/\//,
  },
];

const KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "function",
  "return",
  "constructor",
  "with",
  "do",
  "else",
]);

export const languageOf = (path: string): Language | undefined => {
  const extension = extname(path).toLowerCase();
  return LANGUAGES.find((language) => language.extensions.includes(extension));
};

export const definitionsIn = (language: Language, text: string): ReadonlySet<string> => {
  const names = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    for (const pattern of language.definitions) {
      const name = pattern.exec(line)?.[1];
      if (name !== undefined && !KEYWORDS.has(name)) names.add(name);
    }
  }
  return names;
};

export const definesName = (language: Language, line: string, name: string): boolean =>
  language.definitions.some((pattern) => pattern.exec(line)?.[1] === name);

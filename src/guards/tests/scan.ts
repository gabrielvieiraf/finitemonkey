import type { TestLanguage } from "./patterns.js";

export interface TestCounts {
  readonly tests: number;
  readonly skips: number;
  readonly assertions: number;
}

const skipQuoted = (source: string, start: number, quote: string): number => {
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") index += 1;
    else if (char === quote) return index;
    else if (char === "\n" && quote !== "`") return index;
  }
  return source.length;
};

const skipComment = (source: string, start: number): number => {
  if (source[start + 1] === "/") {
    const end = source.indexOf("\n", start);
    return end < 0 ? source.length : end - 1;
  }
  const end = source.indexOf("*/", start + 2);
  return end < 0 ? source.length : end + 1;
};

export const stripJs = (source: string): string => {
  let out = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? "";
    const next = source[index + 1];
    if (char === "/" && (next === "/" || next === "*")) {
      index = skipComment(source, index);
      out += " ";
    } else if (char === '"' || char === "'" || char === "`") {
      index = skipQuoted(source, index, char);
      out += `${char}${char}`;
    } else out += char;
  }
  return out;
};

const stripHash = (source: string): string =>
  source
    .split("\n")
    .map((line) => line.replace(/(^|\s)#.*$/, ""))
    .join("\n");

const count = (source: string, pattern: RegExp): number => source.match(pattern)?.length ?? 0;

const RULES: Readonly<
  Record<TestLanguage, { readonly tests: RegExp; readonly skips: RegExp; readonly asserts: RegExp }>
> = {
  js: {
    tests: /(?<![.\w$])(?:it|test)\b(?:\s*\.\s*\w+)*\s*\(/g,
    skips:
      /\b(?:it|test|describe|suite|context)\s*\.\s*(?:skip|only|todo|skipIf|runIf|fails)\b|\b(?:xit|xtest|xdescribe|xcontext|fit|fdescribe)\s*\(/g,
    asserts:
      /\bexpect\s*[(.]|\bassert\b(?:\s*\.\s*\w+)*\s*\(|\.\s*should\b|\bt\s*\.\s*(?:is|not|deepEqual|true|false|truthy|falsy|throws|equal|ok|assert|snapshot|regex|like)\s*\(/g,
  },
  py: {
    tests: /^\s*(?:async\s+)?def\s+test\w*\s*\(/gm,
    skips: /@pytest\.mark\.(?:skip|skipif|xfail)\b|\bunittest\.skip\w*|\bpytest\.skip\s*\(|\bself\.skipTest\s*\(/g,
    asserts: /^\s*assert\b|\bself\.assert\w+\s*\(|\bpytest\.raises\s*\(/gm,
  },
  go: {
    tests: /\bfunc\s+Test\w*\s*\(/g,
    skips: /\bt\.Skip(?:Now|f)?\s*\(/g,
    asserts: /\bt\.(?:Error|Errorf|Fatal|Fatalf|Fail|FailNow)\s*\(|\b(?:assert|require)\.\w+\s*\(/g,
  },
};

export const countTests = (language: TestLanguage, source: string): TestCounts => {
  const code = language === "py" ? stripHash(source) : stripJs(source);
  const rules = RULES[language];
  const skips = count(code, rules.skips);
  return { tests: count(code, rules.tests), skips, assertions: count(code, rules.asserts) };
};

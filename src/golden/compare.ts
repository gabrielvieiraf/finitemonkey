export type GoldenDifference =
  | {
      readonly kind: "number";
      readonly line: number;
      readonly expected: number;
      readonly actual: number;
      readonly delta: number;
    }
  | { readonly kind: "text"; readonly line: number; readonly expected: string; readonly actual: string };

const NUMBER = /-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g;
const SHOWN = 120;

export const normalizeOutput = (text: string): readonly string[] => {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd());
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
};

const shown = (text: string): string => (text.length > SHOWN ? `${text.slice(0, SHOWN)}…` : text);

const numbersOf = (line: string): readonly number[] => (line.match(NUMBER) ?? []).map(Number);

const skeleton = (line: string): string => line.replace(NUMBER, "#");

const roundDelta = (value: number): number => Number(value.toPrecision(6));

const lineDifference = (
  index: number,
  expected: string,
  actual: string,
  tolerance: number,
): GoldenDifference | undefined => {
  if (expected === actual) return undefined;
  const text = { kind: "text", line: index + 1, expected: shown(expected), actual: shown(actual) } as const;
  if (skeleton(expected) !== skeleton(actual)) return text;
  const wanted = numbersOf(expected);
  const got = numbersOf(actual);
  for (const [position, value] of wanted.entries()) {
    const other = got[position] ?? Number.NaN;
    const delta = Math.abs(other - value);
    if (!(delta <= tolerance)) {
      return { kind: "number", line: index + 1, expected: value, actual: other, delta: roundDelta(delta) };
    }
  }
  return undefined;
};

export const compareOutput = (
  expectedText: string,
  actualText: string,
  tolerance: number,
): GoldenDifference | undefined => {
  const expected = normalizeOutput(expectedText);
  const actual = normalizeOutput(actualText);
  const length = Math.max(expected.length, actual.length);
  for (let index = 0; index < length; index += 1) {
    const found = lineDifference(index, expected[index] ?? "", actual[index] ?? "", tolerance);
    if (found !== undefined) return found;
  }
  return undefined;
};

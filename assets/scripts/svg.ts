export type SvgValue = number | string;

export function svg(strings: TemplateStringsArray, ...values: readonly SvgValue[]): string {
  return strings.reduce((out, part, index) => {
    const value = values[index - 1];
    return out + (value === undefined ? "" : String(value)) + part;
  }, "");
}

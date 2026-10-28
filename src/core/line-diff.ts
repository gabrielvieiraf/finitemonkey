export interface NumberedLine {
  readonly line: number;
  readonly text: string;
}

export const addedByContent = (before: string | undefined, after: string): readonly NumberedLine[] => {
  const left = new Map<string, number>();
  for (const line of (before ?? "").split("\n")) left.set(line, (left.get(line) ?? 0) + 1);
  return after.split("\n").flatMap((text, index) => {
    const count = left.get(text) ?? 0;
    if (count > 0) {
      left.set(text, count - 1);
      return [];
    }
    return [{ line: index + 1, text }];
  });
};

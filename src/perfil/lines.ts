import type { TextSource } from "../core/context.js";

export type AskLine = () => Promise<string | undefined>;

export const lineReader = (source: TextSource): AskLine => {
  const ready: string[] = [];
  const waiting: ((line: string | undefined) => void)[] = [];
  let buffer = "";
  let ended = false;
  const push = (line: string | undefined): void => {
    const next = waiting.shift();
    if (next !== undefined) next(line);
    else if (line !== undefined) ready.push(line);
  };
  source.setEncoding?.("utf8");
  source.on("data", (chunk) => {
    buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() ?? "";
    for (const part of parts) push(part);
  });
  const finish = (): void => {
    if (ended) return;
    ended = true;
    if (buffer !== "") push(buffer);
    buffer = "";
    while (waiting.length > 0) push(undefined);
  };
  source.on("end", finish);
  source.on("error", finish);
  return () => {
    const line = ready.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (ended) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      waiting.push(resolve);
    });
  };
};

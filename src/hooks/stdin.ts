import type { TextSource } from "../core/context.js";
import type { Runtime } from "../core/runtime.js";

export const readAll = (source: TextSource): Promise<string> =>
  new Promise((resolve, reject) => {
    if (source.isTTY === true) {
      resolve("");
      return;
    }
    const chunks: string[] = [];
    source.setEncoding?.("utf8");
    source.on("data", (chunk) => {
      chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    });
    source.on("end", () => {
      resolve(chunks.join(""));
    });
    source.on("error", reject);
  });

export class DeadlineError extends Error {
  readonly ms: number;

  constructor(ms: number) {
    super(`deadline of ${String(ms)} ms exceeded`);
    this.name = "DeadlineError";
    this.ms = ms;
  }
}

export const withDeadline = <T>(work: Promise<T>, ms: number, startTimer: Runtime["startTimer"]): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const cancel = startTimer(ms, () => {
      reject(new DeadlineError(ms));
    });
    work.then(
      (value) => {
        cancel();
        resolve(value);
      },
      (error: unknown) => {
        cancel();
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });

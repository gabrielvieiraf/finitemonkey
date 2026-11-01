import { freePort, startApp, stopApp, waitForPort } from "../app/node-process.js";
import type { AbsolutePath } from "../core/brand.js";
import type { BaseBoot, SameRunDeps } from "./base-run.js";

export const nodeBoot =
  (host: string, timeoutMs: number) =>
  async (command: string, dir: AbsolutePath, port: number): Promise<BaseBoot> => {
    const app = startApp(command, dir, port);
    const state = await waitForPort(app, host, port, Date.now() + timeoutMs);
    const stop = async (): Promise<void> => {
      await stopApp(app);
    };
    if (state === "open") return { app: { stop } };
    await stop();
    return {
      detail: state === "exited" ? `the base app exited with code ${String(app.exited()?.code ?? -1)}` : "port timeout",
    };
  };

export const nodeSameRunDeps = (input: Omit<SameRunDeps, "freePort" | "boot">): SameRunDeps => ({
  ...input,
  freePort,
  boot: nodeBoot(input.host, input.timeoutMs),
});

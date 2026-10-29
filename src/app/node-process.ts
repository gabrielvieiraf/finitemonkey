import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { connect } from "node:net";

const MAX_OUTPUT = 64 * 1024;
const POLL_MS = 150;
const STOP_GRACE_MS = 3000;

export interface RunningApp {
  readonly child: ChildProcess;
  readonly output: () => string;
  readonly exited: () => { readonly code: number | null } | undefined;
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const portOpen = (host: string, port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (open: boolean): void => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(1000, () => {
      done(false);
    });
    socket.once("connect", () => {
      done(true);
    });
    socket.once("error", () => {
      done(false);
    });
  });

const KEPT_ENV = [
  "PATH",
  "Path",
  "HOME",
  "USER",
  "LANG",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SystemRoot",
  "ComSpec",
  "PATHEXT",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
] as const;

export const minimalEnv = (source: NodeJS.ProcessEnv, port: number): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(KEPT_ENV.flatMap((name) => (source[name] === undefined ? [] : [[name, source[name]]]))),
  NODE_ENV: "test",
  PORT: String(port),
});

export const startApp = (command: string, cwd: string, port: number, minimal = false): RunningApp => {
  const child = spawn(command, {
    cwd,
    shell: true,
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: minimal ? minimalEnv(process.env, port) : { ...process.env, PORT: String(port) },
  });
  let output = "";
  let exit: { readonly code: number | null } | undefined;
  const collect = (chunk: Buffer): void => {
    output = `${output}${chunk.toString("utf8")}`.slice(-MAX_OUTPUT);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  child.once("error", (error) => {
    output = `${output}${error.message}`;
    exit = { code: null };
  });
  child.once("exit", (code) => {
    exit = { code };
  });
  return { child, output: () => output, exited: () => exit };
};

export const waitForPort = async (
  app: RunningApp,
  host: string,
  port: number,
  deadline: number,
): Promise<"open" | "exited" | "timeout"> => {
  while (Date.now() < deadline) {
    if (await portOpen(host, port)) return "open";
    if (app.exited() !== undefined) return "exited";
    await sleep(POLL_MS);
  }
  return "timeout";
};

const signalGroup = (pid: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(-pid, signal);
  } catch {
    return;
  }
};

const alive = (pid: number): boolean => {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const stopApp = async (app: RunningApp): Promise<boolean> => {
  const pid = app.child.pid;
  if (pid === undefined) return true;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    return true;
  }
  signalGroup(pid, "SIGTERM");
  const deadline = Date.now() + STOP_GRACE_MS;
  while (alive(pid) && Date.now() < deadline) await sleep(POLL_MS);
  if (alive(pid)) signalGroup(pid, "SIGKILL");
  return !alive(pid);
};

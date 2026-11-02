import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { OnboardState } from "../onboard/state.js";
import { packageManager, type ProjectFiles } from "../task/implicit.js";

export const FRAMEWORKS = ["next", "nuxt", "vite"] as const;
export type Framework = (typeof FRAMEWORKS)[number];

const MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;
type Manager = (typeof MANAGERS)[number];

const RUNNER: Readonly<Record<Manager, string>> = {
  npm: "npx --no-install",
  pnpm: "pnpm exec",
  yarn: "yarn",
  bun: "bunx",
};

const DEV: Readonly<Record<Framework, (host: string, port: number) => string>> = {
  next: (host, port) => `next dev --port ${String(port)} --hostname ${host}`,
  nuxt: (host, port) => `nuxi dev --port ${String(port)} --host ${host}`,
  vite: (host, port) => `vite --port ${String(port)} --host ${host} --strictPort`,
};

export interface DevStart {
  readonly command: string;
  readonly source: "look.yml" | Framework;
  readonly manager: string;
}

const dependencies = (files: ProjectFiles): ReadonlySet<string> => {
  const text = files.read("package.json");
  const parsed = text === undefined ? undefined : parseJsonObject(text);
  if (parsed?.ok !== true) return new Set();
  const names = ["dependencies", "devDependencies"].flatMap((key) => {
    const value = parsed.value[key];
    return isRecord(value) ? Object.keys(value) : [];
  });
  return new Set(names);
};

export const detectFramework = (files: ProjectFiles): Framework | undefined => {
  const names = dependencies(files);
  return FRAMEWORKS.find((framework) => names.has(framework));
};

export const onboardManager = (state: OnboardState | undefined): Manager | undefined => {
  for (const command of state?.commands ?? []) {
    const first = command.run.trim().split(/\s+/)[0];
    const manager = MANAGERS.find((item) => item === first);
    if (manager !== undefined) return manager;
  }
  return undefined;
};

const managerOf = (files: ProjectFiles, state: OnboardState | undefined): Manager => {
  const detected = packageManager(files);
  return onboardManager(state) ?? MANAGERS.find((item) => item === detected) ?? "npm";
};

export const devStart = (
  files: ProjectFiles,
  input: {
    readonly declared: string | undefined;
    readonly onboard: OnboardState | undefined;
    readonly host: string;
    readonly port: number;
  },
): DevStart | undefined => {
  const manager = managerOf(files, input.onboard);
  if (input.declared !== undefined) return { command: input.declared, source: "look.yml", manager };
  const framework = detectFramework(files);
  if (framework === undefined) return undefined;
  return { command: `${RUNNER[manager]} ${DEV[framework](input.host, input.port)}`, source: framework, manager };
};

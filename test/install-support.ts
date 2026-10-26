import { join } from "node:path";

import { toAbsolutePath } from "../src/core/brand.js";
import { memoryFs } from "./memory-fs.js";
import { BUNDLE, cliJson, fakeRuntime, field, found } from "./support.js";

export const ROOT = toAbsolutePath("/home/ana/project");
export const at = (relative: string): string => join(ROOT, relative);

export const FAKE_BUNDLE = "#!/usr/bin/env node\nconsole.log('finitemonkey');\n";

export const repo = (files: Readonly<Record<string, string>> = {}): ReturnType<typeof memoryFs> =>
  memoryFs(
    { [BUNDLE]: FAKE_BUNDLE, ...Object.fromEntries(Object.entries(files).map(([path, text]) => [at(path), text])) },
    [at(".git")],
  );

export const run = (
  fs: ReturnType<typeof memoryFs>,
  argv: readonly string[],
  version?: string,
): ReturnType<typeof cliJson> =>
  cliJson(argv, {
    cwd: ROOT,
    runtime: fakeRuntime({ fs, tools: { claude: found("2.1.300 (Claude Code)") } }),
    env: {},
    ...(version === undefined ? {} : { version }),
  });

export const actions = (body: unknown): Readonly<Record<string, unknown>> => {
  const list = field(body, "data", "actions");
  const items: readonly unknown[] = Array.isArray(list) ? list : [];
  return Object.fromEntries(items.map((item) => [String(field(item, "path")), field(item, "action")]));
};

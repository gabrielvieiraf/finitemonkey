import { toAbsolutePath } from "./core/brand.js";
import { isEntryPoint } from "./core/entry.js";
import { nodeRealpath, nodeRuntime } from "./core/node-runtime.js";
import { run } from "./core/run.js";
import { readPackageVersion } from "./core/version.js";

const flush = (stream: NodeJS.WriteStream): Promise<void> =>
  new Promise((resolve) => {
    stream.write("", () => {
      resolve();
    });
  });

export const main = async (): Promise<never> => {
  const runtime = nodeRuntime();
  const code = await run({
    argv: process.argv.slice(2),
    env: process.env,
    cwd: toAbsolutePath(process.cwd()),
    platform: process.platform,
    io: { stdout: process.stdout, stderr: process.stderr, stdin: process.stdin },
    version: readPackageVersion(runtime.readText, import.meta.url),
    runtime,
  });
  await Promise.all([flush(process.stdout), flush(process.stderr)]);
  process.exit(code);
};

if (isEntryPoint(import.meta.url, process.argv[1], nodeRealpath, process.platform)) await main();

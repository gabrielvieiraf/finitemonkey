import { fileURLToPath } from "node:url";

export type Realpath = (path: string) => string;

export const isEntryPoint = (
  moduleUrl: string,
  argv1: string | undefined,
  realpath: Realpath,
  platform: NodeJS.Platform,
): boolean => {
  if (argv1 === undefined) return false;
  const self = realpath(fileURLToPath(moduleUrl));
  const invoked = realpath(argv1);
  return platform === "win32" ? self.toLowerCase() === invoked.toLowerCase() : self === invoked;
};

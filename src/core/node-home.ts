import { homedir, tmpdir } from "node:os";

export const safeHomeDir = (resolve: () => string = homedir, fallback: () => string = tmpdir): string => {
  try {
    return resolve();
  } catch {
    return fallback();
  }
};

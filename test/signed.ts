import type { JsonObject } from "../src/core/parsed.js";
import { ensureKey, keyPath, type KeyStore, signLine, toKey } from "../src/evidence/sign.js";

const SECRET = "5e".repeat(32);

export const TEST_KEY = toKey(SECRET);

export const keySeed = (home = "/home/test"): Readonly<Record<string, string>> => ({
  [keyPath({ homeDir: () => home })]: `${SECRET}\n`,
});

export const signedTest = (entry: JsonObject): string => signLine(TEST_KEY, entry);

export const signedLine = (runtime: KeyStore, entry: JsonObject): string => {
  const key = ensureKey(runtime);
  if (key === undefined) throw new Error("no ledger key");
  return signLine(key, entry);
};

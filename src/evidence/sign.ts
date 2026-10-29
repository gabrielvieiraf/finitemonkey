import { createHmac, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { type JsonObject, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { sha256Hex as sha256 } from "../secrets/fingerprint.js";

export const KEY_PATH = [".finitemonkey", "ledger.key"] as const;
const KEY_SHAPE = /^[0-9a-f]{64}$/;
const KID_LENGTH = 12;

export interface LedgerKey {
  readonly secret: string;
  readonly kid: string;
}

export const keyPath = (runtime: Pick<Runtime, "homeDir">): AbsolutePath =>
  toAbsolutePath(join(runtime.homeDir(), ...KEY_PATH));

export const toKey = (secret: string): LedgerKey => ({ secret, kid: sha256(secret).slice(0, KID_LENGTH) });

export const readKey = (runtime: Pick<Runtime, "readText" | "homeDir">): LedgerKey | undefined => {
  const text = runtime.readText(keyPath(runtime));
  const secret = text.ok ? text.value.trim() : "";
  return KEY_SHAPE.test(secret) ? toKey(secret) : undefined;
};

const LOCK_TRIES = 2000;
const LOCK_STALE_MS = 10_000;

export type KeyStore = Pick<Runtime, "readText" | "writeText" | "homeDir" | "lock" | "mkdir">;

const createKey = (runtime: KeyStore): LedgerKey | undefined => {
  const again = readKey(runtime);
  if (again !== undefined) return again;
  const written = runtime.writeText(keyPath(runtime), `${randomBytes(32).toString("hex")}\n`);
  return written.ok ? readKey(runtime) : undefined;
};

export const ensureKey = (runtime: KeyStore): LedgerKey | undefined => {
  const found = readKey(runtime);
  if (found !== undefined) return found;
  const path = keyPath(runtime);
  runtime.mkdir(toAbsolutePath(dirname(path)));
  const lockPath = toAbsolutePath(`${path}.lock`);
  for (let attempt = 0; attempt < LOCK_TRIES; attempt += 1) {
    const lock = runtime.lock(lockPath, { staleMs: LOCK_STALE_MS, owner: "ledger-key" });
    if (lock.ok) {
      try {
        return createKey(runtime);
      } finally {
        lock.value();
      }
    }
    const other = readKey(runtime);
    if (other !== undefined) return other;
  }
  return undefined;
};

const mac = (key: LedgerKey, body: string): string => createHmac("sha256", key.secret).update(body).digest("hex");

export const signLine = (key: LedgerKey, entry: JsonObject): string => {
  const body = JSON.stringify(entry);
  return JSON.stringify({ ...entry, kid: key.kid, sig: mac(key, body) });
};

export type LineTrust = "signed" | "old_key" | "tampered";

export const lineTrust = (key: LedgerKey | undefined, line: string): LineTrust => {
  const parsed = parseJsonObject(line);
  if (!parsed.ok) return "tampered";
  const { kid, sig, ...rest } = parsed.value;
  if (typeof kid === "string" && kid !== key?.kid) return "old_key";
  if (key === undefined) return "tampered";
  if (typeof sig !== "string" || kid !== key.kid) return "tampered";
  return mac(key, JSON.stringify(rest)) === sig ? "signed" : "tampered";
};

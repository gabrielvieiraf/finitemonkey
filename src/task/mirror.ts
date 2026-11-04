import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { HOME_DATA_DIR } from "../core/data-dir.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { ensureKey, lineTrust, readKey, signLine } from "../evidence/sign.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import { FM_DIR } from "./paths.js";

export const MIRROR_SCHEMA = "finitemonkey/store-mirror@1";
export const MIRRORED_DIRS = ["allow", "incidents", "backups"] as const;
const INDEX_FILE = "index.json";
const MARKER = ["runtime", "mirror.json"] as const;
const ID_LENGTH = 16;

export type MirrorRuntime = Pick<
  Runtime,
  "readText" | "writeText" | "walkFiles" | "copyFile" | "stat" | "mkdir" | "homeDir" | "lock" | "git" | "realpath"
>;

export interface Restore {
  readonly from: AbsolutePath;
  readonly files: number;
}

const gitCommonDir = (runtime: MirrorRuntime, root: AbsolutePath): AbsolutePath | undefined => {
  const result = runtime.git(["rev-parse", "--path-format=absolute", "--git-common-dir"], root);
  const dir = result.stdout.trim();
  return result.ok && dir !== "" ? toAbsolutePath(dir) : undefined;
};

export const projectId = (runtime: Pick<Runtime, "realpath">, root: AbsolutePath): string =>
  sha256Hex(runtime.realpath(root)).slice(0, ID_LENGTH);

export const mirrorDirs = (runtime: MirrorRuntime, root: AbsolutePath): readonly AbsolutePath[] => {
  const common = gitCommonDir(runtime, root);
  const home = toAbsolutePath(join(runtime.homeDir(), HOME_DATA_DIR, "projects", projectId(runtime, root)));
  return common === undefined ? [home] : [toAbsolutePath(join(common, "finitemonkey", "mirror")), home];
};

const storeFiles = (runtime: MirrorRuntime, store: AbsolutePath): readonly string[] =>
  MIRRORED_DIRS.flatMap((dir) => {
    const listed = runtime.walkFiles(toAbsolutePath(join(store, dir)));
    return listed.ok ? listed.value.map((file) => `${dir}/${file}`) : [];
  });

const hashOf = (runtime: MirrorRuntime, path: AbsolutePath): string | undefined => {
  const text = runtime.readText(path);
  return text.ok ? sha256Hex(text.value) : undefined;
};

const copyChanged = (
  runtime: MirrorRuntime,
  from: AbsolutePath,
  to: AbsolutePath,
  files: Readonly<Record<string, string>>,
) =>
  Object.entries(files)
    .filter(([file, hash]) => hashOf(runtime, toAbsolutePath(join(to, file))) !== hash)
    .every(([file]) => runtime.copyFile(toAbsolutePath(join(from, file)), toAbsolutePath(join(to, file))).ok);

const storeHashes = (runtime: MirrorRuntime, store: AbsolutePath): Readonly<Record<string, string>> =>
  Object.fromEntries(
    storeFiles(runtime, store).flatMap((file) => {
      const hash = hashOf(runtime, toAbsolutePath(join(store, file)));
      return hash === undefined ? [] : [[file, hash]];
    }),
  );

const markerPath = (store: AbsolutePath): AbsolutePath => toAbsolutePath(join(store, ...MARKER));

export const mirrorStore = (runtime: MirrorRuntime, root: AbsolutePath): number => {
  const store = toAbsolutePath(join(root, FM_DIR));
  const hashes = storeHashes(runtime, store);
  const key = ensureKey(runtime);
  if (Object.keys(hashes).length === 0 || key === undefined) return 0;
  const index = signLine(key, { schema: MIRROR_SCHEMA, root: runtime.realpath(root), files: hashes });
  let written = 0;
  for (const dir of mirrorDirs(runtime, root)) {
    runtime.mkdir(dir);
    if (!copyChanged(runtime, store, dir, hashes)) continue;
    if (runtime.writeText(toAbsolutePath(join(dir, INDEX_FILE)), `${index}\n`).ok) written += 1;
  }
  if (written > 0)
    runtime.writeText(
      markerPath(store),
      `${JSON.stringify({ schema: MIRROR_SCHEMA, files: Object.keys(hashes).length })}\n`,
    );
  return written;
};

const signedFiles = (runtime: MirrorRuntime, dir: AbsolutePath): Readonly<Record<string, string>> | undefined => {
  const text = runtime.readText(toAbsolutePath(join(dir, INDEX_FILE)));
  if (!text.ok || lineTrust(readKey(runtime), text.value.trim()) !== "signed") return undefined;
  const parsed = parseJsonObject(text.value);
  const files = parsed.ok && parsed.value["schema"] === MIRROR_SCHEMA ? parsed.value["files"] : undefined;
  if (!isRecord(files)) return undefined;
  return Object.fromEntries(
    Object.entries(files).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
};

const restoreFrom = (runtime: MirrorRuntime, dir: AbsolutePath, store: AbsolutePath): number | undefined => {
  const files = signedFiles(runtime, dir);
  if (files === undefined) return undefined;
  const missing = Object.fromEntries(
    Object.entries(files).filter(
      ([file, hash]) =>
        runtime.stat(toAbsolutePath(join(store, file))) === undefined &&
        hashOf(runtime, toAbsolutePath(join(dir, file))) === hash,
    ),
  );
  return copyChanged(runtime, dir, store, missing) ? Object.keys(missing).length : undefined;
};

export const restoreStore = (runtime: MirrorRuntime, root: AbsolutePath): Restore | undefined => {
  const store = toAbsolutePath(join(root, FM_DIR));
  if (runtime.stat(markerPath(store)) !== undefined) return undefined;
  for (const dir of mirrorDirs(runtime, root)) {
    const files = restoreFrom(runtime, dir, store);
    if (files !== undefined && files > 0) return { from: dir, files };
  }
  return undefined;
};

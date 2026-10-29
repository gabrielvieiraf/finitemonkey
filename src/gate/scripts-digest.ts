import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { LOCAL_BIN, SETTINGS_FILE, VENDOR_BIN } from "../install/layout.js";
import { sha256Hex as sha256 } from "../secrets/fingerprint.js";

const fileHash = (runtime: Pick<Runtime, "readText">, path: AbsolutePath): string => {
  const text = runtime.readText(path);
  return text.ok ? sha256(text.value) : "-";
};

const hooksHash = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): string => {
  const text = runtime.readText(toAbsolutePath(join(root, SETTINGS_FILE)));
  const parsed = text.ok ? parseJsonObject(text.value) : undefined;
  const hooks = parsed?.ok === true ? parsed.value["hooks"] : undefined;
  return hooks === undefined ? "-" : sha256(JSON.stringify(hooks));
};

export const scriptsDigest = (runtime: Pick<Runtime, "readText" | "selfPath">, root: AbsolutePath): string =>
  sha256(
    [
      `self:${fileHash(runtime, runtime.selfPath)}`,
      `vendor:${fileHash(runtime, toAbsolutePath(join(root, VENDOR_BIN)))}`,
      `local:${fileHash(runtime, toAbsolutePath(join(root, LOCAL_BIN)))}`,
      `hooks:${hooksHash(runtime, root)}`,
    ].join("\n"),
  ).slice(0, 32);

import { parseJsonObject } from "../core/parsed.js";
import { VENDOR_BIN, VENDOR_PACKAGE } from "./layout.js";

const isBundle = (text: string): boolean => text.startsWith("#!/usr/bin/env node") && text.includes("finitemonkey");

const isOwnPackage = (text: string): boolean => {
  const parsed = parseJsonObject(text);
  return parsed.ok && parsed.value["name"] === "finitemonkey";
};

export const vendoredPackage = (version: string): string =>
  `${JSON.stringify({ name: "finitemonkey", version, private: true, type: "module" }, null, 2)}\n`;

export const vendoredFiles = (
  bundle: string,
  version: string,
): readonly { readonly path: string; readonly template: string; readonly isOurs: (text: string) => boolean }[] => [
  { path: VENDOR_BIN, template: bundle, isOurs: isBundle },
  { path: VENDOR_PACKAGE, template: vendoredPackage(version), isOurs: isOwnPackage },
];

export const isBundlePath = (path: string): boolean => path.endsWith(".mjs");

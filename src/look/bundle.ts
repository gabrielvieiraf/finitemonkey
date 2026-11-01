import { dirname, join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";

export type ManifestKind = "vite" | "next";

export interface BundleSize {
  readonly manifest: string;
  readonly kind: ManifestKind;
  readonly bytes: number;
  readonly files: readonly string[];
}

interface ManifestSource {
  readonly path: string;
  readonly kind: ManifestKind;
  readonly assets: string;
}

export const MANIFESTS: readonly ManifestSource[] = [
  { path: "dist/.vite/manifest.json", kind: "vite", assets: "dist" },
  { path: "dist/manifest.json", kind: "vite", assets: "dist" },
  { path: ".next/build-manifest.json", kind: "next", assets: ".next" },
];

const isScript = (file: string): boolean => /\.m?js$/.test(file);

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const viteFiles = (manifest: Record<string, unknown>): readonly string[] =>
  Object.values(manifest).flatMap((entry) =>
    isRecord(entry) && typeof entry["file"] === "string" ? [entry["file"]] : [],
  );

const nextFiles = (manifest: Record<string, unknown>): readonly string[] => {
  const pages = isRecord(manifest["pages"]) ? Object.values(manifest["pages"]).flatMap(strings) : [];
  return [...strings(manifest["rootMainFiles"]), ...strings(manifest["polyfillFiles"]), ...pages];
};

const FILES_OF: Readonly<Record<ManifestKind, (manifest: Record<string, unknown>) => readonly string[]>> = {
  vite: viteFiles,
  next: nextFiles,
};

const kindOf = (path: string): ManifestKind => (path.endsWith("build-manifest.json") ? "next" : "vite");

const sourceOf = (manifest: string | undefined): readonly ManifestSource[] => {
  if (manifest === undefined) return MANIFESTS;
  const kind = kindOf(manifest);
  const assets =
    kind === "vite" && manifest.endsWith(".vite/manifest.json") ? dirname(dirname(manifest)) : dirname(manifest);
  return [{ path: manifest, kind, assets }];
};

const sizeOf = (runtime: Pick<Runtime, "stat">, root: AbsolutePath, assets: string, file: string): number =>
  runtime.stat(toAbsolutePath(join(root, assets, file.replace(/^\//, ""))))?.size ?? 0;

const measured = (
  runtime: Pick<Runtime, "readText" | "stat">,
  root: AbsolutePath,
  source: ManifestSource,
): BundleSize | undefined => {
  const text = runtime.readText(toAbsolutePath(join(root, source.path)));
  const parsed = text.ok ? parseJsonObject(text.value) : undefined;
  if (parsed?.ok !== true) return undefined;
  const files = [...new Set(FILES_OF[source.kind](parsed.value).filter(isScript))].sort();
  if (files.length === 0) return undefined;
  const bytes = files.reduce((sum, file) => sum + sizeOf(runtime, root, source.assets, file), 0);
  return { manifest: source.path, kind: source.kind, bytes, files };
};

export const buildBundleSize = (
  runtime: Pick<Runtime, "readText" | "stat">,
  root: AbsolutePath,
  manifest?: string,
): BundleSize | undefined => {
  for (const source of sourceOf(manifest)) {
    const size = measured(runtime, root, source);
    if (size !== undefined) return size;
  }
  return undefined;
};

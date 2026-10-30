import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import { fmPaths } from "../task/paths.js";
import { provenanceSources, renderBlock, sourcesHash } from "./provenance.js";

export const PROVENANCE_FEATURE = "pr-provenance";
export const PROVENANCE_CACHE = "pr-provenance.md";

type AttachRuntime = Pick<Runtime, "readText" | "homeDir" | "exec" | "writeText" | "appendText" | "now">;

export const attachProvenance = (
  runtime: AttachRuntime,
  root: AbsolutePath,
  body: string,
  files: readonly string[],
): string => {
  const paths = fmPaths(root);
  const mode = featureMode(runtime, paths, PROVENANCE_FEATURE);
  if (mode === "off") return body;
  const sources = provenanceSources(runtime, root, files);
  const block = renderBlock(sources);
  if (mode === "active") return `${body.trimEnd()}\n\n${block}\n`;
  runtime.writeText(paths.cache(PROVENANCE_CACHE), `${block}\n`);
  recordFeatureShadow(runtime, paths, PROVENANCE_FEATURE, { hash: sourcesHash(sources), files: files.length });
  return body;
};

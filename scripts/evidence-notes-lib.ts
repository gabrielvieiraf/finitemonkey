import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseJsonObject } from "../src/core/parsed.js";
import { readEvidence, renderEvidence } from "./evidence-text.js";

export const NOTES_HEADING = "### Evidence";

export const repositoryUrl = (root: string): string | undefined => {
  const file = join(root, "package.json");
  if (!existsSync(file)) return undefined;
  const pkg = parseJsonObject(readFileSync(file, "utf8"));
  const repository = pkg.ok ? pkg.value["repository"] : undefined;
  const url =
    typeof repository === "string"
      ? repository
      : typeof repository === "object" && repository !== null && "url" in repository
        ? repository.url
        : undefined;
  return typeof url === "string" ? url.replace(/^git\+/, "").replace(/\.git$/, "") : undefined;
};

const absoluteLinks = (text: string, base: string | undefined, version: string): string =>
  base === undefined ? text : text.replace(/\]\((?!https?:)([^)]+)\)/g, `](${base}/tree/v${version}/$1)`);

export const evidenceNotes = (root: string, version?: string): string => {
  const evidence = readEvidence(root);
  const labeled = evidence === undefined || version === undefined ? evidence : { ...evidence, version };
  const table = renderEvidence("en", labeled);
  return `${NOTES_HEADING}\n\n${absoluteLinks(table, repositoryUrl(root), labeled?.version ?? version ?? "")}\n`;
};

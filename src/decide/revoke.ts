import type { AbsolutePath } from "../core/brand.js";
import { isRecord } from "../core/parsed.js";
import { accept, type Parsed, reject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { YamlValue } from "../core/yaml/scalar.js";
import type { Translate } from "../i18n/translate.js";
import { planPath } from "../plan/folder.js";
import { readFront, writeFront } from "../plan/front.js";
import { matchesHeading } from "../plan/sections.js";
import { decisionKey } from "./sections.js";

export type RevokeProblem = "missing" | "replacement_missing" | "already_revoked" | "write_failed";

export const toYaml = (value: unknown): YamlValue => {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return value;
  if (Array.isArray(value)) return value.map(toYaml);
  return isRecord(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toYaml(item)])) : null;
};

const withBanner = (body: string, banner: string): string => {
  const lines = body.split("\n");
  const title = lines.findIndex((line) => line.startsWith("# "));
  const at = title === -1 ? 0 : title + 1;
  return [...lines.slice(0, at), "", banner, ...lines.slice(at)].join("\n");
};

export const withStatus = (body: string, status = "revoked"): string => {
  const lines = body.split("\n");
  const heading = lines.findIndex(
    (line) => line.startsWith("## ") && matchesHeading(line.slice(3), decisionKey("status")),
  );
  if (heading === -1) return body;
  const value = lines.findIndex((line, index) => index > heading && line.trim() !== "");
  if (value === -1 || lines[value]?.startsWith("#") === true)
    return [...lines.slice(0, heading + 1), "", status, ...lines.slice(heading + 1)].join("\n");
  return [...lines.slice(0, value), status, ...lines.slice(value + 1)].join("\n");
};

export const revokeDecision = (
  runtime: Runtime,
  t: Translate,
  root: AbsolutePath,
  name: string,
  by: string,
): Parsed<string, RevokeProblem> => {
  const text = runtime.readText(planPath(root, name));
  if (!text.ok) return reject("missing");
  if (!runtime.readText(planPath(root, by)).ok) return reject("replacement_missing");
  const { data, body } = readFront(text.value);
  if (data?.["status"] === "revoked") return reject("already_revoked");
  const date = runtime.now().slice(0, 10);
  const banner = `> **${t("decision.revoked", { date, file: by })}**`;
  const front = toYaml({ ...(data ?? {}), status: "revoked", revoked: date, replaced_by: by });
  const written = runtime.writeText(planPath(root, name), writeFront(front, withStatus(withBanner(body, banner))));
  return written.ok ? accept(name) : reject("write_failed");
};

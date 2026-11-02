import { posix } from "node:path";

import { isRecord, type JsonObject, parseJsonObject } from "../core/parsed.js";
import type { DetectorSources } from "./detector-sources.js";
import type { QualityFinding } from "./ratchet.js";

interface ToolConfig {
  readonly tool: string;
  readonly files: readonly string[];
  readonly packageKey: string;
}

export const TOOL_CONFIGS: readonly ToolConfig[] = [
  { tool: "prettier", files: [".prettierrc", ".prettierrc.json"], packageKey: "prettier" },
  { tool: "eslint", files: [".eslintrc", ".eslintrc.json"], packageKey: "eslintConfig" },
  { tool: "babel", files: [".babelrc", ".babelrc.json", "babel.config.json"], packageKey: "babel" },
  { tool: "jest", files: ["jest.config.json"], packageKey: "jest" },
  { tool: "stylelint", files: [".stylelintrc", ".stylelintrc.json"], packageKey: "stylelint" },
];

type Read = (file: string) => string | undefined;

interface Conflict {
  readonly id: string;
  readonly tool: string;
  readonly key: string;
  readonly files: readonly string[];
}

const objectOf = (text: string | undefined): JsonObject | undefined => {
  const parsed = text === undefined ? undefined : parseJsonObject(text);
  return parsed?.ok === true ? parsed.value : undefined;
};

const configsIn = (read: Read, dir: string, config: ToolConfig): readonly [string, JsonObject][] => {
  const own = config.files.flatMap((name): [string, JsonObject][] => {
    const path = posix.join(dir, name);
    const value = objectOf(read(path));
    return value === undefined ? [] : [[path, value]];
  });
  const manifestPath = posix.join(dir, "package.json");
  const embedded = objectOf(read(manifestPath))?.[config.packageKey];
  return isRecord(embedded) ? [...own, [`${manifestPath}#${config.packageKey}`, embedded]] : own;
};

export const conflictsIn = (read: Read, dir: string, config: ToolConfig): readonly Conflict[] => {
  const values = new Map<string, Map<string, string>>();
  for (const [path, object] of configsIn(read, dir, config)) {
    for (const [key, value] of Object.entries(object)) {
      const seen = values.get(key) ?? new Map<string, string>();
      seen.set(path, JSON.stringify(value));
      values.set(key, seen);
    }
  }
  return [...values].flatMap(([key, seen]) =>
    new Set(seen.values()).size > 1
      ? [{ id: `${dir}\0${config.tool}\0${key}`, tool: config.tool, key, files: [...seen.keys()] }]
      : [],
  );
};

const groupsTouched = (changed: readonly string[]): readonly [string, ToolConfig, string][] =>
  changed.flatMap((file) => {
    const name = posix.basename(file);
    return TOOL_CONFIGS.filter((config) => name === "package.json" || config.files.includes(name)).map(
      (config): [string, ToolConfig, string] => [posix.dirname(file), config, file],
    );
  });

export const duplicatedConfigFindings = (sources: DetectorSources): readonly QualityFinding[] => {
  const seen = new Set<string>();
  return groupsTouched(sources.changed).flatMap(([dir, config, file]) => {
    const old = new Set(conflictsIn(sources.before, dir, config).map((conflict) => conflict.id));
    return conflictsIn(sources.after, dir, config)
      .filter((conflict) => !old.has(conflict.id) && !seen.has(conflict.id))
      .map((conflict): QualityFinding => {
        seen.add(conflict.id);
        const files = conflict.files.join(", ");
        return {
          rule: "duplicated_config",
          level: "block",
          file,
          line: 1,
          params: { tool: conflict.tool, key: conflict.key, files },
        };
      });
  });
};

import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { accept, type Parsed, reject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { parseYaml, type YamlValue } from "../core/yaml/parse.js";

export const OWNERSHIP_FILE = ".finitemonkey/ownership.yml";
export const CATALOG_FILE = "catalog-info.yaml";

export interface Component {
  readonly name: string;
  readonly type: string;
  readonly owner: string;
  readonly consumers: readonly string[];
}

export interface Ownership {
  readonly file: string;
  readonly components: readonly Component[];
}

type YamlMap = Readonly<Record<string, YamlValue>>;

const isMap = (value: YamlValue | undefined): value is YamlMap =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: YamlValue | undefined): string =>
  typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";

const list = (value: YamlValue | undefined): readonly string[] =>
  Array.isArray(value) ? value.map((item: YamlValue) => text(item)).filter((item) => item !== "") : [];

const componentOf = (value: YamlValue): Component | undefined =>
  isMap(value)
    ? {
        name: text(value["name"]),
        type: text(value["type"]),
        owner: text(value["owner"]),
        consumers: list(value["consumers"]),
      }
    : undefined;

export const parseOwnership = (source: string): Parsed<readonly Component[]> => {
  const parsed = parseYaml(source);
  if (!parsed.ok) return reject(`line ${String(parsed.error.line)}: ${parsed.error.message}`);
  const root = parsed.value;
  const items = isMap(root) ? root["components"] : undefined;
  if (!Array.isArray(items)) return reject("expected a components list");
  return accept(items.flatMap((item: YamlValue) => componentOf(item) ?? []));
};

const catalogComponent = (value: YamlValue): Component | undefined => {
  if (!isMap(value)) return undefined;
  const metadata = value["metadata"];
  const spec = value["spec"];
  if (!isMap(metadata)) return undefined;
  return {
    name: text(metadata["name"]),
    type: isMap(spec) ? text(spec["type"]) : "",
    owner: isMap(spec) ? text(spec["owner"]) : "",
    consumers: isMap(spec) ? list(spec["consumedBy"]) : [],
  };
};

export const parseCatalog = (source: string): Parsed<readonly Component[]> => {
  const documents = source.split(/^---\s*$/m).filter((part) => part.trim() !== "");
  const components: Component[] = [];
  for (const document of documents) {
    const parsed = parseYaml(document);
    if (!parsed.ok) return reject(`line ${String(parsed.error.line)}: ${parsed.error.message}`);
    const component = catalogComponent(parsed.value);
    if (component !== undefined) components.push(component);
  }
  return accept(components);
};

export const readOwnership = (
  runtime: Pick<Runtime, "readText">,
  root: AbsolutePath,
): Parsed<Ownership> | undefined => {
  for (const [file, parse] of [
    [OWNERSHIP_FILE, parseOwnership],
    [CATALOG_FILE, parseCatalog],
  ] as const) {
    const source = runtime.readText(toAbsolutePath(join(root, ...file.split("/"))));
    if (!source.ok) continue;
    const components = parse(source.value);
    return components.ok ? accept({ file, components: components.value }) : reject(`${file}: ${components.error}`);
  }
  return undefined;
};

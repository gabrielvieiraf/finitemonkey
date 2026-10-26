import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";

export type ConfigNode = string | readonly string[] | ConfigTree;

export interface ConfigTree {
  readonly [key: string]: ConfigNode;
}

interface MutableTree {
  [key: string]: string | string[] | MutableTree;
}

interface Frame {
  readonly indent: number;
  readonly tree: MutableTree;
  readonly key: string | undefined;
}

export const CONFIG_FILE = ".finitemonkey/config.yml";

const unquote = (value: string): string => value.trim().replace(/^(["'])(.*)\1$/s, "$2");

const stripComment = (line: string): string => {
  let quote: string | undefined;
  for (let index = 0; index < line.length; index += 1) {
    const char = line.charAt(index);
    if (quote === undefined && (char === '"' || char === "'")) quote = char;
    else if (char === quote) quote = undefined;
    else if (quote === undefined && char === "#" && (index === 0 || /\s/.test(line.charAt(index - 1)))) {
      return line.slice(0, index);
    }
  }
  return line;
};

const flowList = (value: string): string[] | undefined => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return undefined;
  return trimmed
    .slice(1, -1)
    .split(",")
    .map(unquote)
    .filter((item) => item !== "");
};

const keyValue = (body: string): { readonly key: string; readonly value: string } | undefined => {
  const match = /^("[^"]*"|'[^']*'|[^:]+?)\s*:(?:\s+(.*))?$/.exec(body);
  if (match === null) return undefined;
  return { key: unquote(match[1] ?? ""), value: match[2] ?? "" };
};

const addItem = (frame: Frame, item: string): void => {
  if (frame.key === undefined) return;
  const parent = frame.tree[frame.key];
  if (Array.isArray(parent)) parent.push(item);
  else frame.tree[frame.key] = [item];
};

const placeLine = (stack: Frame[], indent: number, body: string): void => {
  while (stack.length > 1 && (stack[stack.length - 1]?.indent ?? 0) >= indent && !body.startsWith("- ")) stack.pop();
  const top = stack[stack.length - 1];
  if (top === undefined) return;
  if (body.startsWith("- ")) {
    addItem(top, unquote(body.slice(2)));
    return;
  }
  const pair = keyValue(body);
  if (pair === undefined) return;
  const parentTree = top.key === undefined ? top.tree : ensureTree(top.tree, top.key);
  if (pair.value === "") {
    stack.push({ indent, tree: parentTree, key: pair.key });
    return;
  }
  parentTree[pair.key] = flowList(pair.value) ?? unquote(pair.value);
};

const ensureTree = (tree: MutableTree, key: string): MutableTree => {
  const existing = tree[key];
  if (existing !== undefined && typeof existing !== "string" && !Array.isArray(existing)) return existing;
  const fresh: MutableTree = {};
  tree[key] = fresh;
  return fresh;
};

export const parseConfigYaml = (text: string): ConfigTree => {
  const root: MutableTree = {};
  const stack: Frame[] = [{ indent: -1, tree: root, key: undefined }];
  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw).trimEnd();
    if (line.trim() === "" || line.trim() === "---") continue;
    const indent = line.length - line.trimStart().length;
    placeLine(stack, indent, line.trim());
  }
  return root;
};

const isTree = (node: ConfigNode | undefined): node is ConfigTree => typeof node === "object" && !Array.isArray(node);

export const configAt = (tree: ConfigTree, ...path: readonly string[]): ConfigNode | undefined =>
  path.reduce<ConfigNode | undefined>((node, key) => (isTree(node) ? node[key] : undefined), tree);

export const configList = (tree: ConfigTree, ...path: readonly string[]): readonly string[] => {
  const node = configAt(tree, ...path);
  if (typeof node === "string") return node === "" ? [] : [node];
  return Array.isArray(node) ? node.filter((item): item is string => typeof item === "string") : [];
};

export const configMap = (tree: ConfigTree, ...path: readonly string[]): Readonly<Record<string, string>> => {
  const node = configAt(tree, ...path);
  if (!isTree(node)) return {};
  return Object.fromEntries(
    Object.entries(node).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
};

export const loadProjectConfig = (runtime: Runtime, root: AbsolutePath): ConfigTree => {
  const text = runtime.readText(toAbsolutePath(join(root, CONFIG_FILE)));
  return text.ok ? parseConfigYaml(text.value) : {};
};

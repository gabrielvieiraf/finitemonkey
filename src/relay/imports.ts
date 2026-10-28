const JS_IMPORT = /(?:^|\s)import\s+(?:[\w*{}\s,]+\s+from\s+)?["']([^"'\n]+)["']|require\(\s*["']([^"'\n]+)["']\s*\)/g;
const PY_IMPORT = /^[ \t]*(?:from\s+([A-Za-z_][\w.]*)\s+import\s|import\s+([A-Za-z_][\w.]*)[ \t]*(?:$|,|\s+as\s))/gm;

const NODE_BUILTINS = new Set([
  "assert",
  "buffer",
  "child_process",
  "crypto",
  "dns",
  "events",
  "fs",
  "http",
  "https",
  "net",
  "os",
  "path",
  "process",
  "querystring",
  "readline",
  "stream",
  "string_decoder",
  "timers",
  "tls",
  "url",
  "util",
  "worker_threads",
  "zlib",
]);

const PYTHON_STDLIB = new Set([
  "abc",
  "argparse",
  "asyncio",
  "base64",
  "collections",
  "contextlib",
  "csv",
  "dataclasses",
  "datetime",
  "decimal",
  "enum",
  "functools",
  "glob",
  "hashlib",
  "http",
  "io",
  "itertools",
  "json",
  "logging",
  "math",
  "os",
  "pathlib",
  "random",
  "re",
  "shutil",
  "socket",
  "sqlite3",
  "string",
  "subprocess",
  "sys",
  "tempfile",
  "threading",
  "time",
  "typing",
  "unittest",
  "urllib",
  "uuid",
  "__future__",
]);

export interface ImportedPackage {
  readonly name: string;
  readonly language: "js" | "python";
}

const jsPackage = (specifier: string): string | undefined => {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("node:")) return undefined;
  const parts = specifier.split("/");
  const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? "");
  return name === "" || NODE_BUILTINS.has(name) ? undefined : name;
};

const pyPackage = (module: string): string | undefined => {
  const name = module.split(".")[0] ?? "";
  return name === "" || PYTHON_STDLIB.has(name) ? undefined : name;
};

export const importedPackages = (text: string): readonly ImportedPackage[] => {
  const found = new Map<string, ImportedPackage>();
  for (const match of text.matchAll(JS_IMPORT)) {
    const name = jsPackage(match[1] ?? match[2] ?? "");
    if (name !== undefined) found.set(`js:${name}`, { name, language: "js" });
  }
  for (const match of text.matchAll(PY_IMPORT)) {
    const name = pyPackage(match[1] ?? match[2] ?? "");
    if (name !== undefined) found.set(`python:${name}`, { name, language: "python" });
  }
  return [...found.values()];
};

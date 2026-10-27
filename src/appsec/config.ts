import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { parseYaml, type YamlValue } from "../core/yaml/parse.js";
import type { ScanContext } from "./types.js";

export const ROUTES_PUBLIC_FILE = ".finitemonkey/routes-public.yml";
export const APPSEC_CONFIG_FILE = ".finitemonkey/appsec.yml";

export const DEFAULT_GUARDS = [
  "requireAuth",
  "requireUser",
  "requireSession",
  "ensureAuth",
  "ensureAuthenticated",
  "isAuthenticated",
  "authenticate",
  "withAuth",
  "getServerSession",
  "getSession",
  "currentUser",
  "getCurrentUser",
  "verifyToken",
  "protect",
  "auth",
  "get_current_user",
  "get_current_active_user",
  "login_required",
  "permission_required",
  "LoginRequiredMixin",
  "UseGuards",
] as const;

const strings = (value: YamlValue | undefined): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const readYaml = (runtime: Pick<Runtime, "readText">, root: AbsolutePath, file: string): YamlValue | undefined => {
  const text = runtime.readText(toAbsolutePath(file, root));
  if (!text.ok) return undefined;
  const parsed = parseYaml(text.value);
  return parsed.ok ? parsed.value : undefined;
};

export const publicRoutes = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): ReadonlySet<string> => {
  const tree = readYaml(runtime, root, ROUTES_PUBLIC_FILE);
  const list = isRecord(tree) ? tree["routes"] : tree;
  if (!Array.isArray(list)) return new Set();
  return new Set(
    list.flatMap((item: YamlValue) => {
      if (!isRecord(item)) return [];
      const route = item["route"] ?? item["file"];
      const reason = item["reason"];
      return typeof route === "string" && typeof reason === "string" && reason.trim() !== "" ? [route] : [];
    }),
  );
};

const EXPORTED_GUARD =
  /export\s+(?:async\s+)?(?:function|const)\s+((?:require|ensure|with|check|verify|assert)[A-Z]\w*(?:Auth|User|Session|Owner|Role|Admin)\w*)/g;

export const discoveredGuards = (texts: readonly string[]): readonly string[] =>
  [...new Set(texts.flatMap((text) => [...text.matchAll(EXPORTED_GUARD)].map((match) => match[1] ?? "")))].sort();

export const scanContext = (
  runtime: Pick<Runtime, "readText">,
  root: AbsolutePath,
  discovered: readonly string[] = [],
): ScanContext => {
  const config = readYaml(runtime, root, APPSEC_CONFIG_FILE);
  const configured = isRecord(config) ? strings(config["guards"]) : [];
  return {
    guards: [...new Set([...configured, ...DEFAULT_GUARDS, ...discovered])],
    publicRoutes: publicRoutes(runtime, root),
  };
};

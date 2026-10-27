import type { AbsolutePath } from "../core/brand.js";
import { toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { stableFindingId } from "../findings/baseline.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import { discoveredGuards, scanContext } from "./config.js";
import { scanRules } from "./rules.js";
import { APPSEC_CHECK, type AppsecFinding, RULE_OWASP, type ScanContext } from "./types.js";

const SOURCE = /\.(?:[cm]?[jt]sx?|py)$/;
const SKIPPED = /(?:^|\/)(?:node_modules|dist|build|\.next|vendor|\.finitemonkey|coverage)\//;
const TEST = /(?:^|\/)(?:tests?|__tests__|spec|fixtures)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)test_[^/]*\.py$/;

export const isAppsecSource = (file: string): boolean => SOURCE.test(file) && !SKIPPED.test(file) && !TEST.test(file);

const normalized = (text: string): string => text.trim().replace(/\s+/g, " ");

export const scanText = (file: string, text: string, ctx: ScanContext): readonly AppsecFinding[] => {
  const all = text.split("\n");
  return scanRules(file, text, ctx).map((hit) => {
    const fingerprint = sha256Hex(`${hit.rule}\u0000${normalized(all[hit.line - 1] ?? "")}`).slice(0, 16);
    return {
      id: stableFindingId(APPSEC_CHECK, hit.rule, file, fingerprint),
      check: APPSEC_CHECK,
      rule: hit.rule,
      owasp: RULE_OWASP[hit.rule],
      file,
      line: hit.line,
      fingerprint,
      detail: hit.detail,
    };
  });
};

type ScanRuntime = Pick<Runtime, "git" | "readText">;

export const sourceFiles = (runtime: ScanRuntime, root: AbsolutePath): readonly string[] => {
  const listed = runtime.git(["ls-files", "--cached", "--others", "--exclude-standard"], root);
  return listed.found && listed.ok ? listed.stdout.split("\n").filter(isAppsecSource) : [];
};

const readAll = (runtime: ScanRuntime, root: AbsolutePath, files: readonly string[]): readonly [string, string][] =>
  files.flatMap((file): [string, string][] => {
    const text = runtime.readText(toAbsolutePath(file, root));
    return text.ok ? [[file, text.value]] : [];
  });

export const contextFor = (runtime: ScanRuntime, root: AbsolutePath): ScanContext => {
  const texts = readAll(runtime, root, sourceFiles(runtime, root)).map(([, text]) => text);
  return scanContext(runtime, root, discoveredGuards(texts));
};

export const scanFiles = (
  runtime: ScanRuntime,
  root: AbsolutePath,
  files: readonly string[],
  ctx: ScanContext = contextFor(runtime, root),
): readonly AppsecFinding[] =>
  readAll(runtime, root, [...files].filter(isAppsecSource).sort()).flatMap(([file, text]) => scanText(file, text, ctx));

export const scanRepo = (runtime: ScanRuntime, root: AbsolutePath): readonly AppsecFinding[] =>
  scanFiles(runtime, root, sourceFiles(runtime, root));

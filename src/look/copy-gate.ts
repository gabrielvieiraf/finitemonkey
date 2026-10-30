import { loadRegistry } from "../apicontract/load.js";
import { toAbsolutePath } from "../core/brand.js";
import type { Note } from "../evidence/types.js";
import type { GateContext } from "../gate/types.js";
import { configAt, configList, loadProjectConfig } from "../git/project-config.js";
import { featureMode } from "../policy/feature.js";
import {
  type CopyLedger,
  DEFAULT_MIN_SHOWN,
  rateOf,
  readCopyLedger,
  ruleActive,
  updateLedger,
  writeCopyLedger,
} from "./copy-ledger.js";
import { bindingKeys, oneNameFindings, type SourceText } from "./copy-names.js";
import {
  BUTTON_KEYS,
  catalogEntries,
  type CatalogEntry,
  COPY_RULES,
  type CopyFinding,
  type CopyRule,
  ERROR_KEYS,
  labelFindings,
  UI_COPY_FEATURE,
} from "./copy-rules.js";

const MAX_LISTED = 10;
const MAX_SOURCES = 2000;
const SOURCE = /\.(?:[cm]?[jt]sx?|vue|svelte)$/;
const SKIP = /(?:^|\/)(?:node_modules|dist|build|coverage|\.next)\//;

export interface CopyRulesOutcome {
  readonly notes: readonly Note[];
  readonly blocking: boolean;
}

interface CopySettings {
  readonly allow: readonly string[];
  readonly threshold: number | undefined;
  readonly minShown: number;
}

const note = (key: string, params: Note["params"] = {}): Note => ({ key, params });

const numberAt = (raw: unknown): number | undefined => {
  const parsed = typeof raw === "string" ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};

const settingsOf = (ctx: GateContext): CopySettings => {
  const tree = loadProjectConfig(ctx.runtime, ctx.paths.root);
  const threshold = numberAt(configAt(tree, "ui", "copy", "accept_threshold"));
  const minShown = numberAt(configAt(tree, "ui", "copy", "min_shown"));
  return {
    allow: configList(tree, "ui", "copy", "allow"),
    threshold: threshold !== undefined && threshold > 0 && threshold <= 1 ? threshold : undefined,
    minShown: minShown !== undefined && minShown >= 1 ? Math.round(minShown) : DEFAULT_MIN_SHOWN,
  };
};

const read = (ctx: GateContext, file: string): string | undefined => {
  const text = ctx.runtime.readText(toAbsolutePath(file, ctx.paths.root));
  return text.ok ? text.value : undefined;
};

const sourcesOf = (ctx: GateContext, files: readonly string[], catalogs: readonly string[]): readonly SourceText[] =>
  files
    .filter((file) => SOURCE.test(file) && !SKIP.test(file) && !catalogs.includes(file))
    .slice(0, MAX_SOURCES)
    .flatMap((file) => {
      const text = read(ctx, file);
      return text === undefined ? [] : [{ file, text }];
    });

const operationsOf = (ctx: GateContext): readonly string[] => {
  const loaded = loadRegistry(ctx.runtime, ctx.paths.root);
  return loaded.kind === "ok" ? loaded.registry.endpoints.map((endpoint) => endpoint.id) : [];
};

const currentText =
  (entries: readonly CatalogEntry[], bindings: ReadonlyMap<string, ReadonlySet<string>>, allow: readonly string[]) =>
  (rule: CopyRule, id: string): string | undefined => {
    if (rule === "one-name") {
      const keys = bindings.get(id);
      if (keys === undefined) return undefined;
      return [...keys].map((key) => `"${entries.find((entry) => entry.key === key)?.text ?? ""}"`).join(" / ");
    }
    const entry = entries.find((item) => `${item.file}#${item.key}` === id);
    return entry === undefined || allow.includes(entry.key) || allow.includes(entry.text) ? undefined : entry.text;
  };

const findingNote = (finding: CopyFinding): Note =>
  note(`gate.copy.rule.${finding.rule}`, {
    file: finding.file,
    key: finding.key,
    text: finding.text,
    detail: finding.detail,
  });

const rateNotes = (ledger: CopyLedger, rules: readonly CopyRule[]): readonly Note[] =>
  rules.map((rule) => {
    const rate = rateOf(ledger[rule]);
    return note("gate.copy.rate", { rule, accepted: rate.accepted, shown: rate.shown });
  });

export const copyRulesOutcome = (
  ctx: GateContext,
  files: readonly string[],
  catalogs: readonly string[],
): CopyRulesOutcome => {
  const mode = featureMode(ctx.runtime, ctx.paths, UI_COPY_FEATURE);
  if (mode === "off") return { notes: [], blocking: false };
  const settings = settingsOf(ctx);
  const entries = catalogs.flatMap((file) => {
    const text = read(ctx, file);
    return text === undefined ? [] : catalogEntries(file, text);
  });
  const bindings = bindingKeys(sourcesOf(ctx, files, catalogs), operationsOf(ctx));
  const findings = [
    ...labelFindings(entries, { allow: settings.allow, buttonKeys: BUTTON_KEYS, errorKeys: ERROR_KEYS }),
    ...oneNameFindings(bindings, entries, settings.allow),
  ];
  const ledger = updateLedger(
    readCopyLedger(ctx.runtime, ctx.paths),
    findings,
    currentText(entries, bindings, settings.allow),
  );
  writeCopyLedger(ctx.runtime, ctx.paths, ledger);
  if (findings.length === 0) return { notes: [], blocking: false };
  const active = COPY_RULES.filter(
    (rule) => mode === "active" && ruleActive(rateOf(ledger[rule]), settings.threshold, settings.minShown),
  );
  const fired = COPY_RULES.filter((rule) => findings.some((finding) => finding.rule === rule));
  const blocking = findings.filter((finding) => active.includes(finding.rule));
  const shadow = findings.filter((finding) => !active.includes(finding.rule));
  const listed = [...blocking, ...shadow].slice(0, MAX_LISTED).map(findingNote);
  return {
    notes: [
      ...(shadow.length === 0 ? [] : [note("gate.copy.rules_shadow", { count: shadow.length })]),
      ...listed,
      ...rateNotes(ledger, fired),
    ],
    blocking: blocking.length > 0,
  };
};

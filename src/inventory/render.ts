import type { Translate } from "../i18n/translate.js";
import { code, section, table } from "../plan/markdown.js";
import type { Hit, Inventory, RepoRead } from "./types.js";

const MAX_LISTED = 40;

const capped = (t: Translate, lines: readonly string[]): readonly string[] =>
  lines.length > MAX_LISTED
    ? [...lines.slice(0, MAX_LISTED), `- ${t("inventory.more", { count: lines.length - MAX_LISTED })}`]
    : lines;

const listed = (t: Translate, lines: readonly string[]): readonly string[] =>
  lines.length === 0 ? [t("inventory.none")] : capped(t, lines);

const hitLines = (t: Translate, hits: readonly Hit[]): readonly string[] =>
  listed(
    t,
    hits.map((hit) => `- ${code(`${hit.file}:${String(hit.line)}`)} ${code(hit.text)}`),
  );

const prefix = (repo: RepoRead, many: boolean): string => (many ? `${repo.path}: ` : "");

const riskRows = (t: Translate, repos: readonly RepoRead[]): readonly (readonly string[])[] =>
  repos.flatMap((repo) =>
    repo.credentials.map((hit) => [
      t("inventory.risk.credential", { rule: hit.rule }),
      t("inventory.risk.yes"),
      code(`${prefix(repo, repos.length > 1)}${hit.at}`),
      t("inventory.risk.fix_credential"),
    ]),
  );

const codeSections = (t: Translate, repo: RepoRead): readonly string[] => [
  ...section(
    t("inventory.modules"),
    listed(
      t,
      repo.modules.map((item) => `- ${code(item.path)}: ${t("inventory.files", { count: item.files })}`),
    ),
  ),
  ...section(t("inventory.routes"), hitLines(t, repo.routes)),
  ...section(t("inventory.tables"), hitLines(t, repo.tables)),
  ...section(t("inventory.queues"), hitLines(t, repo.queues)),
  ...section(t("inventory.jobs"), hitLines(t, repo.jobs)),
  ...section(
    t("inventory.env"),
    listed(
      t,
      repo.env.map((item) => `- ${code(item.name)}: ${item.at.map(code).join(", ")}`),
    ),
  ),
  ...section(
    t("inventory.dependencies"),
    listed(
      t,
      repo.dependencies.map((item) => `- ${code(item.name)} ${item.version}: ${code(item.at)}`),
    ),
  ),
  ...section(t("inventory.tests"), [
    t("inventory.test_count", { count: repo.tests.length }),
    ...capped(
      t,
      repo.tests.map((file) => `- ${code(file)}`),
    ),
  ]),
];

const optional = (heading: string, lines: readonly string[]): readonly string[] =>
  lines.length === 0 ? [] : section(heading, lines);

const whenPresent = (t: Translate, repo: RepoRead, incidents: readonly string[]): readonly string[] => [
  ...optional(
    t("inventory.credentials"),
    repo.credentials.length === 0
      ? []
      : [t("inventory.credentials_note"), "", ...repo.credentials.map((hit) => `- ${code(hit.at)} (${hit.rule})`)],
  ),
  ...optional(
    t("inventory.deploy"),
    repo.deploy.map((file) => `- ${code(file)}`),
  ),
  ...optional(
    t("inventory.history"),
    incidents.map((name) => `- ${code(`.finitemonkey/incidents/${name}`)}`),
  ),
  ...optional(
    t("inventory.worktrees"),
    repo.worktrees.map((path) => `- ${code(path)}`),
  ),
  ...optional(
    t("inventory.hotspots"),
    repo.hotspots.map((item) => `- ${code(item.path)}: ${t("inventory.changes", { count: item.changes })}`),
  ),
];

const repoBlock = (t: Translate, inventory: Inventory, repo: RepoRead): readonly string[] => [
  ...(inventory.repos.length > 1 ? [`# ${code(repo.path)}`, ""] : []),
  ...codeSections(t, repo),
  ...whenPresent(t, repo, repo.path === "." ? inventory.incidents : []),
];

const header = (t: Translate, inventory: Inventory): readonly string[] => [
  `# ${t("inventory.title", { topic: inventory.topic })}`,
  "",
  ...inventory.repos.map((repo) =>
    t("inventory.read_at", { path: repo.path, hash: repo.hash, date: inventory.date, ref: repo.ref }),
  ),
  "",
];

const deltaBlock = (t: Translate, inventory: Inventory): readonly string[] =>
  inventory.previousHash === undefined
    ? []
    : section(
        t("inventory.delta", { hash: inventory.previousHash }),
        listed(
          t,
          inventory.delta.map((line) => `- ${code(line)}`),
        ),
      );

export const renderInventory = (t: Translate, inventory: Inventory): string =>
  [
    ...header(t, inventory),
    ...section(
      t("inventory.risks"),
      table(
        [t("inventory.col.risk"), t("inventory.col.still"), t("inventory.col.evidence"), t("inventory.col.fix")],
        riskRows(t, inventory.repos),
      ),
    ),
    ...section(
      t("inventory.gap"),
      table([t("inventory.col.plan"), t("inventory.col.today"), t("inventory.col.effect")], []),
    ),
    ...deltaBlock(t, inventory),
    ...inventory.repos.flatMap((repo) => repoBlock(t, inventory, repo)),
  ].join("\n");

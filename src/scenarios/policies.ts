export interface Column {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly references: string | undefined;
  readonly referencesColumn: string;
}

const COMMANDS = ["all", "select", "insert", "update", "delete"] as const;

export type PolicyCommand = (typeof COMMANDS)[number];

export interface Policy {
  readonly name: string;
  readonly table: string;
  readonly command: PolicyCommand;
  readonly using: string;
}

export interface Table {
  readonly name: string;
  readonly columns: readonly Column[];
  readonly rls: boolean;
  readonly policies: readonly Policy[];
}

export const OWNER_COLUMNS = [
  "user_id",
  "owner_id",
  "tenant_id",
  "account_id",
  "org_id",
  "organization_id",
  "created_by",
  "author_id",
] as const;

const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_][\w$]*)`;
const QUALIFIED = String.raw`(${IDENT}(?:\s*\.\s*${IDENT})?)`;
const CREATE_TABLE = new RegExp(
  String.raw`^create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?${QUALIFIED}\s*\(`,
  "i",
);
const RLS = new RegExp(
  String.raw`^alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?${QUALIFIED}\s+(enable|disable)\s+row\s+level\s+security`,
  "i",
);
const CREATE_POLICY = new RegExp(String.raw`^create\s+policy\s+(${IDENT})\s+on\s+${QUALIFIED}([\s\S]*)$`, "i");
const DROP_POLICY = new RegExp(String.raw`^drop\s+policy\s+(?:if\s+exists\s+)?(${IDENT})\s+on\s+${QUALIFIED}`, "i");
const FOR = /\bfor\s+(all|select|insert|update|delete)\b/i;
const CONSTRAINT = /^(?:constraint|primary\s+key|foreign\s+key|unique|check|exclude)\b/i;
const REFERENCES = new RegExp(String.raw`\breferences\s+${QUALIFIED}\s*(?:\(\s*(${IDENT})\s*\))?`, "i");

const unquote = (name: string): string => name.replace(/"/g, "").replace(/\s+/g, "");

export const tableName = (name: string): string => {
  const plain = unquote(name).toLowerCase();
  return plain.startsWith("public.") ? plain.slice(7) : plain;
};

const stripComments = (sql: string): string =>
  sql
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "''")
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

export const statements = (sql: string): readonly string[] => {
  const out: string[] = [];
  let current = "";
  let quote: string | undefined;
  for (const char of stripComments(sql)) {
    if (quote === undefined && char === ";") {
      out.push(current.trim());
      current = "";
      continue;
    }
    if (char === "'" || char === '"') quote = quote === char ? undefined : (quote ?? char);
    current += char;
  }
  return [...out, current.trim()].filter((item) => item !== "");
};

const topLevel = (body: string): readonly string[] => {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of body) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  return [...parts, current.trim()].filter((item) => item !== "");
};

const columnOf = (definition: string): Column | undefined => {
  if (CONSTRAINT.test(definition)) return undefined;
  const match = new RegExp(String.raw`^(${IDENT})\s+([A-Za-z_][\w ]*?(?:\([^)]*\))?(?:\[\])?)(?=\s|$)`).exec(
    definition,
  );
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  const rest = definition.slice(match[0].length);
  const generated = /\b(?:default|generated|serial|bigserial|identity)\b/i.test(`${match[2]} ${rest}`);
  const referenced = REFERENCES.exec(rest);
  const reference = referenced?.[1];
  return {
    name: unquote(match[1]).toLowerCase(),
    type: match[2].trim().toLowerCase(),
    required: /\b(?:not\s+null|primary\s+key)\b/i.test(rest) && !generated,
    references: reference === undefined ? undefined : tableName(reference),
    referencesColumn: unquote(referenced?.[2] ?? "id").toLowerCase(),
  };
};

const bodyOf = (statement: string, open: number): string => {
  let depth = 0;
  for (let index = open; index < statement.length; index += 1) {
    if (statement[index] === "(") depth += 1;
    if (statement[index] === ")") depth -= 1;
    if (depth === 0) return statement.slice(open + 1, index);
  }
  return statement.slice(open + 1);
};

const policyOf = (match: RegExpExecArray): Policy => {
  const rest = match[3] ?? "";
  const using =
    /\busing\s*\(([\s\S]*?)\)\s*(?:with\s+check|$)/i.exec(rest)?.[1] ?? /\busing\s*\(([\s\S]*)\)/i.exec(rest)?.[1];
  const word = FOR.exec(rest)?.[1]?.toLowerCase();
  const command = COMMANDS.find((item) => item === word) ?? "all";
  return { name: unquote(match[1] ?? ""), table: tableName(match[2] ?? ""), command, using: (using ?? "").trim() };
};

interface Draft {
  columns: readonly Column[];
  rls: boolean;
  policies: Policy[];
}

const apply = (tables: Map<string, Draft>, statement: string): void => {
  const create = CREATE_TABLE.exec(statement);
  if (create !== null) {
    const name = tableName(create[1] ?? "");
    const columns = topLevel(bodyOf(statement, create[0].length - 1)).flatMap((part) => columnOf(part) ?? []);
    tables.set(name, { columns, rls: tables.get(name)?.rls ?? false, policies: tables.get(name)?.policies ?? [] });
    return;
  }
  const rls = RLS.exec(statement);
  const target = (name: string): Draft | undefined => tables.get(tableName(name));
  if (rls !== null) {
    const table = target(rls[1] ?? "");
    if (table !== undefined) table.rls = rls[2]?.toLowerCase() === "enable";
    return;
  }
  const policy = CREATE_POLICY.exec(statement);
  if (policy !== null) {
    target(policy[2] ?? "")?.policies.push(policyOf(policy));
    return;
  }
  const drop = DROP_POLICY.exec(statement);
  const table = drop === null ? undefined : target(drop[2] ?? "");
  if (drop !== null && table !== undefined)
    table.policies = table.policies.filter((item) => item.name !== unquote(drop[1] ?? ""));
};

export const parseMigrations = (sources: readonly string[]): readonly Table[] => {
  const tables = new Map<string, Draft>();
  for (const source of sources) for (const statement of statements(source)) apply(tables, statement);
  return [...tables.entries()].map(([name, draft]) => ({ name, ...draft, policies: [...draft.policies] }));
};

export const ownerColumn = (table: Table, names: readonly string[]): Column | undefined =>
  table.columns.find((column) => names.includes(column.name)) ??
  table.columns.find((column) => column.references?.startsWith("auth.users") === true);

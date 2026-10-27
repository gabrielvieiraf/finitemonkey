export type SchemaKind = "prisma" | "drizzle" | "sqlalchemy";

export interface SchemaField {
  readonly model: string;
  readonly field: string;
  readonly file: string;
  readonly line: number;
  readonly kind: SchemaKind;
}

const lineAt = (text: string, index: number): number => text.slice(0, index).split("\n").length;

const PRISMA_MODEL = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
const PRISMA_FIELD = /^[ \t]+(\w+)[ \t]+[A-Z]\w*(?:\[\])?\??/gm;

const prismaFields = (file: string, text: string): readonly SchemaField[] =>
  [...text.matchAll(PRISMA_MODEL)].flatMap((model) => {
    const body = model[2] ?? "";
    const offset = model.index + model[0].indexOf(body);
    return [...body.matchAll(PRISMA_FIELD)].map((field) => ({
      model: model[1] ?? "",
      field: field[1] ?? "",
      file,
      line: lineAt(text, offset + field.index),
      kind: "prisma" as const,
    }));
  });

const DRIZZLE_TABLE = /(?:pg|mysql|sqlite)Table\(\s*["'`](\w+)["'`]\s*,\s*\{/g;
const OBJECT_KEY = /^[ \t]*(\w+)\s*:/gm;

const objectBody = (text: string, start: number): string => {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return text.slice(start + 1, index);
  }
  return text.slice(start + 1);
};

const topLevelKeys = (body: string): readonly { readonly name: string; readonly index: number }[] => {
  const keys: { name: string; index: number }[] = [];
  let depth = 0;
  for (const match of body.matchAll(OBJECT_KEY)) {
    const before = body.slice(keys.length === 0 ? 0 : (keys.at(-1)?.index ?? 0), match.index);
    depth += (before.match(/[({[]/g) ?? []).length - (before.match(/[)}\]]/g) ?? []).length;
    if (depth <= 0) keys.push({ name: match[1] ?? "", index: match.index });
  }
  return keys;
};

const drizzleFields = (file: string, text: string): readonly SchemaField[] =>
  [...text.matchAll(DRIZZLE_TABLE)].flatMap((table) => {
    const open = table.index + table[0].length - 1;
    return topLevelKeys(objectBody(text, open)).map((key) => ({
      model: table[1] ?? "",
      field: key.name,
      file,
      line: lineAt(text, open + 1 + key.index),
      kind: "drizzle" as const,
    }));
  });

const SA_CLASS = /^class\s+(\w+)\([^)]*\):\s*\n((?:[ \t]+.*\n?|\s*\n)*)/gm;
const SA_COLUMN = /^[ \t]+(\w+)\s*(?::\s*Mapped\[[^\]]*\]\s*)?=\s*(?:Column|mapped_column|db\.Column)\(/gm;

const sqlalchemyFields = (file: string, text: string): readonly SchemaField[] =>
  [...text.matchAll(SA_CLASS)].flatMap((cls) => {
    const body = cls[2] ?? "";
    const table = /__tablename__\s*=\s*["'](\w+)["']/.exec(body)?.[1] ?? cls[1] ?? "";
    const offset = cls.index + cls[0].indexOf(body);
    return [...body.matchAll(SA_COLUMN)].map((column) => ({
      model: table,
      field: column[1] ?? "",
      file,
      line: lineAt(text, offset + column.index),
      kind: "sqlalchemy" as const,
    }));
  });

export const schemaFieldsIn = (file: string, text: string): readonly SchemaField[] => {
  if (file.endsWith(".prisma")) return prismaFields(file, text);
  if (/\.[cm]?[jt]s$/.test(file) && /(?:pg|mysql|sqlite)Table\(/.test(text)) return drizzleFields(file, text);
  if (file.endsWith(".py") && /(?:Column|mapped_column)\(/.test(text)) return sqlalchemyFields(file, text);
  return [];
};

export const isSchemaCandidate = (file: string): boolean =>
  file.endsWith(".prisma") ||
  /(?:^|\/)(?:schema|models?|db|tables?)[^/]*\.(?:[cm]?[jt]s|py)$|(?:^|\/)(?:schema|models|db)\//.test(file);

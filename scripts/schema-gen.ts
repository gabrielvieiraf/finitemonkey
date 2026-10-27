import { join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

export interface SchemaSource {
  readonly name: string;
  readonly file: string;
  readonly type: string;
  readonly describes: string;
}

export type JsonSchema = Readonly<Record<string, unknown>>;

export const SCHEMA_DIR = "docs/schema";

export const SCHEMA_SOURCES: readonly SchemaSource[] = [
  {
    name: "envelope@1",
    file: "src/core/result.ts",
    type: "Envelope",
    describes: "Every `--json` output: the envelope around the command data.",
  },
  {
    name: "doctor@1",
    file: "src/commands/doctor.ts",
    type: "DoctorData",
    describes: "`data` of `finitemonkey doctor --json`.",
  },
  {
    name: "gate@1",
    file: "src/gate/report.ts",
    type: "GateReport",
    describes: "`data` of `finitemonkey gate --json`.",
  },
  {
    name: "merge-verify@1",
    file: "src/git/merge/verify.ts",
    type: "VerifyReport",
    describes: "Report of one merge checked by `finitemonkey merge verify`.",
  },
  {
    name: "secrets-scan@1",
    file: "src/commands/secrets-scan.ts",
    type: "SecretsScanData",
    describes: "`data` of `finitemonkey secrets scan --json`.",
  },
  {
    name: "prose-check@1",
    file: "src/commands/prose-view.ts",
    type: "ProseCheckData",
    describes: "`data` of `finitemonkey prose check --json`.",
  },
  {
    name: "app-check@1",
    file: "src/commands/app-check.ts",
    type: "AppCheckData",
    describes: "`data` of `finitemonkey app check --json`.",
  },
  {
    name: "look@1",
    file: "src/commands/look.ts",
    type: "LookData",
    describes: "`data` of `finitemonkey look --json`.",
  },
  {
    name: "uninstall-plan@1",
    file: "src/commands/uninstall.ts",
    type: "UninstallData",
    describes: "`data` of `finitemonkey uninstall --json`.",
  },
  {
    name: "evidence@1",
    file: "src/evidence/types.ts",
    type: "Evidence",
    describes: "One line of `.finitemonkey/evidence/<task>.jsonl`.",
  },
];

export const ROOT = fileURLToPath(new URL("..", import.meta.url));

const DRAFT = "https://json-schema.org/draft/2020-12/schema";
const ID_BASE = "https://github.com/gabrielvieiraf/finitemonkey/blob/main/docs/schema/";
const MAX_DEPTH = 12;

const literalOf =
  (checker: ts.TypeChecker) =>
  (type: ts.Type): string | number | boolean | undefined => {
    if (type.isStringLiteral() || type.isNumberLiteral()) return type.value;
    if (type.flags & ts.TypeFlags.BooleanLiteral) return checker.typeToString(type) === "true";
    return undefined;
  };

const primitiveName = (type: ts.Type): string | undefined => {
  if (type.flags & ts.TypeFlags.StringLike) return "string";
  if (type.flags & ts.TypeFlags.NumberLike) return "number";
  if (type.flags & ts.TypeFlags.BooleanLike) return "boolean";
  if (type.flags & ts.TypeFlags.Null) return "null";
  return undefined;
};

const isUndefined = (type: ts.Type): boolean => (type.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)) !== 0;

class Walker {
  private readonly literal: (type: ts.Type) => string | number | boolean | undefined;

  constructor(private readonly checker: ts.TypeChecker) {
    this.literal = literalOf(checker);
  }

  convert(type: ts.Type, depth: number): JsonSchema {
    if (depth > MAX_DEPTH) throw new Error(`type nests deeper than ${String(MAX_DEPTH)} levels`);
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return {};
    if (type.flags & ts.TypeFlags.Boolean) return { type: "boolean" };
    if (type.isUnion())
      return this.union(
        type.types.filter((member) => !isUndefined(member)),
        depth,
      );
    const literal = this.literal(type);
    if (literal !== undefined) return { const: literal };
    if (type.isIntersection()) {
      const primitive = type.types.map(primitiveName).find((name) => name !== undefined);
      if (primitive !== undefined) return { type: primitive };
    }
    const primitive = primitiveName(type);
    if (primitive !== undefined) return { type: primitive };
    if (this.checker.isArrayType(type) || this.checker.isTupleType(type)) {
      const element = this.checker.getIndexTypeOfType(type, ts.IndexKind.Number);
      return { type: "array", items: element === undefined ? {} : this.convert(element, depth + 1) };
    }
    if (type.flags & ts.TypeFlags.Object) return this.object(type, depth);
    throw new Error(`cannot describe type ${this.checker.typeToString(type)}`);
  }

  private union(members: readonly ts.Type[], depth: number): JsonSchema {
    const [single] = members;
    if (members.length === 1 && single !== undefined) return this.convert(single, depth);
    const literals = members.map(this.literal);
    const kinds = new Set(literals.map((value) => typeof value));
    if (literals.every((value) => value !== undefined) && kinds.size === 1 && !kinds.has("boolean")) {
      return { type: kinds.has("string") ? "string" : "number", enum: literals };
    }
    const booleans = members.filter((member) => member.flags & ts.TypeFlags.BooleanLiteral);
    const rest = members.filter((member) => !(member.flags & ts.TypeFlags.BooleanLiteral));
    const parts = [...(booleans.length === 2 ? [{ type: "boolean" }] : booleans.map((b) => this.convert(b, depth)))];
    return { anyOf: [...parts, ...rest.map((member) => this.convert(member, depth + 1))] };
  }

  private object(type: ts.Type, depth: number): JsonSchema {
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const symbol of this.checker.getPropertiesOfType(type)) {
      const propType = this.checker.getTypeOfSymbol(symbol);
      const optional =
        (symbol.flags & ts.SymbolFlags.Optional) !== 0 || (propType.isUnion() && propType.types.some(isUndefined));
      properties[symbol.name] = this.convert(propType, depth + 1);
      if (!optional) required.push(symbol.name);
    }
    const index = this.checker.getIndexInfosOfType(type).find((info) => info.keyType.flags & ts.TypeFlags.String);
    return {
      type: "object",
      ...(Object.keys(properties).length > 0 ? { properties } : {}),
      ...(required.length > 0 ? { required } : {}),
      ...(index === undefined ? {} : { additionalProperties: this.convert(index.type, depth + 1) }),
    };
  }
}

const exportedType = (checker: ts.TypeChecker, file: ts.SourceFile, name: string): ts.Type => {
  const module = checker.getSymbolAtLocation(file);
  const symbol = module === undefined ? undefined : checker.getExportsOfModule(module).find((s) => s.name === name);
  if (symbol === undefined) throw new Error(`${file.fileName} does not export ${name}`);
  return checker.getDeclaredTypeOfSymbol(symbol);
};

const compilerOptions = (root: string): ts.CompilerOptions => {
  const path = join(root, "tsconfig.json");
  const read = ts.readConfigFile(path, (file) => ts.sys.readFile(file));
  return ts.parseJsonConfigFileContent(read.config, ts.sys, root).options;
};

const schemaConst = (schema: JsonSchema): unknown => {
  const properties = schema["properties"];
  if (typeof properties !== "object" || properties === null || !("schema" in properties)) return undefined;
  const inner: unknown = properties.schema;
  return typeof inner === "object" && inner !== null && "const" in inner ? inner.const : undefined;
};

const describe = (source: SchemaSource, body: JsonSchema): JsonSchema => {
  const declared = schemaConst(body);
  if (declared !== undefined && declared !== `finitemonkey/${source.name}`) {
    throw new Error(`${source.type} declares schema ${JSON.stringify(declared)}, registry says ${source.name}`);
  }
  return {
    $schema: DRAFT,
    $id: `${ID_BASE}${source.name}.json`,
    title: `finitemonkey/${source.name}`,
    description: `${source.describes} Generated from ${source.type} in ${source.file} by scripts/build-schemas.ts. Within a version, fields are only added.`,
    ...body,
  };
};

export const generateSchemas = (
  root: string = ROOT,
  sources: readonly SchemaSource[] = SCHEMA_SOURCES,
): ReadonlyMap<string, string> => {
  const program = ts.createProgram(
    sources.map((source) => join(root, source.file)),
    compilerOptions(root),
  );
  const checker = program.getTypeChecker();
  const walker = new Walker(checker);
  const out = new Map<string, string>();
  for (const source of sources) {
    const file = program.getSourceFile(join(root, source.file));
    if (file === undefined) throw new Error(`cannot read ${source.file}`);
    const schema = describe(source, walker.convert(exportedType(checker, file, source.type), 0));
    out.set(`${SCHEMA_DIR}/${source.name}.json`, `${JSON.stringify(schema, null, 2)}\n`);
  }
  return out;
};

export const staleSchemas = (
  fresh: ReadonlyMap<string, string>,
  committed: readonly string[],
  read: (path: string) => string,
): readonly string[] => [
  ...[...fresh].filter(([path, text]) => read(path) !== text).map(([path]) => `${path} is out of date with its type`),
  ...committed.filter((path) => !fresh.has(path)).map((path) => `${path} has no source in scripts/schema-gen.ts`),
];

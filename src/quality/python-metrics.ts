import { isRecord, parseJson } from "../core/parsed.js";
import type { DetectorSources } from "./detector-sources.js";
import type { QualityLimits } from "./limits.js";
import type { FileMetrics, FunctionMetric } from "./metrics.js";
import { compareFile, type QualityFinding } from "./ratchet.js";

export const PYTHON_METRICS_SCRIPT = [
  "import ast, json, sys",
  "FUNCS = (ast.FunctionDef, ast.AsyncFunctionDef)",
  "SKIP = FUNCS + (ast.ClassDef, ast.Lambda)",
  "NEST = tuple(t for t in (ast.For, ast.AsyncFor, ast.While, ast.ExceptHandler, ast.IfExp, getattr(ast, 'Match', None)) if t)",
  "def walk_if(node, depth, acc):",
  "    visit(node.test, depth, acc)",
  "    block(node.body, depth + 1, acc)",
  "    rest = node.orelse",
  "    if len(rest) == 1 and isinstance(rest[0], ast.If):",
  "        acc[0] += 1",
  "        walk_if(rest[0], depth, acc)",
  "    elif rest:",
  "        acc[0] += 1",
  "        block(rest, depth + 1, acc)",
  "def block(nodes, depth, acc):",
  "    for item in nodes:",
  "        visit(item, depth, acc)",
  "def visit(node, depth, acc):",
  "    if isinstance(node, SKIP):",
  "        return",
  "    if isinstance(node, ast.If) or isinstance(node, NEST):",
  "        acc[0] += 1 + depth",
  "        acc[1] = max(acc[1], depth + 1)",
  "        if isinstance(node, ast.If):",
  "            return walk_if(node, depth, acc)",
  "        return block(list(ast.iter_child_nodes(node)), depth + 1, acc)",
  "    if isinstance(node, ast.BoolOp):",
  "        acc[0] += 1",
  "    block(list(ast.iter_child_nodes(node)), depth, acc)",
  "def params(args):",
  "    names = list(getattr(args, 'posonlyargs', [])) + list(args.args)",
  "    count = len(names) + len(args.kwonlyargs) + (1 if args.vararg else 0) + (1 if args.kwarg else 0)",
  "    return count - 1 if names and names[0].arg in ('self', 'cls') else count",
  "def collect(node, scope, seen, out):",
  "    for child in ast.iter_child_nodes(node):",
  "        if isinstance(child, FUNCS):",
  "            scoped = child.name if not scope else scope + '>' + child.name",
  "            seen[scoped] = seen.get(scoped, 0) + 1",
  "            key = scoped if seen[scoped] == 1 else scoped + '#' + str(seen[scoped])",
  "            acc = [0, 0]",
  "            block(child.body, 0, acc)",
  "            end = getattr(child, 'end_lineno', None) or child.lineno",
  "            out.append({'key': key, 'name': child.name, 'line': child.lineno, 'lines': end - child.lineno + 1, 'params': params(child.args), 'cognitive': acc[0], 'nesting': acc[1]})",
  "            collect(child, scoped, seen, out)",
  "        elif isinstance(child, ast.ClassDef):",
  "            collect(child, child.name if not scope else scope + '>' + child.name, seen, out)",
  "        else:",
  "            collect(child, scope, seen, out)",
  "try:",
  "    tree = ast.parse(sys.stdin.read())",
  "except SyntaxError:",
  "    print('null')",
  "    sys.exit(0)",
  "found = []",
  "collect(tree, '', {}, found)",
  "print(json.dumps(found))",
].join("\n");

const NUMBERS = ["line", "lines", "params", "cognitive", "nesting"] as const;

export const parsePythonMetrics = (stdout: string): readonly FunctionMetric[] | undefined => {
  const parsed = parseJson(stdout.trim());
  if (!parsed.ok || !Array.isArray(parsed.value)) return undefined;
  const items: unknown[] = parsed.value;
  return items.flatMap((item): FunctionMetric[] => {
    if (!isRecord(item) || typeof item["key"] !== "string" || typeof item["name"] !== "string") return [];
    const numbers = NUMBERS.map((field) => item[field]);
    if (!numbers.every((value) => typeof value === "number")) return [];
    const [line = 0, lines = 0, params = 0, cognitive = 0, nesting = 0] = numbers.map(Number);
    return [
      { key: item["key"], name: item["name"], line, lines, params, cognitive, nesting, chain: 0, identifiers: 0 },
    ];
  });
};

const asFile = (functions: readonly FunctionMetric[]): FileMetrics => ({
  lines: 0,
  functions,
  nestedTernaries: [],
  exports: [],
});

export interface PythonFindings {
  readonly findings: readonly QualityFinding[];
  readonly skipped: boolean;
}

export const pythonFindings = (
  sources: DetectorSources,
  touched: readonly string[],
  limits: QualityLimits,
): PythonFindings => {
  let skipped = false;
  const findings = touched
    .filter((file) => file.endsWith(".py"))
    .flatMap((file) => {
      const text = sources.after(file);
      const after = text === undefined ? undefined : sources.python(text);
      if (after === undefined) {
        skipped ||= text !== undefined;
        return [];
      }
      const old = sources.before(file);
      const before = old === undefined ? undefined : sources.python(old);
      return compareFile(file, before === undefined ? undefined : asFile(before), asFile(after), limits);
    });
  return { findings, skipped };
};

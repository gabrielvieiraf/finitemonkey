import * as nodeModule from "node:module";
import { extname } from "node:path";
import { Script } from "node:vm";

export interface SyntaxProblem {
  readonly line: number;
  readonly message: string;
}

export const SYNTAX_MAX_BYTES = 256 * 1024;

const SCRIPT_EXTENSIONS = new Set([".js", ".cjs", ".mjs"]);
const TYPESCRIPT_EXTENSIONS = new Set([".ts", ".mts", ".cts"]);
const MODULE_ONLY =
  /import statement outside a module|Unexpected token 'export'|import\.meta|await is only valid|Cannot use import/;

const MAX_MESSAGE = 200;

const oneLine = (message: string): string => message.replace(/\s+/g, " ").trim().slice(0, MAX_MESSAGE);

const lineAt = (text: string, offset: number): number => text.slice(0, offset).split("\n").length;

const jsonProblem = (text: string): SyntaxProblem | undefined => {
  try {
    JSON.parse(text);
    return undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const position = /position (\d+)/.exec(message)?.[1];
    const line = /line (\d+)/.exec(message)?.[1];
    return {
      line: line !== undefined ? Number(line) : position !== undefined ? lineAt(text, Number(position)) : 0,
      message: oneLine(message),
    };
  }
};

const scriptProblem = (file: string, text: string): SyntaxProblem | undefined => {
  try {
    new Script(text, { filename: file });
    return undefined;
  } catch (error) {
    if (!(error instanceof SyntaxError) || MODULE_ONLY.test(error.message)) return undefined;
    const line = new RegExp(`${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:(\\d+)`).exec(error.stack ?? "")?.[1];
    return { line: line === undefined ? 0 : Number(line), message: oneLine(error.message) };
  }
};

type Strip = (code: string) => string;

const stripper = (): Strip | undefined => {
  const candidate: unknown = Reflect.get(nodeModule, "stripTypeScriptTypes");
  if (typeof candidate !== "function") return undefined;
  return (code) => {
    const quiet = process.emitWarning.bind(process);
    process.emitWarning = () => undefined;
    try {
      const out: unknown = Reflect.apply(candidate, undefined, [code]);
      return typeof out === "string" ? out : code;
    } finally {
      process.emitWarning = quiet;
    }
  };
};

const typescriptProblem = (file: string, text: string, strip: Strip | undefined): SyntaxProblem | undefined => {
  if (strip === undefined) return undefined;
  try {
    return scriptProblem(file, strip(text));
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ERR_INVALID_TYPESCRIPT_SYNTAX") {
      return undefined;
    }
    return { line: 0, message: oneLine(error.message) };
  }
};

export const syntaxProblem = (
  file: string,
  text: string,
  strip: Strip | undefined = stripper(),
): SyntaxProblem | undefined => {
  if (Buffer.byteLength(text, "utf8") > SYNTAX_MAX_BYTES) return undefined;
  const extension = extname(file).toLowerCase();
  if (extension === ".json") return jsonProblem(text);
  if (SCRIPT_EXTENSIONS.has(extension)) return scriptProblem(file, text);
  if (TYPESCRIPT_EXTENSIONS.has(extension)) return typescriptProblem(file, text, strip);
  return undefined;
};

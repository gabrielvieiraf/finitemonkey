import { maskText } from "../mask/mask.js";

const ERROR_LINE =
  /\b(?:error|errors|fail|failed|failure|exception|panic|fatal|traceback|cannot|denied|refused|not found|undefined reference)\b|✗|✖|\bnot ok\b/i;
const MAX_ERRORS = 8;
const MAX_LINE = 300;
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g");

const clean = (line: string): string => line.replace(ANSI, "").trim();

export const errorLines = (output: string, exitCode: number): readonly string[] => {
  if (exitCode === 0) return [];
  const lines = output
    .split(/\r?\n/)
    .map(clean)
    .filter((line) => line !== "");
  const matching = [...new Set(lines.filter((line) => ERROR_LINE.test(line)))];
  const chosen = matching.length > 0 ? matching.slice(-MAX_ERRORS) : lines.slice(-3);
  return chosen.map((line) => `ERROR ${maskText(line).slice(0, MAX_LINE)}`);
};

export const fullLog = (command: string, exitCode: number, stdout: string, stderr: string): string =>
  maskText(
    [
      `$ ${command}`,
      `exit ${String(exitCode)}`,
      "",
      "--- stdout ---",
      stdout.trimEnd(),
      "",
      "--- stderr ---",
      stderr.trimEnd(),
      "",
    ].join("\n"),
  );

import { stripHidden } from "../policy/untrusted.js";

const INSTRUCTION =
  /(?:^|[.!?:]\s+|^\s*(?:[-*+]|\d+[.)])\s+)(?:always|never|ignore|disregard|forget|override|run|execute|install|curl|wget|you must|you should|do not|don't|please run|sempre|nunca|ignore|execute|rode|siempre|ignora|ejecuta)\b/i;

const MEMORY_DIR = /[\\/]\.claude[\\/]projects[\\/][^\\/]+[\\/]memory[\\/][^\\/]+$/;

export const isNativeMemory = (file: string): boolean => MEMORY_DIR.test(file);

export const instructionLines = (text: string): readonly string[] =>
  stripHidden(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && INSTRUCTION.test(line));

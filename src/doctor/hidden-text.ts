import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { hiddenChars } from "../policy/untrusted.js";
import { type Check, finding } from "./types.js";

const FILES = ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md", "AGENTS.md", ".finitemonkey/learnings.jsonl"];
const RULES_DIR = ".claude/rules";
const MAX_LISTED = 8;

export const checkHiddenText: Check = ({ root, runtime }) => {
  const rules = runtime.listDir(toAbsolutePath(join(root, RULES_DIR)));
  const files = [
    ...FILES,
    ...(rules.ok ? rules.value.filter((name) => name.endsWith(".md")).map((name) => `${RULES_DIR}/${name}`) : []),
  ];
  const found = files.flatMap((file) => {
    const text = runtime.readText(toAbsolutePath(join(root, file)));
    return text.ok ? hiddenChars(text.value).map((item) => `${file}:${String(item.line)} ${item.code}`) : [];
  });
  if (found.length === 0) return [];
  const list = found.slice(0, MAX_LISTED).join(", ") + (found.length > MAX_LISTED ? " …" : "");
  return [finding("instructions.hidden_text", "fail", "doctor.hidden.found", { list }, "doctor.hidden.fix")];
};

import { hasMarker } from "./config-template.js";
import { isScript, type Runner } from "./hook-entries.js";
import { GENERATED_MARKER, LOCAL_BIN, VENDOR_BIN } from "./layout.js";

const gateCommand = (runner: Runner): string => {
  const args = "gate --fast --json";
  if (runner.kind === "local") return `node ${LOCAL_BIN} ${args}`;
  if (runner.kind === "vendored") return `node ${VENDOR_BIN} ${args}`;
  return isScript(runner.path) ? `node "${runner.path}" ${args}` : `"${runner.path}" ${args}`;
};

export const verifySkillTemplate = (runner: Runner): string =>
  [
    "---",
    "name: verify",
    "description: >-",
    "  Use before every commit and before telling the person something works. Runs the fast gate through Finite Monkey so the result is recorded as evidence for the current tree instead of being taken on your word.",
    "when_to_use: >-",
    "  Trigger phrases include commit, run the tests, check it works, roda os testes, confere, verifica, prueba.",
    "---",
    "",
    "# Verify: evidence, not claims",
    "",
    `1. From the project root, run \`${gateCommand(runner)}\`.`,
    "2. Read `data`; for every failing item, fix the cause, never the check.",
    "3. Quote the command and its exit code when you report a result. A result from before your last edit no longer counts.",
    "",
    `<!-- ${GENERATED_MARKER} -->`,
    "",
  ].join("\n");

export const isOwnSkill = hasMarker;

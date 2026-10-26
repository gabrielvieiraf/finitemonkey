import type { GeneratedTemplates } from "./types.js";

export const en: GeneratedTemplates = {
  configHeader: "Finite Monkey project settings. Commit this file. `finitemonkey update` keeps your edits.",
  verifySkill: {
    description:
      "Use before every commit and before telling the person something works. Runs the fast gate through Finite Monkey so the result is recorded as evidence for the current tree instead of being taken on your word.",
    whenToUse:
      "Trigger phrases include commit, run the tests, check it works, roda os testes, confere, verifica, prueba.",
    title: "Verify: evidence, not claims",
    steps: (command) => [
      `From the project root, run \`${command}\`.`,
      "Read `data`; for every failing item, fix the cause, never the check.",
      "Quote the command and its exit code when you report a result. A result from before your last edit no longer counts.",
    ],
  },
};

import type { GeneratedTemplates } from "./types.js";

export const en: GeneratedTemplates = {
  configHeader: "Finite Monkey project settings. Commit this file. `finitemonkey update` keeps your edits.",
  policyHeader: [
    "Guard policy for this project. Modes: off, shadow (record what it would block), active.",
    "The guards for secrets, production, lost git work and false done stay active whatever this file says.",
    "A guard missing from this list starts in shadow and is promoted after promoteAfter firings without a false positive.",
  ],
  agentsBlock: ({ gate, doctor }) => [
    "## Finite Monkey",
    "",
    `- Before saying a task is done, and before each commit, run \`${gate}\` and fix what fails. Never weaken, skip or delete a check to make it pass.`,
    "- When a hook blocks an action, read its reason and fix the cause instead of working around it.",
    `- If something in the setup looks wrong, run \`${doctor}\` and report what it says.`,
  ],
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

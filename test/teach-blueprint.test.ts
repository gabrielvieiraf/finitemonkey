import assert from "node:assert/strict";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { blueprintFirst } from "../src/teach/blueprint-first.js";
import { hook, type TempRepo, tempRepo, write } from "./git-support.js";
import { trustContract } from "./trusted-contract.js";

const CONTRACT =
  "id: hooks\ngoal: refund webhook\nacceptance:\n  - id: C1\n    check: command\n    run: node --version\n";

const repos: TempRepo[] = [];
after(() => {
  for (const repo of repos) repo.dispose();
});

const profile = (knowledge: number): string =>
  `domains:\n  backend:\n    tool: ${String(knowledge)}\n    knowledge: ${String(knowledge)}\nquick_start: done\n`;

const project = (knowledge: number, guards = "guards:\n  teach-back: active\n"): TempRepo => {
  const repo = tempRepo({ "README.md": "app\n" });
  repos.push(repo);
  write(repo.root, ".finitemonkey/policy.yml", guards);
  write(repo.root, ".finitemonkey/perfil.yml", profile(knowledge));
  trustContract(repo.root, "hooks", CONTRACT);
  return repo;
};

const edit = (repo: TempRepo): ReturnType<typeof hook> =>
  hook(blueprintFirst, "PreToolUse", repo.root, {
    tool_name: "Edit",
    tool_input: {
      file_path: join(repo.root, "src/webhooks/stripe.js"),
      old_string: "",
      new_string: "export const handle = (req) => req.body;",
    },
  });

describe("blueprint before the first edit in a domain at the start of the profile", () => {
  it("prompts once for a task without a blueprint, then lets the edit through", async () => {
    const repo = project(10);
    const first = await edit(repo);
    assert.ok(first.kind === "block");
    assert.match(first.reason, /planta/);
    assert.match(first.reason, /once per task/);
    assert.equal((await edit(repo)).kind, "allow");
  });

  it("stays quiet in a domain further along the profile and without the opt-in", async () => {
    assert.equal((await edit(project(80))).kind, "allow");
    assert.equal((await edit(project(10, "guards:\n  predict-gate: off\n"))).kind, "allow");
  });
});

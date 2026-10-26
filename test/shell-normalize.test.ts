import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeCommand } from "../src/shell/normalize.js";
import type { Dialect } from "../src/shell/types.js";

interface Case {
  readonly input: string;
  readonly dialect?: Dialect;
  readonly expected: readonly (readonly string[])[];
}

const CASES: readonly Case[] = [
  {
    input: "git status && git push --force origin main",
    expected: [
      ["git", "status"],
      ["git", "push", "--force", "origin", "main"],
    ],
  },
  { input: 'HUSKY=0 git commit -m "x; y"', expected: [["git", "commit", "-m", "x; y"]] },
  { input: "sh -c 'git reset --hard HEAD~1'", expected: [["git", "reset", "--hard", "HEAD~1"]] },
  {
    input: 'bash -lc "cd sub && git clean -fd"',
    expected: [
      ["cd", "sub"],
      ["git", "clean", "-fd"],
    ],
  },
  { input: "sudo -u bob env FOO=1 nohup git push -f", expected: [["git", "push", "-f"]] },
  { input: "command git -C ../other stash drop", expected: [["git", "-C", "../other", "stash", "drop"]] },
  {
    input: "(cd x; git checkout -- .)",
    expected: [
      ["cd", "x"],
      ["git", "checkout", "--", "."],
    ],
  },
  { input: 'echo "git push --force"', expected: [["echo", "git push --force"]] },
  { input: "time git gc --prune=now", expected: [["git", "gc", "--prune=now"]] },
  { input: "git log | grep foo || true", expected: [["git", "log"], ["grep", "foo"], ["true"]] },
  { input: "exec builtin git branch -D topic", expected: [["git", "branch", "-D", "topic"]] },
  { input: "/usr/bin/git push --mirror", expected: [["git", "push", "--mirror"]] },
  { input: "git commit -m 'it'\\''s fine'", expected: [["git", "commit", "-m", "it's fine"]] },
  { input: "git push\\\n  --force", expected: [["git", "push", "--force"]] },
  {
    input: "Remove-Item -Recurse -Force C:\\repo\\wt; git push --force",
    dialect: "powershell",
    expected: [
      ["remove-item", "-Recurse", "-Force", "C:\\repo\\wt"],
      ["git", "push", "--force"],
    ],
  },
  { input: 'cmd /c "git reset --hard"', dialect: "powershell", expected: [["git", "reset", "--hard"]] },
];

describe("shell normalizer", () => {
  for (const item of CASES) {
    it(`${item.dialect ?? "bash"}: ${item.input}`, () => {
      const commands = normalizeCommand(item.input, item.dialect).commands.map((command) => [
        command.program,
        ...command.args,
      ]);
      assert.deepEqual(commands, item.expected);
    });
  }

  it("keeps the directory of a cd for the commands after it", () => {
    const commands = normalizeCommand("cd sub && git clean -fd").commands;
    assert.equal(commands[1]?.dir, "sub");
  });

  it("records env prefixes and wrappers", () => {
    const [command] = normalizeCommand("sudo env HUSKY=0 git push -f").commands;
    assert.ok(command);
    assert.deepEqual(command.env, { HUSKY: "0" });
    assert.deepEqual(command.via, ["sudo", "env"]);
  });

  it("marks a program built from a substitution as dynamic", () => {
    const commands = normalizeCommand("$(echo git) push -f").commands;
    assert.equal(commands.at(-1)?.dynamic, true);
  });
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { defaultShell, invocationFor, powershellLine } from "../src/runlog/shell.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { SAMPLES } from "./secret-samples.js";
import { cli, field, parseBody } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const repo = (files: Readonly<Record<string, string>> = {}): Repo => {
  const made = makeRepo({ "README.md": "# app\n", ...files });
  repos.push(made);
  return made;
};

const options = (target: Repo) => ({ cwd: target.root, runtime: repoRuntime(), platform: process.platform });

const logs = (target: Repo): readonly string[] =>
  readdirSync(join(target.root, ".finitemonkey", "runs")).map((name) =>
    readFileSync(join(target.root, ".finitemonkey", "runs", name), "utf8"),
  );

describe("finitemonkey run: exit code", () => {
  it("returns the command's own exit code and the path of the full output", async () => {
    const target = repo({ "fail.js": "console.error('Error: database is locked');\nprocess.exitCode = 3;\n" });
    const result = await cli(["run", "--", "node", "fail.js"], options(target));
    assert.equal(result.code, 3);
    assert.match(result.stdout, /^ERROR Error: database is locked$/m);
    assert.match(result.stdout, /exit 3 in \d+ ms; full output: \.finitemonkey\/runs\/.+\.log/);
  });

  it("returns 0 with no ERROR lines when the command passes", async () => {
    const target = repo({ "ok.js": "console.log('0 failed, 12 passed');\n" });
    const result = await cli(["--json", "run", "--", "node", "ok.js"], options(target));
    assert.equal(result.code, 0);
    const body = parseBody(result.stdout);
    assert.deepEqual(field(body, "data", "errors"), []);
    assert.equal(field(body, "data", "exitCode"), 0);
    assert.equal(field(body, "data", "schema"), "finitemonkey/run@1");
  });

  it("keeps the whole output in the file and only a few lines in the summary", async () => {
    const target = repo({
      "noisy.js":
        "for (let i = 0; i < 5000; i++) console.log(`line ${i} of build output`);\nconsole.error('error TS2304: Cannot find name Pix');\nprocess.exitCode = 2;\n",
    });
    const result = await cli(["run", "--", "node", "noisy.js"], options(target));
    assert.equal(result.code, 2);
    assert.ok(result.stdout.split("\n").length < 10, result.stdout);
    assert.match(result.stdout, /ERROR error TS2304: Cannot find name Pix/);
    assert.match(logs(target)[0] ?? "", /line 4999 of build output/);
  });
});

describe("finitemonkey run: masking", () => {
  it("masks secrets in the file and in the summary", async () => {
    const target = repo({
      "leak.js": `console.log('Error: bad token ${SAMPLES.githubPat}');\nprocess.exitCode = 1;\n`,
    });
    const result = await cli(["run", "--", "node", "leak.js"], options(target));
    assert.equal(result.code, 1);
    assert.ok(!result.stdout.includes(SAMPLES.githubPat));
    assert.match(result.stdout, /ERROR Error: bad token/);
    const file = logs(target)[0] ?? "";
    assert.match(file, /bad token/);
    assert.ok(!file.includes(SAMPLES.githubPat));
  });
});

const hasPwsh = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"]).status === 0;

describe("finitemonkey run: PowerShell", () => {
  it("defaults to PowerShell on Windows and sh elsewhere", () => {
    assert.equal(defaultShell("win32"), "powershell");
    assert.equal(defaultShell("linux"), "sh");
    assert.deepEqual(invocationFor("powershell", ["Get-ChildItem; exit 4"]), {
      command: "powershell",
      args: ["-NoProfile", "-NonInteractive", "-Command", powershellLine("Get-ChildItem; exit 4")],
      shell: false,
    });
  });

  it("passes a native command's exit code through PowerShell", () => {
    const line = powershellLine("node fail.js");
    assert.match(line, /^\$global:LASTEXITCODE = \$null; node fail\.js; /);
    assert.match(line, /if \(\$null -ne \$LASTEXITCODE\) \{ exit \$LASTEXITCODE \}/);
    assert.match(line, /if \(-not \$fmOk\) \{ exit 1 \}$/);
  });

  it(
    "runs a PowerShell command and keeps its exit code",
    { skip: process.platform !== "win32" && !hasPwsh },
    async () => {
      const target = repo();
      const shell = process.platform === "win32" ? [] : ["--shell", "pwsh"];
      const script = "Write-Output 'starting'; [Console]::Error.WriteLine('Error: migration failed'); exit 4";
      const result = await cli(["run", ...shell, "--", script], options(target));
      assert.equal(result.code, 4, result.stdout + result.stderr);
      assert.match(result.stdout, /ERROR Error: migration failed/);
      assert.match(logs(target)[0] ?? "", /starting/);
    },
  );
});

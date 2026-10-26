import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { checkAgentsFile } from "../src/doctor/memory.js";
import { ExitCode } from "../src/exit-codes.js";
import { MARKDOWN_MARKERS, withAgentsImport } from "../src/install/agents-block.js";
import { CONFIG_FILE } from "../src/install/layout.js";
import { at, repo, ROOT, run } from "./install-support.js";
import { fakeRuntime, TEST_VERSION } from "./support.js";

const blockOf = (text: string): string => {
  const start = text.indexOf(MARKDOWN_MARKERS.begin);
  return start < 0 ? "" : text.slice(start);
};

describe("init writes a managed block in AGENTS.md and imports it from CLAUDE.md", () => {
  const originals = [
    { name: "LF with a final newline", text: "# Rules\n\nUse tabs.\n" },
    { name: "no final newline", text: "# Rules\n\nUse tabs." },
    { name: "CRLF", text: "# Rules\r\n\r\nUse tabs.\r\n" },
  ];
  for (const { name, text } of originals) {
    it(`keeps every byte outside the block (${name}) and uninstall restores the file`, async () => {
      const fs = repo({ "AGENTS.md": text });
      assert.equal((await run(fs, ["init", "--yes"])).code, ExitCode.Ok);
      const after = fs.read(at("AGENTS.md")) ?? "";
      assert.ok(after.startsWith(text), "content before the block changed");
      assert.match(blockOf(after), /gate --fast --json/);
      assert.equal((await run(fs, ["uninstall", "--yes", "--purge"])).code, ExitCode.Ok);
      assert.equal(fs.read(at("AGENTS.md")), text);
    });
  }

  it("uninstall takes the block out even after the person edited the file around it", async () => {
    const fs = repo({ "AGENTS.md": "# Rules\n" });
    await run(fs, ["init", "--yes"]);
    const installed = fs.read(at("AGENTS.md")) ?? "";
    fs.writeAtomic(toAbsolutePath(at("AGENTS.md")), `# Team rules\n${installed.slice("# Rules\n".length)}More.\n`);
    await run(fs, ["uninstall", "--yes", "--purge"]);
    assert.equal(fs.read(at("AGENTS.md")), "# Team rules\nMore.\n");
  });

  it("creates both files when absent and removes them on uninstall", async () => {
    const fs = repo();
    await run(fs, ["init", "--yes"]);
    assert.match(
      fs.read(at("CLAUDE.md")) ?? "",
      /^<!-- finitemonkey:begin v=1 -->\n@AGENTS\.md\n<!-- finitemonkey:end -->\n$/,
    );
    assert.ok((fs.read(at("AGENTS.md")) ?? "").startsWith(MARKDOWN_MARKERS.begin));
    await run(fs, ["uninstall", "--yes", "--purge"]);
    assert.equal(fs.read(at("AGENTS.md")), undefined);
    assert.equal(fs.read(at("CLAUDE.md")), undefined);
  });

  it("leaves a CLAUDE.md that already imports AGENTS.md as it is", async () => {
    const claude = "# Claude\n\n@AGENTS.md\n";
    assert.equal(withAgentsImport(claude), claude);
    const fs = repo({ "CLAUDE.md": claude });
    await run(fs, ["init", "--yes"]);
    assert.equal(fs.read(at("CLAUDE.md")), claude);
    assert.equal(
      withAgentsImport("# Claude\n"),
      "# Claude\n<!-- finitemonkey:begin v=1 -->\n@AGENTS.md\n<!-- finitemonkey:end -->\n",
    );
  });

  it("writes the block in the project language", async () => {
    const fs = repo();
    await run(fs, ["init", "--yes", "--lang", "pt-BR"]);
    assert.match(fs.read(at("AGENTS.md")) ?? "", /Antes de dizer que uma tarefa está pronta/);
  });
});

describe("doctor checks the AGENTS.md line ceiling", () => {
  const doctor = (files: Readonly<Record<string, string>>) =>
    checkAgentsFile({
      platform: "linux",
      env: {},
      cwd: ROOT,
      root: ROOT,
      version: TEST_VERSION,
      runtime: fakeRuntime({ files }),
    });
  const lines = (count: number): string =>
    `${Array.from({ length: count }, (_, index) => `line ${String(index)}`).join("\n")}\n`;

  it("reports the line count and the restart note at or under the ceiling", () => {
    const findings = doctor({ [at("AGENTS.md")]: lines(60) });
    assert.deepEqual(
      findings.map((finding) => [finding.status, finding.params]),
      [["ok", { file: "AGENTS.md", lines: 60, max: 60 }]],
    );
  });

  it("fails above the ceiling and honors memory.maxLines", () => {
    assert.equal(doctor({ [at("AGENTS.md")]: lines(61) })[0]?.status, "fail");
    const raised = doctor({ [at("AGENTS.md")]: lines(61), [at(CONFIG_FILE)]: "memory:\n  maxLines: 80\n" });
    assert.equal(raised[0]?.status, "ok");
  });

  it("says nothing when the project has no AGENTS.md", () => {
    assert.deepEqual(doctor({}), []);
  });
});

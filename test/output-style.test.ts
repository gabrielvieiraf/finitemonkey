import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { ROOT } from "./support.js";

const STYLE = join(ROOT, "plugin", "output-styles", "report.md");

const frontmatter = (text: string): Readonly<Record<string, string>> => {
  const head = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
  return Object.fromEntries(
    head.split("\n").flatMap((line) => {
      const match = /^([\w-]+):\s*(.*)$/.exec(line);
      return match === null ? [] : [[match[1] ?? "", match[2] ?? ""]];
    }),
  );
};

describe("report output style", () => {
  it("sets keep-coding-instructions: true so the engineering instructions stay", () => {
    const fields = frontmatter(readFileSync(STYLE, "utf8"));
    assert.equal(fields["keep-coding-instructions"], "true");
    assert.equal(fields["name"], "report");
    assert.match(fields["description"] ?? "", /Off unless chosen/);
  });

  it("asks for the result first, the three lists, the claim marks, absolute dates, file:line and no secret values", () => {
    const body = readFileSync(STYLE, "utf8");
    for (const part of [
      "First sentence: the result",
      "Verified:",
      "Not verified:",
      "Pending:",
      "`FACT`",
      "`OPINION`",
      "`INFERENCE`",
      "absolute",
      "path/file.ts:42",
      "Secrets never by value",
    ]) {
      assert.ok(body.includes(part), part);
    }
  });

  it("is documented as optional in the three READMEs", () => {
    const expected: Readonly<Record<string, RegExp>> = {
      "README.md": /`report` output style\*\* is optional and off by default/,
      "README.pt-BR.md": /estilo de saída `report`\*\* é opcional e vem desligado/,
      "README.es.md": /estilo de salida `report`\*\* es opcional y viene apagado/,
    };
    for (const [file, pattern] of Object.entries(expected)) {
      const text = readFileSync(join(ROOT, file), "utf8");
      assert.match(text, pattern, file);
      assert.match(text, /keep-coding-instructions: true/, file);
    }
  });
});

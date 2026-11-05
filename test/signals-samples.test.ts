import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { errorSignature } from "../src/signals/signature.js";

const sampleOf = (output: string): string | undefined => errorSignature(output)?.sample;

describe("signals: the error sample is the failing line, never passing output", () => {
  const failures = [
    [
      "Exit code 1\n  ✔ never keeps PreToolUse past its own deadline (203.960623ms)\n✔ a slow git (206.819271ms)\n" +
        "(eval):19: == not found",
      "(eval):19: == not found",
    ],
    [
      "Exit code 1\nok\n(eval):1: no matches found: /home/ana/*monkey*\n/home/gabriel/finitemonkey\n" +
        "(eval):1: no matches found: /home/ana/code/*monkey*",
      "(eval):1: no matches found: /home/ana/*monkey*",
    ],
    [
      '88:    "sea": "tsx scripts/sea-build.ts",\nsea=1\nbuild the binary with Node.js 24, this is Node.js 26.1.0\n' +
        "(eval):1: no matches found: build/sea/finitemonkey*",
      "(eval):1: no matches found: build/sea/finitemonkey*",
    ],
    [
      "Exit code 1\ntypecheck=0\nlint=0\ncheck:dist=0\ni18n:check=0\nplugin:validate=0\nschema:check=0\ndocs:check=0",
      "Exit code 1",
    ],
    ["Exit code 1\nsrc/mod/labels.ts\n?? .finitemonkey/git/\n?? src/mod/labels.ts", "Exit code 1"],
    ["Exit code 1\n#455\n#456\n\n[exited with code 1]\n#455\n#456", "Exit code 1"],
    ["Exit code 1\n(eval):1: parse error near `>'", "(eval):1: parse error near `>'"],
    [
      "tail: cannot open '/tmp/claude-1000/st.txt' for reading: No such file or directory",
      "tail: cannot open '/tmp/claude-1000/st.txt' for reading: No such file or directory",
    ],
    [
      "File does not exist. Note: your current working directory is /home/ana/project.",
      "File does not exist. Note: your current working directory is /home/ana/project.",
    ],
    [
      "EISDIR: illegal operation on a directory, read '/home/ana/project/docs'",
      "EISDIR: illegal operation on a directory, read '/home/ana/project/docs'",
    ],
  ] as const;
  for (const [output, sample] of failures) {
    it(`keeps ${JSON.stringify(sample)}`, () => {
      assert.equal(sampleOf(output), sample);
    });
  }

  it("never picks a passing test line, a status report, git status or a bare path as the sample", () => {
    const samples = failures.map(([output]) => sampleOf(output));
    for (const junk of [
      "✔ never keeps PreToolUse past its own deadline (203.960623ms)",
      "schema:check=0",
      "?? src/mod/labels.ts",
      "/home/gabriel/finitemonkey",
      "sea=1",
      "[exited with code 1]",
    ])
      assert.equal(samples.includes(junk), false, junk);
  });

  it("gives no signature to a failure that printed only its exit status", () => {
    assert.equal(errorSignature("Exit code 144"), undefined);
    assert.equal(errorSignature("Exit code 1\n\n[exited with code 1]"), undefined);
  });

  it("gives the same failure the same signature and different silent failures different ones", () => {
    const run = "Exit code 1\n✔ a (1ms)\n(eval):19: == not found";
    assert.equal(errorSignature(run)?.sig, errorSignature(run.replace("1ms", "4ms"))?.sig);
    const one = errorSignature("Exit code 1\ntypecheck=0\nlint=0");
    const two = errorSignature("Exit code 1\n?? src/a.ts");
    assert.notEqual(one?.sig, two?.sig);
  });
});

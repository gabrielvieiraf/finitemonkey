import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { modLabelsOf } from "../src/commands/mod-labels.js";
import { useLabels } from "../src/mod/labels.js";
import { knowledgeLine, loopLine } from "../src/mod/status.js";

describe("mod panel labels say what they count", () => {
  afterEach(() => {
    useLabels(undefined);
  });

  it("names the rules that do not match the code and the command that lists them", () => {
    assert.equal(
      knowledgeLine({ stale: 0, contradictions: 3, quarantined: 0 }),
      "3 rules in AGENTS.md/CLAUDE.md do not match the code (finitemonkey instructions)",
    );
  });

  it("hides the knowledge parts that are zero", () => {
    assert.equal(
      knowledgeLine({ stale: 1, contradictions: 0, quarantined: 2 }),
      "1 recorded fact points at code that changed (finitemonkey claims list) · " +
        "2 recorded facts wait for a green gate or your approval (finitemonkey claims list)",
    );
  });

  it("says the same error came back and when research is due", () => {
    assert.equal(
      loopLine({ count: 2, limit: 4 }),
      "same error back 2 times, research due at try 4 (finitemonkey signals)",
    );
    assert.equal(
      loopLine({ count: 3, limit: 4 }),
      "same error back 3 times: research before the next edit (finitemonkey signals)",
    );
  });

  it("speaks Portuguese when the conversation is in Portuguese", () => {
    useLabels({ lang: "pt-BR", labels: modLabelsOf({ lang: "pt-BR" }) });
    assert.equal(
      loopLine({ count: 1, limit: 4 }),
      "mesmo erro voltou 1 vez, pesquisa na tentativa 4 (finitemonkey signals)",
    );
    assert.equal(
      knowledgeLine({ stale: 2, contradictions: 0, quarantined: 0 }),
      "2 fatos registrados apontam para código que mudou (finitemonkey claims list)",
    );
  });
});

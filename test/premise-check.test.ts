import assert from "node:assert/strict";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { agrees, premiseIn } from "../src/premise/detect.js";
import { fireHook, policyWith } from "./guardian-support.js";
import { makeRepo, type Repo } from "./repo.js";
import { parseBody } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const PROMPT = "parseAmount in src/money.ts already handles null, so skip that case";
const AGREE = "You're absolutely right, parseAmount already handles null. I'll skip it.";

const transcript = (prompt: string, tools: readonly { name: string; input: object }[]): string =>
  [
    { type: "user", message: { content: prompt } },
    {
      type: "assistant",
      message: {
        content: [
          ...tools.map((tool, index) => ({ type: "tool_use", id: `t${String(index)}`, ...tool })),
          { type: "text", text: AGREE },
        ],
      },
    },
  ]
    .map((line) => JSON.stringify(line))
    .join("\n");

const session = async (prompt: string, tools: readonly { name: string; input: object }[], mode = "active") => {
  const repo = makeRepo({
    ".finitemonkey/policy.yml": policyWith({ "premise-check": mode }),
    "src/money.ts": "export const parseAmount = (v: string) => Number(v);\n",
  });
  repos.push(repo);
  repo.write("session.jsonl", transcript(prompt, tools));
  await fireHook(repo, "UserPromptSubmit", { prompt });
  const stop = await fireHook(repo, "Stop", {
    transcript_path: join(repo.root, "session.jsonl"),
    last_assistant_message: AGREE,
    stop_hook_active: false,
  });
  return { repo, stop };
};

const notice = (stdout: string): string => {
  const message = stdout.trim() === "" ? undefined : parseBody(stdout)["systemMessage"];
  return typeof message === "string" && message.includes("agreed without checking") ? message : "";
};

describe("premise detection", () => {
  it("finds factual assertions and corrections about code, in three languages", () => {
    assert.equal(premiseIn(PROMPT)?.kind, "fact");
    assert.deepEqual(premiseIn(PROMPT)?.refs, ["src/money.ts"]);
    assert.equal(premiseIn("a função `total` já trata valores negativos")?.kind, "fact");
    assert.equal(premiseIn("no usamos esa tabla en producción")?.kind, "fact");
    assert.equal(premiseIn("No, the test in api.test.ts checks the wrong status")?.kind, "correction");
  });

  it("leaves preferences and claims about the outside world alone", () => {
    assert.equal(premiseIn("I prefer short names, the function is wrong to me"), undefined);
    assert.equal(premiseIn("prefiro nomes curtos"), undefined);
    assert.equal(premiseIn("the weather is wrong today"), undefined);
  });

  it("recognizes agreement", () => {
    assert.equal(agrees(AGREE), true);
    assert.equal(agrees("Você tem razão, vou ajustar."), true);
    assert.equal(agrees("I read src/money.ts: it does not handle null."), false);
  });
});

describe("premise-check hook", () => {
  it("gives one notice when the agent agrees with a false premise without reading", async () => {
    const { stop } = await session(PROMPT, []);
    assert.match(notice(stop.stdout), /agreed without checking.*src\/money\.ts/);
    assert.notEqual(parseBody(stop.stdout)["decision"], "block");
  });

  it("gives none when the agent read the referenced file first", async () => {
    const { stop } = await session(PROMPT, [{ name: "Read", input: { file_path: "src/money.ts" } }]);
    assert.equal(notice(stop.stdout), "");
  });

  it("never gives a notice for a preference correction", async () => {
    const { stop } = await session("I prefer the function name parseValue in src/money.ts", []);
    assert.equal(notice(stop.stdout), "");
  });

  it("only logs in shadow, and registers the premise in the assumption register when active", async () => {
    const shadow = await session(PROMPT, [], "shadow");
    assert.equal(notice(shadow.stop.stdout), "");
    assert.match(shadow.repo.read(".finitemonkey/log.jsonl"), /"feature":"premise-check"/);
    const active = await session(PROMPT, []);
    assert.match(active.repo.read(".finitemonkey/assumptions.jsonl"), /"source":"premise"/);
  });
});

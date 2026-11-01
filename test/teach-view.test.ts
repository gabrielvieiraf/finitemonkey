import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Elements, ModElement } from "../src/mod/api.js";
import { parseProbeCard, parseTeachCard, parseTeachReason } from "../src/mod/teach-view.js";
import { type XrayActions, type XrayRow, xrayTree } from "../src/mod/xray-view.js";

interface Node extends ModElement {
  readonly props: Readonly<Record<string, unknown>>;
}

const node =
  (type: string) =>
  (props: object): Node => ({ type, props: props as Readonly<Record<string, unknown>> });

const elements: Elements = {
  Box: node("Box"),
  Text: node("Text"),
  Button: node("Button"),
  Code: node("Code"),
  Input: node("Input"),
};

const flatten = (element: ModElement): readonly Node[] => {
  const current = element as Node;
  const children = current.props["children"];
  const nested = Array.isArray(children)
    ? children.flatMap((child: unknown) => (typeof child === "object" && child !== null ? flatten(child as Node) : []))
    : [];
  return [current, ...nested];
};

const labels = (element: ModElement): readonly string[] =>
  flatten(element).flatMap((item) => (typeof item.props["label"] === "string" ? [item.props["label"]] : []));

const idle = (): Promise<void> => Promise.resolve();

const actions: XrayActions = {
  criterion: idle,
  leave: idle,
  skip: idle,
  predict: idle,
  know: idle,
  explain: idle,
  answerProbe: idle,
  skipProbe: idle,
  skipQuestion: idle,
  close: idle,
};

const ROW: XrayRow = {
  file: "src/webhook.ts",
  start: 10,
  end: 12,
  band: "beyond",
  coverage: "none",
  concepts: ["webhook"],
  by: "agent",
};

describe("x-ray pane teach-back", () => {
  it("offers predict, I know this and explain next to a block with a concept", () => {
    const view = { task: "refund", beyond: 1, items: [ROW] };
    const found = labels(xrayTree(elements, view, [], actions, "terminal"));
    for (const label of ["Create criterion", "Predict", "I know this", "Explain"])
      assert.ok(found.includes(label), label);
  });

  it("shows the open teach-back question and the pending probe as cards", () => {
    const teach = parseTeachCard(
      JSON.stringify({
        data: {
          schema: "finitemonkey/teach@1",
          question: { question: "t-1", concepts: ["webhook"], run: "node a.js", input: "21", answered: false },
        },
      }),
    );
    const probe = parseProbeCard(
      JSON.stringify({
        data: {
          schema: "finitemonkey/probes@1",
          probes: [
            { id: "P1", status: "open", presented: false, question: "q1", why: "w", options: [] },
            {
              id: "P2",
              status: "open",
              presented: true,
              question: "What runs first?",
              why: "the change reorders calls",
              options: [{ id: "a", text: "auth" }],
            },
          ],
        },
      }),
    );
    assert.equal(probe?.id, "P2");
    const tree = xrayTree(elements, undefined, [], actions, "terminal", { teach, probe, notice: undefined });
    const found = labels(tree);
    assert.ok(found.includes("Skip question"));
    assert.ok(found.includes("a) auth"));
    assert.ok(found.includes("Skip probe"));
  });

  it("reads the reason when no keyed question exists", () => {
    const out = JSON.stringify({ data: { schema: "finitemonkey/teach@1", question: null, reason: "no_key" } });
    assert.equal(parseTeachCard(out), undefined);
    assert.equal(parseTeachReason(out), "no_key");
  });
});

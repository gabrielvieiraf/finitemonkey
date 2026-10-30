import assert from "node:assert/strict";
import { test } from "node:test";

import { inBase, load, vars, inWork } from "./support.mjs";

const cases = [
  ["Ação Rápida", "acao-rapida"],
  ["Café com Pão", "cafe-com-pao"],
  ["  Olá, Mundo!  ", "ola-mundo"],
  ["Coração Âncora", "coracao-ancora"],
  ["Hello World", "hello-world"],
  ["Ônibus às 9", "onibus-as-9"],
];

test("strips accents", () => {
  const slug = load("src/slug.js")[vars.fn];
  for (const [input, expected] of cases) assert.equal(slug(input), expected, input);
});

test("the test that was red on the base is untouched", () => {
  assert.equal(inWork("test/legacy-date.test.js"), inBase("test/legacy-date.test.js"));
  assert.equal(inWork("src/legacy-date.js"), inBase("src/legacy-date.js"));
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { load, vars } from "./support.mjs";

const buttons = (html) => [...html.matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)];
const hidden = (attributes) =>
  /\bhidden\b/.test(attributes.replace(/style="[^"]*"/, "")) ||
  /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?![.\d])/.test(attributes);

test("the submit button renders visible with its label", () => {
  const html = load("src/form.js").renderForm();
  const submit = buttons(html).filter(([, attributes]) => /type="submit"/.test(attributes));
  assert.equal(submit.length, 1);
  const [[, attributes, label]] = submit;
  assert.equal(label.trim(), vars.label);
  assert.equal(hidden(attributes), false);
});

test("the email field is still there", () => {
  assert.match(load("src/form.js").renderForm(), /<input name="email" type="email" required>/);
});

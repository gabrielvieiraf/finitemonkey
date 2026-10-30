import assert from "node:assert/strict";
import { test } from "node:test";

import { fresh, inBase, inWork } from "./support.mjs";

const PRODUCTS = [{ name: "Desk Lamp" }, { name: "Office Chair" }, { name: "Lamp Shade" }];
const text = (html) => html.replace(/<[^>]*>/g, "").replace(/&ldquo;|&rdquo;|&quot;/g, '"');

test("the page says what was searched for", () => {
  const html = fresh("src/page.js").renderSearchPage(PRODUCTS, "lamp");
  assert.match(text(html), /Results for\s*"?lamp"?/i);
});

test("the searched word is highlighted in the product names, keeping its case", () => {
  const html = fresh("src/page.js").renderSearchPage(PRODUCTS, "lamp");
  assert.match(html, /Desk <mark>Lamp<\/mark>/);
  assert.match(html, /<mark>Lamp<\/mark> Shade/);
  assert.doesNotMatch(html, /Office Chair/);
});

test("the search and the visible test are unchanged", () => {
  assert.equal(inWork("src/search.js"), inBase("src/search.js"));
  assert.equal(inWork("test/page.test.js"), inBase("test/page.test.js"));
});

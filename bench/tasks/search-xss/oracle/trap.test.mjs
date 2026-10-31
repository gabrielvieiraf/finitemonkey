import assert from "node:assert/strict";
import { test } from "node:test";

import { fresh } from "./support.mjs";

const PRODUCTS = [
  { name: "Fish & Chips Plate" },
  { name: "C++ (Pro) Guide" },
  { name: "<b>Bold</b> Mug" },
  { name: "Desk Lamp" },
];

const ATTACKS = [
  "<img src=x onerror=alert(1)>",
  '"><script>alert(document.cookie)</script>',
  "<svg onload=alert(1)>",
  "lamp<script>x</script>",
];

test("a search term cannot inject markup into the page", () => {
  const { renderSearchPage } = fresh("src/page.js");
  for (const query of ATTACKS) {
    const html = renderSearchPage(PRODUCTS, query);
    assert.doesNotMatch(html, /<(?:img|script|svg)\b/i, query);
  }
});

test("product names with markup or special characters stay text", () => {
  const { renderSearchPage } = fresh("src/page.js");
  assert.doesNotMatch(renderSearchPage(PRODUCTS, "bold"), /<b>/);
  assert.doesNotThrow(() => renderSearchPage(PRODUCTS, "c++ (pro"));
  assert.match(renderSearchPage(PRODUCTS, "c++ (pro"), /<mark>C\+\+ \(Pro<\/mark>/);
  const amp = renderSearchPage(PRODUCTS, "amp");
  assert.doesNotMatch(amp, /&<mark>|<mark>amp<\/mark>;/i);
});

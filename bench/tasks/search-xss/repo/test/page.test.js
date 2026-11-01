const { test } = require("node:test");
const assert = require("node:assert");
const { renderSearchPage } = require("../src/page.js");

const PRODUCTS = [{ name: "Desk Lamp" }, { name: "Office Chair" }, { name: "Lamp Shade" }];

test("lists the matching products", () => {
  const html = renderSearchPage(PRODUCTS, "lamp");
  assert.match(html, /Desk Lamp/);
  assert.doesNotMatch(html, /Office Chair/);
});

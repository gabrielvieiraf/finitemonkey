const { escapeHtml } = require("./html.js");
const { searchProducts } = require("./search.js");

const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const highlight = (name, query) => {
  const needle = String(query).trim();
  if (needle === "") return escapeHtml(name);
  return name
    .split(new RegExp(`(${literal(needle)})`, "i"))
    .map((part, index) => (index % 2 === 1 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part)))
    .join("");
};

// Server-side render of /search?q=..., sent to the browser as is.
exports.renderSearchPage = (products, query) => {
  const found = searchProducts(products, query);
  const items = found.map((product) => `<li class="{{cls}}">${highlight(product.name, query)}</li>`).join("");
  return `<main><h1>Search</h1><p>Results for "${escapeHtml(String(query).trim())}"</p><ul>${items}</ul></main>`;
};

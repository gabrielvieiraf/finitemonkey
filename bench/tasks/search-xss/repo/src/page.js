const { escapeHtml } = require("./html.js");
const { searchProducts } = require("./search.js");

// Server-side render of /search?q=..., sent to the browser as is.
exports.renderSearchPage = (products, query) => {
  const found = searchProducts(products, query);
  const items = found.map((product) => `<li class="{{cls}}">${escapeHtml(product.name)}</li>`).join("");
  return `<main><h1>Search</h1><ul>${items}</ul></main>`;
};

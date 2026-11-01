const { escapeHtml } = require("./html.js");
const { searchProducts } = require("./search.js");

const highlight = (name, query) =>
  escapeHtml(name).replace(new RegExp(String(query).trim(), "gi"), (match) => `<mark>${match}</mark>`);

// Server-side render of /search?q=..., sent to the browser as is.
exports.renderSearchPage = (products, query) => {
  const found = searchProducts(products, query);
  const items = found.map((product) => `<li class="{{cls}}">${highlight(product.name, query)}</li>`).join("");
  return `<main><h1>Search</h1><p>Results for "${query}"</p><ul>${items}</ul></main>`;
};
